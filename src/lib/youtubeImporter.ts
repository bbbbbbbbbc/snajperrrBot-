import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { Constants, Innertube, Log, Platform, UniversalCache } from 'youtubei.js';
import { Soundcloud } from 'soundcloud.ts';

let evaluatorRegistered = false;
export function ensureYouTubeJsEvaluator(): void {
  if (evaluatorRegistered) return;
  evaluatorRegistered = true;
  Log.setLevel(Log.Level.ERROR);
  Platform.shim.eval = async (data, env) => {
    const properties: string[] = [];
    if (env.n) {
      properties.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
    }
    if (env.sig) {
      properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
    }
    const code = `${data.output}\nreturn {${properties.join(', ')}};`;
    return new Function(code)();
  };
}

ensureYouTubeJsEvaluator();

export interface ResolvedAudioSource {
  videoId: string;
  url: string;
  mimeType: string;
  contentLength: number | null;
  client: string;
  isLive: boolean;
  hlsUrl?: string;
  hlsFmp4?: boolean;
  sourceProvider: 'youtube' | 'soundcloud';
}

export interface AudioResolutionHints {
  title?: string;
  author?: string;
}

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

  delete(key: string): void {
    this.map.delete(key);
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

export function isSoundCloudUrl(input: string): boolean {
  try {
    const u = new URL(input.trim());
    const host = u.hostname.toLowerCase();
    return host === 'soundcloud.com' || host.endsWith('.soundcloud.com');
  } catch {
    return false;
  }
}

/**
 * Generates an ordered, deduplicated cascade of clean search queries from track title & author,
 * removing YouTube clutter tags and avoiding duplicated artist names.
 */
export function cleanTrackSearchQuery(title?: string, author?: string): string[] {
  const stripClutter = (raw: string) =>
    raw
      .replace(/[\u2012-\u2015]/g, '-')
      .replace(/\((?:official\s*(?:music\s*)?(?:video|audio|lyric(?:s)?\s*video)?|lyric(?:s)?\s*video|lyrics|audio|visualizer|hd|4k|hq|explicit|remastered(?:\s*\d+)?|live|prod\.[^)]+)\)/gi, ' ')
      .replace(/\[(?:official\s*(?:music\s*)?(?:video|audio)?|lyric(?:s)?|audio|hd|4k(?:\s*upgrade)?|hq|explicit|live|remastered(?:\s*\d+)?)\]/gi, ' ')
      .replace(/\s*\|\s*[^|]+$/g, ' ')
      .replace(/#\S+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const stripFeatured = (raw: string) =>
    raw
      .replace(/\s*\((?:feat\.?|ft\.?|featuring)\s+[^)]+\)/gi, ' ')
      .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.+$/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const cleanAuthor = stripClutter(author || '')
    .replace(/\s*-\s*topic$/i, '')
    .replace(/vevo$/i, '')
    .trim();

  const rawTitle = (title || '').trim();
  const baseTitle = stripClutter(rawTitle);
  const noFeatTitle = stripFeatured(baseTitle);

  const candidates: string[] = [];
  const pushUnique = (q: string) => {
    const normalized = q.replace(/^[-–—\s]+|[-–—\s]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    if (!candidates.some((c) => c.toLowerCase() === normalized.toLowerCase())) {
      candidates.push(normalized);
    }
  };

  const titleContainsAuthor = (t: string, a: string) => {
    if (!a || a.length < 2) return false;
    const normT = t.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż\s]/gi, ' ');
    const normA = a.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż\s]/gi, ' ').trim();
    return Boolean(normA && normT.includes(normA));
  };

  if (baseTitle) {
    if (cleanAuthor && !titleContainsAuthor(baseTitle, cleanAuthor) && cleanAuthor.toLowerCase() !== 'youtube') {
      pushUnique(`${cleanAuthor} ${baseTitle}`);
      pushUnique(`${baseTitle} ${cleanAuthor}`);
    }
    pushUnique(baseTitle);
  }

  if (noFeatTitle && noFeatTitle !== baseTitle) {
    if (cleanAuthor && !titleContainsAuthor(noFeatTitle, cleanAuthor) && cleanAuthor.toLowerCase() !== 'youtube') {
      pushUnique(`${cleanAuthor} ${noFeatTitle}`);
    }
    pushUnique(noFeatTitle);
  }

  // Handle "Artist - Title" or "Title - Artist" splits (also yields swapped/core forms)
  const dashMatch = (noFeatTitle || baseTitle).match(/^(.+?)\s+-\s+(.+)$/);
  if (dashMatch) {
    const left = dashMatch[1].trim();
    const right = dashMatch[2].trim();
    pushUnique(`${left} ${right}`);
    pushUnique(`${right} ${left}`);
    if (cleanAuthor && !titleContainsAuthor(right, cleanAuthor)) {
      pushUnique(`${cleanAuthor} ${right}`);
    }
  }

  if (rawTitle && candidates.length === 0) {
    pushUnique(rawTitle);
  }

  return candidates;
}

class YouTubeImporterEngine {
  private client: Innertube | null = null;
  private initPromise: Promise<Innertube> | null = null;
  private warmedUp = false;
  private scClient: Soundcloud | null = null;

  // Bounded LRU + TTL caches for sub-millisecond repeat lookups
  private trackCache = new LruTtlCache<ImportedYouTubeTrack>(1000, 30 * 60 * 1000);
  private searchCache = new LruTtlCache<ImportedYouTubeTrack[]>(250, 10 * 60 * 1000);
  private playlistCache = new LruTtlCache<{ title?: string; tracks: ImportedYouTubeTrack[] }>(100, 15 * 60 * 1000);
  private audioSourceCache = new LruTtlCache<ResolvedAudioSource>(250, 5 * 60 * 1000);

  // In-flight deduplication maps
  private trackInFlight = new Map<string, Promise<ImportedYouTubeTrack>>();
  private searchInFlight = new Map<string, Promise<ImportedYouTubeTrack[]>>();
  private playlistInFlight = new Map<string, Promise<{ title?: string; tracks: ImportedYouTubeTrack[] }>>();
  private audioSourceInFlight = new Map<string, Promise<ResolvedAudioSource>>();

  // Telemetry
  private cacheHits = 0;
  private cacheMisses = 0;

  public async getClient(): Promise<Innertube> {
    if (this.client) return this.client;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      ensureYouTubeJsEvaluator();
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
    this.audioSourceCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  public invalidateAudioSource(videoId: string): void {
    const cleanId = extractYouTubeVideoId(videoId) || videoId.trim();
    this.audioSourceCache.delete(cleanId);
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

  private getSoundcloudClient(): Soundcloud {
    if (!this.scClient) {
      this.scClient = new Soundcloud();
    }
    return this.scClient;
  }

  /**
   * Resolves track title/author even when YouTube player endpoint returns LOGIN_REQUIRED.
   */
  public async resolveMetadataHints(
    videoId: string,
    hints?: AudioResolutionHints
  ): Promise<{ title?: string; author?: string }> {
    const cleanTitle = hints?.title?.trim();
    const cleanAuthor = hints?.author?.trim();
    if (cleanTitle) {
      return { title: cleanTitle, author: cleanAuthor };
    }

    const cached = this.trackCache.get(videoId);
    if (cached?.title) {
      return { title: cached.title, author: cached.author };
    }

    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`
      )}&format=json`;
      const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(4000) });
      if (resp.ok) {
        const data = (await resp.json()) as { title?: string; author_name?: string };
        if (data?.title) {
          return {
            title: data.title,
            author: data.author_name || cleanAuthor,
          };
        }
      }
    } catch {
      // Non-fatal; fallback to next method
    }

    return { title: cleanTitle, author: cleanAuthor };
  }

  public async resolveSoundCloudMetadata(url: string): Promise<{
    title: string;
    author: string;
    durationSeconds: number;
    thumbnail: string;
    url: string;
  } | null> {
    const sc = this.getSoundcloudClient();
    try {
      const track: any = await sc.tracks.getV2(url.trim());
      if (track && track.title) {
        const durSec = Math.round(Number(track.duration || 0) / 1000);
        return {
          title: String(track.title),
          author: String(track.user?.username || 'SoundCloud'),
          durationSeconds: durSec,
          thumbnail: String(track.artwork_url || track.user?.avatar_url || ''),
          url: String(track.permalink_url || url.trim()),
        };
      }
    } catch {
      // Fallback: derive readable query from SoundCloud slug
    }

    try {
      const parsed = new URL(url.trim());
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        const artistSlug = parts[0].replace(/-/g, ' ');
        const trackSlug = parts[1].replace(/-\d+$/, '').replace(/-/g, ' ');
        return {
          title: trackSlug,
          author: artistSlug,
          durationSeconds: 0,
          thumbnail: '',
          url: url.trim(),
        };
      }
    } catch {
      // Not a valid URL
    }
    return null;
  }

  /**
   * Resolves a playable unencrypted SoundCloud stream (progressive MP3 or fMP4/MP3 HLS)
   * for any text query or SoundCloud URL. Skips DRM-encrypted HLS and 30s Go+ previews.
   */
  public async resolveSoundCloudFallback(
    query: string,
    cacheKey = query,
    hints?: AudioResolutionHints
  ): Promise<ResolvedAudioSource> {
    const cleanQuery = query.trim();
    if (!cleanQuery && !hints?.title) {
      throw new Error('Brak tytułu utworu do wyszukania strumienia zapasowego.');
    }

    const sc = this.getSoundcloudClient();
    const clientId = await sc.api.getClientId();

    const isUsableTranscoding = (tr: any): boolean => {
      if (!tr || typeof tr.url !== 'string' || !tr.url) return false;
      if (tr.snipped === true) return false;
      if (tr.url.includes('/preview')) return false;
      if (tr.preset === 'abr_sq') return false;
      const mime = String(tr.format?.mime_type || '').toLowerCase();
      if (mime.includes('encrypted')) return false;
      const proto = String(tr.format?.protocol || '').toLowerCase();
      return proto === 'progressive' || proto === 'hls';
    };

    const getOrderedTranscodings = (track: any): any[] => {
      const list = (Array.isArray(track?.media?.transcodings) ? track.media.transcodings : []).filter(
        isUsableTranscoding
      );
      const score = (tr: any) => {
        if (tr.format?.protocol === 'progressive') return 0;
        const mime = String(tr.format?.mime_type || '');
        if (tr.format?.protocol === 'hls' && mime.includes('audio/mp4')) return 1;
        return 2;
      };
      return [...list].sort((a, b) => score(a) - score(b));
    };

    const resolveTrackTranscoding = async (track: any): Promise<ResolvedAudioSource | null> => {
      const transcodings = getOrderedTranscodings(track);
      if (transcodings.length === 0) return null;

      const trackAuth = track.track_authorization
        ? `&track_authorization=${encodeURIComponent(track.track_authorization)}`
        : '';

      for (const transcoding of transcodings) {
        try {
          const sep = transcoding.url.includes('?') ? '&' : '?';
          const resolveResp = await fetch(
            `${transcoding.url}${sep}client_id=${encodeURIComponent(clientId)}${trackAuth}`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (!resolveResp.ok) continue;
          const resolveJson = (await resolveResp.json()) as { url?: string };
          const resolvedUrl = resolveJson?.url;
          if (!resolvedUrl) continue;

          const isHls = transcoding.format?.protocol === 'hls';
          if (isHls) {
            const mResp = await fetch(resolvedUrl, { signal: AbortSignal.timeout(8000) });
            if (!mResp.ok) continue;
            const mText = await mResp.text();
            if (!mText.includes('#EXTINF') || /#EXT-X-KEY/i.test(mText)) {
              continue;
            }
          }

          const rawMime =
            String(transcoding.format?.mime_type || (isHls ? 'audio/mp4' : 'audio/mpeg'))
              .split(';')[0]
              .trim() || 'audio/mp4';

          return {
            videoId: cacheKey,
            url: resolvedUrl,
            mimeType: rawMime === 'audio/mpegurl' ? 'audio/mpeg' : rawMime,
            contentLength: null,
            client: 'SOUNDCLOUD_BRIDGE',
            isLive: false,
            hlsFmp4: isHls,
            sourceProvider: 'soundcloud',
          };
        } catch {
          // Try next transcoding
        }
      }
      return null;
    };

    const searchQueries: string[] = [];
    const isScDirectUrl = isSoundCloudUrl(cleanQuery);

    if (isScDirectUrl) {
      try {
        const directTrack: any = await sc.tracks.getV2(cleanQuery);
        if (directTrack) {
          const resolvedDirect = await resolveTrackTranscoding(directTrack);
          if (resolvedDirect) {
            this.audioSourceCache.set(cacheKey, resolvedDirect);
            return resolvedDirect;
          }
          searchQueries.push(...cleanTrackSearchQuery(directTrack.title, directTrack.user?.username));
        }
      } catch {
        // Fall through to slug-derived search
      }
      const slugMeta = await this.resolveSoundCloudMetadata(cleanQuery);
      if (slugMeta) {
        searchQueries.push(...cleanTrackSearchQuery(slugMeta.title, slugMeta.author));
      }
    }

    if (hints?.title) {
      for (const q of cleanTrackSearchQuery(hints.title, hints.author)) {
        if (!searchQueries.includes(q)) searchQueries.push(q);
      }
    }
    if (!isScDirectUrl && cleanQuery) {
      for (const q of cleanTrackSearchQuery(cleanQuery)) {
        if (!searchQueries.includes(q)) searchQueries.push(q);
      }
      if (!searchQueries.includes(cleanQuery)) {
        searchQueries.push(cleanQuery);
      }
    }

    for (const q of searchQueries.slice(0, 5)) {
      try {
        const searchRes = await sc.tracks.searchV2({ q, limit: 15 });
        const collection = Array.isArray(searchRes?.collection) ? searchRes.collection : [];
        if (collection.length === 0) continue;

        const orderedCandidates = [
          ...collection.filter((t: any) => Number(t?.duration || 0) > 45_000 && getOrderedTranscodings(t).length > 0),
          ...collection.filter((t: any) => Number(t?.duration || 0) <= 45_000 && getOrderedTranscodings(t).length > 0),
        ];

        for (const candidate of orderedCandidates.slice(0, 4)) {
          const resolved = await resolveTrackTranscoding(candidate);
          if (resolved) {
            this.audioSourceCache.set(cacheKey, resolved);
            return resolved;
          }
        }
      } catch {
        // Try next cleaned query variant
      }
    }

    throw new Error(`Nie znaleziono strumienia audio dla "${cleanQuery || hints?.title || ''}".`);
  }

  private async tryYouTubeClientsForVideo(videoId: string): Promise<{
    source?: ResolvedAudioSource;
    lastError?: unknown;
  }> {
    const yt = await this.getClient();
    const clients = ['IOS', 'MWEB', 'ANDROID_VR', 'WEB'] as const;
    let lastError: unknown = null;

    for (const client of clients) {
      try {
        const info = await yt.getBasicInfo(videoId, { client });

        if (info.basic_info?.is_live && info.streaming_data?.hls_manifest_url) {
          return {
            source: {
              videoId,
              url: info.streaming_data.hls_manifest_url,
              mimeType: 'application/vnd.apple.mpegurl',
              contentLength: null,
              client,
              isLive: true,
              hlsUrl: info.streaming_data.hls_manifest_url,
              sourceProvider: 'youtube',
            },
          };
        }

        let fmt: any = null;
        try {
          fmt = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
        } catch {
          fmt = info.chooseFormat({ type: 'audio', quality: 'best', format: 'any' });
        }

        const decipheredUrl = await fmt.decipher(yt.session.player);
        if (!decipheredUrl) {
          throw new Error('Empty deciphered stream URL');
        }

        // Verify CDN URL responds 200/206 (filters out 403 clients immediately)
        const probe = await fetch(decipheredUrl, {
          method: 'GET',
          headers: {
            ...Constants.STREAM_HEADERS,
            Range: 'bytes=0-0',
          },
          signal: AbortSignal.timeout(8000),
        });
        await probe.body?.cancel().catch(() => {});

        if (!probe.ok && probe.status !== 206) {
          throw new Error(`YouTube CDN responded HTTP ${probe.status} for client ${client}`);
        }

        const rawMime = String(fmt.mime_type || 'audio/mp4').split(';')[0].trim() || 'audio/mp4';
        const contentLength =
          typeof fmt.content_length === 'number' && fmt.content_length > 0
            ? fmt.content_length
            : null;

        return {
          source: {
            videoId,
            url: decipheredUrl,
            mimeType: rawMime,
            contentLength,
            client,
            isLive: false,
            sourceProvider: 'youtube',
          },
        };
      } catch (err) {
        lastError = err;
      }
    }

    return { lastError };
  }

  /**
   * Resolves a verified, range-capable direct YouTube audio CDN URL with multi-client
   * fallback (IOS -> MWEB -> ANDROID_VR -> WEB), JS cipher evaluation, 200/206 validation,
   * automatic SoundCloud Audio Bridge fallback, and alternate YouTube upload rescue.
   */
  public async resolveAudioStreamSource(
    videoIdOrUrl: string,
    forceRefresh = false,
    hints?: AudioResolutionHints
  ): Promise<ResolvedAudioSource> {
    if (isSoundCloudUrl(videoIdOrUrl)) {
      return this.resolveSoundCloudFallback(videoIdOrUrl, videoIdOrUrl.trim(), hints);
    }

    const videoId = extractYouTubeVideoId(videoIdOrUrl) || videoIdOrUrl.trim();
    if (!forceRefresh) {
      const cached = this.audioSourceCache.get(videoId);
      if (cached && cached.url) {
        this.cacheHits++;
        return cached;
      }
    }

    const inFlight = !forceRefresh ? this.audioSourceInFlight.get(videoId) : undefined;
    if (inFlight) return inFlight;

    this.cacheMisses++;
    const promise = (async (): Promise<ResolvedAudioSource> => {
      const directAttempt = await this.tryYouTubeClientsForVideo(videoId);
      if (directAttempt.source) {
        this.audioSourceCache.set(videoId, directAttempt.source);
        return directAttempt.source;
      }

      const lastError = directAttempt.lastError;
      const meta = await this.resolveMetadataHints(videoId, hints);
      const cleanVariants = cleanTrackSearchQuery(meta.title, meta.author);

      // 1) Automatic SoundCloud Audio Bridge with progressively cleaned track queries
      if (cleanVariants.length > 0) {
        try {
          return await this.resolveSoundCloudFallback(cleanVariants[0], videoId, meta);
        } catch {
          // Continue to alternate YouTube audio uploads
        }
      }

      // 2) Alternate YouTube upload rescue (e.g. non-VEVO lyric/audio uploads without LOGIN_REQUIRED)
      if (cleanVariants.length > 0) {
        try {
          const altSearch = await this.searchVideos(`${cleanVariants[0]} audio`, 5);
          for (const alt of altSearch) {
            if (!alt.videoId || alt.videoId === videoId) continue;
            const altAttempt = await this.tryYouTubeClientsForVideo(alt.videoId);
            if (altAttempt.source) {
              const aliased: ResolvedAudioSource = { ...altAttempt.source, videoId };
              this.audioSourceCache.set(videoId, aliased);
              return aliased;
            }
          }
        } catch {
          // Fall through to descriptive error
        }
      }

      const rawMsg =
        lastError instanceof Error ? lastError.message : String(lastError || 'Audio stream unavailable');
      if (/login required|streaming data not available|confirm you.?re not a bot/i.test(rawMsg)) {
        throw new Error(
          'YouTube wymaga weryfikacji/logowania dla tego utworu i nie znaleziono zapasowego strumienia (ustaw YOUTUBE_COOKIES lub spróbuj inny utwór).'
        );
      }
      throw lastError instanceof Error ? lastError : new Error('Audio stream unavailable');
    })();

    this.audioSourceInFlight.set(videoId, promise);
    try {
      return await promise;
    } finally {
      this.audioSourceInFlight.delete(videoId);
    }
  }

  /**
   * Streams an unencrypted HLS playlist (fMP4 init+segments or MP3 segments) lazily
   * segment-by-segment with backpressure so first byte starts in ~150ms.
   */
  public async openHlsWebStream(
    m3u8Url: string,
    abortSignal?: AbortSignal
  ): Promise<{ stream: ReadableStream<Uint8Array>; mimeType?: string }> {
    const manifestResp = await fetch(m3u8Url, {
      signal: abortSignal ?? AbortSignal.timeout(10_000),
    });
    if (!manifestResp.ok) {
      throw new Error(`HLS manifest HTTP ${manifestResp.status}`);
    }
    const m3u8Text = await manifestResp.text();
    const mapMatch = m3u8Text.match(/#EXT-X-MAP:URI="([^"]+)"/i);
    const baseUrl = new URL(m3u8Url);
    const toAbs = (raw: string) => new URL(raw, baseUrl).toString();

    const segmentUrls: string[] = [];
    if (mapMatch?.[1]) {
      segmentUrls.push(toAbs(mapMatch[1]));
    }
    for (const line of m3u8Text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      segmentUrls.push(toAbs(trimmed));
    }

    if (segmentUrls.length === 0) {
      throw new Error('HLS playlist contains no audio segments');
    }

    const detectedMime = mapMatch?.[1] ? 'audio/mp4' : 'audio/mpeg';
    let index = 0;
    let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (true) {
            if (abortSignal?.aborted) {
              await currentReader?.cancel().catch(() => {});
              controller.close();
              return;
            }

            if (!currentReader) {
              if (index >= segmentUrls.length) {
                controller.close();
                return;
              }
              const segUrl = segmentUrls[index++];
              const segResp = await fetch(segUrl, { signal: abortSignal });
              if (!segResp.ok || !segResp.body) {
                throw new Error(`HLS segment HTTP ${segResp.status}`);
              }
              currentReader = segResp.body.getReader();
            }

            const { done, value } = await currentReader.read();
            if (done) {
              currentReader = null;
              continue;
            }
            if (value && value.byteLength > 0) {
              controller.enqueue(value);
              return;
            }
          }
        } catch (err) {
          if (abortSignal?.aborted) {
            controller.close();
          } else {
            controller.error(err);
          }
        }
      },
      async cancel() {
        await currentReader?.cancel().catch(() => {});
        currentReader = null;
      },
    });

    return { stream, mimeType: detectedMime };
  }

  /**
   * Opens a high-reliability Web ReadableStream using verified multi-client resolution
   * (IOS -> MWEB -> ANDROID_VR -> WEB) or SoundCloud Bridge fallback.
   */
  public async openAudioStream(
    videoId: string,
    hints?: AudioResolutionHints
  ): Promise<ReadableStream<Uint8Array>> {
    const source = await this.resolveAudioStreamSource(videoId, false, hints);
    if (source.hlsFmp4) {
      const hls = await this.openHlsWebStream(source.url);
      return hls.stream;
    }

    if (!source.isLive) {
      const resp = await fetch(source.url, {
        headers: source.sourceProvider === 'youtube' ? Constants.STREAM_HEADERS : {},
      });
      if (resp.ok && resp.body) {
        return resp.body;
      }
    }

    const yt = await this.getClient();
    const clients = ['IOS', 'MWEB', 'ANDROID_VR', 'WEB'] as const;
    let lastError: unknown = null;

    for (const client of clients) {
      for (const format of ['mp4', 'any'] as const) {
        try {
          return await yt.download(videoId, {
            type: 'audio',
            quality: 'best',
            format,
            client,
          });
        } catch (err) {
          lastError = err;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Audio stream unavailable');
  }

  /**
   * Opens a Node.js Readable stream (or HLS URL string for live streams) for discord-player.
   */
  public async openNodeAudioStream(
    videoIdOrUrl: string,
    hints?: AudioResolutionHints
  ): Promise<Readable | string> {
    const cacheTarget = isSoundCloudUrl(videoIdOrUrl)
      ? videoIdOrUrl.trim()
      : extractYouTubeVideoId(videoIdOrUrl) || videoIdOrUrl.trim();
    const source = await this.resolveAudioStreamSource(cacheTarget, false, hints);
    if (source.isLive && source.hlsUrl) {
      return source.hlsUrl;
    }
    if (source.hlsFmp4) {
      const hls = await this.openHlsWebStream(source.url);
      return Readable.fromWeb(hls.stream as any);
    }

    const headers = source.sourceProvider === 'youtube' ? Constants.STREAM_HEADERS : {};
    const resp = await fetch(source.url, { headers });
    if (!resp.ok || !resp.body) {
      const refreshed = await this.resolveAudioStreamSource(cacheTarget, true, hints);
      if (refreshed.isLive && refreshed.hlsUrl) return refreshed.hlsUrl;
      if (refreshed.hlsFmp4) {
        const hls = await this.openHlsWebStream(refreshed.url);
        return Readable.fromWeb(hls.stream as any);
      }
      const retryResp = await fetch(refreshed.url, {
        headers: refreshed.sourceProvider === 'youtube' ? Constants.STREAM_HEADERS : {},
      });
      if (!retryResp.ok || !retryResp.body) {
        throw new Error(`Audio stream HTTP ${retryResp.status}`);
      }
      return Readable.fromWeb(retryResp.body as any);
    }
    return Readable.fromWeb(resp.body as any);
  }
}

export const youtubeImporter = new YouTubeImporterEngine();
