import path from 'path';
import fs from 'fs';
import { Innertube, UniversalCache } from 'youtubei.js';

export interface ImportedYouTubeTrack {
  id: string;
  videoId: string;
  title: string;
  author: string;
  duration: string;
  durationSeconds: number;
  thumbnail: string;
  url: string;
  sourceType: 'video' | 'playlist' | 'channel' | 'search';
}

export interface YouTubeImportResult {
  tracks: ImportedYouTubeTrack[];
  sourceTitle?: string;
  sourceKind: 'video' | 'playlist' | 'channel' | 'batch' | 'search';
  durationMs: number;
  cacheHits: number;
  failed: { input: string; reason: string }[];
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class LruTtlCache<T> {
  private map = new Map<string, CacheEntry<T>>();
  constructor(private readonly maxSize: number, private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) this.map.delete(key);
    while (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
      else break;
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= items.length) break;
        results[idx] = await worker(items[idx], idx);
      }
    })
  );

  return results;
}

export function formatDurationSec(sec: number): string {
  if (!sec || sec <= 0 || !Number.isFinite(sec)) return '0:00';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = Math.floor(sec % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

export function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    if (host.includes('youtu.be')) {
      const seg = u.pathname.replace(/^\//, '').split('/')[0];
      return seg && /^[a-zA-Z0-9_-]{11}$/.test(seg) ? seg : null;
    }
    if (host.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v') {
        const candidate = parts[1];
        return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
      }
    }
  } catch {
    // Not a URL
  }
  return null;
}

export function extractYouTubePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (/^(PL|OLAK5uy_|UU|RD|LL|FL)[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    if (!u.hostname.toLowerCase().includes('youtube.com') && !u.hostname.toLowerCase().includes('youtu.be')) {
      return null;
    }
    const listId = u.searchParams.get('list');
    if (listId && listId.length >= 10) return listId;
  } catch {
    // Not a URL
  }
  return null;
}

export function isYouTubeChannelUrl(input: string): boolean {
  try {
    const u = new URL(input.trim());
    if (!u.hostname.toLowerCase().includes('youtube.com')) return false;
    const p = u.pathname;
    return p.startsWith('/@') || p.startsWith('/channel/') || p.startsWith('/c/') || p.startsWith('/user/');
  } catch {
    return false;
  }
}

class YouTubeImporterEngine {
  private client: Innertube | null = null;
  private initPromise: Promise<Innertube> | null = null;
  private warmedUp = false;

  // Bounded LRU + TTL caches for sub-millisecond repeat lookups
  private trackCache = new LruTtlCache<ImportedYouTubeTrack>(1000, 30 * 60 * 1000);
  private searchCache = new LruTtlCache<ImportedYouTubeTrack[]>(250, 10 * 60 * 1000);
  private playlistCache = new LruTtlCache<{ title?: string; tracks: ImportedYouTubeTrack[] }>(100, 15 * 60 * 1000);

  // In-flight deduplication maps
  private trackInFlight = new Map<string, Promise<ImportedYouTubeTrack>>();
  private searchInFlight = new Map<string, Promise<ImportedYouTubeTrack[]>>();
  private playlistInFlight = new Map<string, Promise<{ title?: string; tracks: ImportedYouTubeTrack[] }>>();

  // Telemetry
  private cacheHits = 0;
  private cacheMisses = 0;

  public async getClient(): Promise<Innertube> {
    if (this.client) return this.client;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const cacheDir = path.join(process.cwd(), 'data', 'yt-cache');
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      const cookie = process.env.YOUTUBE_COOKIES?.trim() || undefined;
      const yt = await Innertube.create({
        cache: new UniversalCache(true, cacheDir),
        generate_session_locally: true,
        ...(cookie ? { cookie } : {}),
      });
      this.client = yt;
      this.warmedUp = true;
      return yt;
    })();

    try {
      return await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  }

  /** Pre-warms Innertube session + player scripts on boot so first search/import is instant. */
  public async warmup(): Promise<void> {
    try {
      await this.getClient();
    } catch {
      // Non-fatal; will retry lazily on demand
    }
  }

  public clearCaches(): void {
    this.trackCache.clear();
    this.searchCache.clear();
    this.playlistCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  public getStats() {
    const total = this.cacheHits + this.cacheMisses;
    return {
      warmedUp: this.warmedUp,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      hitRate: total > 0 ? Math.round((this.cacheHits / total) * 100) : 100,
      cachedTracks: this.trackCache.size,
      cachedPlaylists: this.playlistCache.size,
      cachedSearches: this.searchCache.size,
    };
  }

  /** Resolve single YouTube video metadata with LRU cache + request coalescing. */
  public async resolveVideo(
    videoIdOrUrl: string,
    sourceType: ImportedYouTubeTrack['sourceType'] = 'video'
  ): Promise<ImportedYouTubeTrack> {
    const videoId = extractYouTubeVideoId(videoIdOrUrl) || videoIdOrUrl.trim();
    const cached = this.trackCache.get(videoId);
    if (cached) {
      this.cacheHits++;
      return cached;
    }

    const existingPromise = this.trackInFlight.get(videoId);
    if (existingPromise) {
      return existingPromise;
    }

    this.cacheMisses++;
    const promise = (async (): Promise<ImportedYouTubeTrack> => {
      const yt = await this.getClient();
      const info = await yt.getBasicInfo(videoId);
      const durSec = Number(info.basic_info.duration || 0);
      const track: ImportedYouTubeTrack = {
        id: videoId,
        videoId,
        title: info.basic_info.title || `YouTube (${videoId})`,
        author: info.basic_info.author || 'YouTube',
        duration: formatDurationSec(durSec),
        durationSeconds: durSec,
        thumbnail:
          info.basic_info.thumbnail?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        sourceType,
      };
      this.trackCache.set(videoId, track);
      return track;
    })();

    this.trackInFlight.set(videoId, promise);
    try {
      return await promise;
    } finally {
      this.trackInFlight.delete(videoId);
    }
  }

  /** Fast cached YouTube search. */
  public async searchVideos(query: string, limit = 12): Promise<ImportedYouTubeTrack[]> {
    const normalized = query.trim();
    if (!normalized) return [];

    // Direct video URL fast-path
    const directId = extractYouTubeVideoId(normalized);
    if (directId && !extractYouTubePlaylistId(normalized)) {
      const track = await this.resolveVideo(directId, 'video');
      return [track];
    }

    // Direct playlist URL fast-path
    const playlistId = extractYouTubePlaylistId(normalized);
    if (playlistId) {
      const pl = await this.resolvePlaylist(playlistId, limit);
      return pl.tracks.slice(0, limit);
    }

    const cacheKey = `${normalized.toLowerCase()}::${limit}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      this.cacheHits++;
      return cached;
    }

    const existingPromise = this.searchInFlight.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    this.cacheMisses++;
    const promise = (async (): Promise<ImportedYouTubeTrack[]> => {
      const yt = await this.getClient();
      const search = await yt.search(normalized, { type: 'video' });
      const tracks: ImportedYouTubeTrack[] = [];

      for (const v of (search.videos || []).slice(0, limit) as any[]) {
        const vidId = v?.id;
        if (!vidId) continue;
        const durSec = typeof v.duration?.seconds === 'number' ? v.duration.seconds : 0;
        const item: ImportedYouTubeTrack = {
          id: vidId,
          videoId: vidId,
          title: v.title?.text || v.title?.toString() || 'Nieznany utwór',
          author: v.author?.name || 'YouTube',
          duration: v.duration?.text || formatDurationSec(durSec),
          durationSeconds: durSec,
          thumbnail: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${vidId}`,
          sourceType: 'search',
        };
        this.trackCache.set(vidId, item);
        tracks.push(item);
      }

      this.searchCache.set(cacheKey, tracks);
      return tracks;
    })();

    this.searchInFlight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.searchInFlight.delete(cacheKey);
    }
  }

  /** Extracts an entire YouTube playlist (with continuation pagination up to maxItems). */
  public async resolvePlaylist(
    playlistUrlOrId: string,
    maxItems = 100
  ): Promise<{ title?: string; tracks: ImportedYouTubeTrack[] }> {
    const listId = extractYouTubePlaylistId(playlistUrlOrId) || playlistUrlOrId.trim();
    const cappedMax = Math.max(1, Math.min(250, maxItems));
    const cacheKey = `${listId}::${cappedMax}`;

    const cached = this.playlistCache.get(cacheKey);
    if (cached) {
      this.cacheHits++;
      return cached;
    }

    const existingPromise = this.playlistInFlight.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    this.cacheMisses++;
    const promise = (async () => {
      const yt = await this.getClient();
      let current = await yt.getPlaylist(listId);
      const playlistTitle = current.info?.title || `Playlista (${listId})`;
      const tracks: ImportedYouTubeTrack[] = [];
      const seenIds = new Set<string>();

      const collectItems = (items: any[]) => {
        for (const item of items) {
          if (tracks.length >= cappedMax) break;
          const vidId = item?.id;
          if (!vidId || seenIds.has(vidId)) continue;
          seenIds.add(vidId);

          const durSec = typeof item.duration?.seconds === 'number' ? item.duration.seconds : 0;
          const track: ImportedYouTubeTrack = {
            id: vidId,
            videoId: vidId,
            title: item.title?.text || item.title?.toString() || `YouTube (${vidId})`,
            author: item.author?.name || 'YouTube',
            duration: item.duration?.text || formatDurationSec(durSec),
            durationSeconds: durSec,
            thumbnail:
              item.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
            url: `https://www.youtube.com/watch?v=${vidId}`,
            sourceType: 'playlist',
          };
          this.trackCache.set(vidId, track);
          tracks.push(track);
        }
      };

      collectItems(current.items as any[]);

      let pageGuard = 0;
      while (tracks.length < cappedMax && current.has_continuation && pageGuard < 5) {
        pageGuard++;
        current = await current.getContinuation();
        collectItems(current.items as any[]);
      }

      const result = { title: playlistTitle, tracks };
      this.playlistCache.set(cacheKey, result);
      return result;
    })();

    this.playlistInFlight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.playlistInFlight.delete(cacheKey);
    }
  }

  /** Extracts latest videos from a YouTube channel URL (e.g., https://www.youtube.com/@handle). */
  public async resolveChannel(
    channelUrl: string,
    maxItems = 25
  ): Promise<{ title?: string; tracks: ImportedYouTubeTrack[] }> {
    const yt = await this.getClient();
    const resolved = await yt.resolveURL(channelUrl.trim());
    const browseId = (resolved as any)?.payload?.browseId;
    if (!browseId) {
      throw new Error('Nie rozpoznano kanału YouTube.');
    }

    const channel = await yt.getChannel(browseId);
    const videosTab = await channel.getVideos();
    const rawVideos: any[] = (videosTab as any).videos || (videosTab as any).current_tab?.content?.contents || [];
    const tracks: ImportedYouTubeTrack[] = [];

    for (const v of rawVideos) {
      if (tracks.length >= maxItems) break;
      const vidId = v?.id || v?.video_id;
      if (!vidId) continue;
      const durSec = typeof v.duration?.seconds === 'number' ? v.duration.seconds : 0;
      const item: ImportedYouTubeTrack = {
        id: vidId,
        videoId: vidId,
        title: v.title?.text || v.title?.toString() || `YouTube (${vidId})`,
        author: channel.metadata?.title || 'YouTube Channel',
        duration: v.duration?.text || formatDurationSec(durSec),
        durationSeconds: durSec,
        thumbnail: v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${vidId}`,
        sourceType: 'channel',
      };
      this.trackCache.set(vidId, item);
      tracks.push(item);
    }

    return { title: channel.metadata?.title || 'Kanał YouTube', tracks };
  }

  /**
   * High-throughput batch importer: accepts a raw string (newlines/commas) or array of inputs
   * mixing playlists, channel URLs, video URLs, and search queries, resolving them in parallel
   * with bounded concurrency (6 workers) and full deduplication.
   */
  public async importBatch(
    rawInput: string | string[],
    options: { maxItems?: number; concurrency?: number } = {}
  ): Promise<YouTubeImportResult> {
    const startedAt = Date.now();
    const hitsBefore = this.cacheHits;
    const maxItems = Math.max(1, Math.min(250, options.maxItems ?? 100));
    const concurrency = Math.max(1, Math.min(10, options.concurrency ?? 6));

    const lines = (Array.isArray(rawInput) ? rawInput : rawInput.split(/[\n,;]+/))
      .map((s) => s.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return {
        tracks: [],
        sourceKind: 'batch',
        durationMs: 0,
        cacheHits: 0,
        failed: [],
      };
    }

    // Single input fast paths
    if (lines.length === 1) {
      const single = lines[0];
      const listId = extractYouTubePlaylistId(single);
      const vidId = extractYouTubeVideoId(single);

      // Prefer playlist when URL explicitly points to /playlist or has list= without v=
      const isExplicitPlaylist =
        listId && (!vidId || single.includes('/playlist'));

      if (isExplicitPlaylist && listId) {
        const pl = await this.resolvePlaylist(listId, maxItems);
        return {
          tracks: pl.tracks,
          sourceTitle: pl.title,
          sourceKind: 'playlist',
          durationMs: Date.now() - startedAt,
          cacheHits: this.cacheHits - hitsBefore,
          failed: [],
        };
      }

      if (isYouTubeChannelUrl(single)) {
        const ch = await this.resolveChannel(single, Math.min(maxItems, 50));
        return {
          tracks: ch.tracks,
          sourceTitle: ch.title,
          sourceKind: 'channel',
          durationMs: Date.now() - startedAt,
          cacheHits: this.cacheHits - hitsBefore,
          failed: [],
        };
      }

      if (vidId) {
        const track = await this.resolveVideo(vidId, 'video');
        return {
          tracks: [track],
          sourceTitle: track.title,
          sourceKind: 'video',
          durationMs: Date.now() - startedAt,
          cacheHits: this.cacheHits - hitsBefore,
          failed: [],
        };
      }

      // Single text query -> top search match (or multiple if needed)
      const results = await this.searchVideos(single, 1);
      return {
        tracks: results,
        sourceTitle: results[0]?.title || single,
        sourceKind: 'search',
        durationMs: Date.now() - startedAt,
        cacheHits: this.cacheHits - hitsBefore,
        failed: results.length === 0 ? [{ input: single, reason: 'Brak wyników' }] : [],
      };
    }

    // Multi-line batch resolution with bounded concurrency
    const failed: { input: string; reason: string }[] = [];
    const collected: ImportedYouTubeTrack[] = [];
    const seen = new Set<string>();

    const batchResults = await runWithConcurrency(lines.slice(0, maxItems), concurrency, async (entry) => {
      try {
        const listId = extractYouTubePlaylistId(entry);
        const vidId = extractYouTubeVideoId(entry);
        if (listId && (!vidId || entry.includes('/playlist'))) {
          const pl = await this.resolvePlaylist(listId, Math.min(maxItems, 50));
          return pl.tracks;
        }
        if (isYouTubeChannelUrl(entry)) {
          const ch = await this.resolveChannel(entry, 15);
          return ch.tracks;
        }
        if (vidId) {
          return [await this.resolveVideo(vidId, 'video')];
        }
        const found = await this.searchVideos(entry, 1);
        if (found.length === 0) {
          failed.push({ input: entry, reason: 'Nie znaleziono na YouTube' });
        }
        return found;
      } catch (err: any) {
        failed.push({ input: entry, reason: err?.message || 'Błąd pobierania' });
        return [];
      }
    });

    for (const chunk of batchResults) {
      for (const track of chunk) {
        if (collected.length >= maxItems) break;
        if (seen.has(track.videoId)) continue;
        seen.add(track.videoId);
        collected.push(track);
      }
    }

    return {
      tracks: collected,
      sourceTitle: `Import wsadowy (${collected.length})`,
      sourceKind: 'batch',
      durationMs: Date.now() - startedAt,
      cacheHits: this.cacheHits - hitsBefore,
      failed,
    };
  }

  /**
   * Opens a high-reliability audio stream using multi-client fallback
   * (TV_EMBEDDED -> ANDROID -> WEB).
   */
  public async openAudioStream(videoId: string): Promise<ReadableStream<Uint8Array>> {
    const yt = await this.getClient();
    const clients = ['TV_EMBEDDED', 'ANDROID', 'WEB'] as const;
    let lastError: unknown = null;

    for (const client of clients) {
      try {
        return await yt.download(videoId, {
          type: 'audio',
          quality: 'best',
          format: 'mp4',
          client,
        });
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Audio stream unavailable');
  }
}

export const youtubeImporter = new YouTubeImporterEngine();
