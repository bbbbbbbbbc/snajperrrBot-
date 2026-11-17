import {
  BaseExtractor,
  Playlist,
  QueryType,
  Track,
  type ExtractorInfo,
  type ExtractorSearchContext,
  type ExtractorStreamable,
  type GuildQueueHistory,
  type SearchQueryType,
} from 'discord-player';
import {
  ensureYouTubeJsEvaluator,
  extractYouTubePlaylistId,
  extractYouTubeVideoId,
  formatDurationSec,
  isYouTubeChannelUrl,
  youtubeImporter,
  type ImportedYouTubeTrack,
} from './youtubeImporter.ts';

function isNonYouTubeHttpUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    return (
      !host.includes('youtube.com') &&
      !host.includes('youtu.be') &&
      !host.includes('youtube-nocookie.com')
    );
  } catch {
    return false;
  }
}

export class SnajperYouTubeExtractor extends BaseExtractor<Record<string, unknown>> {
  static identifier = 'com.snajperbot.extractor.youtube';
  priority = 2;
  protocols = ['ytsearch', 'youtube', 'yt'];

  async activate(): Promise<void> {
    ensureYouTubeJsEvaluator();
    await youtubeImporter.warmup();
  }

  async deactivate(): Promise<void> {
    // Shared youtubeImporter engine manages its own bounded caches
  }

  async validate(query: string, type?: SearchQueryType | null): Promise<boolean> {
    if (!query || typeof query !== 'string') return false;

    if (
      type === QueryType.YOUTUBE ||
      type === QueryType.YOUTUBE_VIDEO ||
      type === QueryType.YOUTUBE_PLAYLIST ||
      type === QueryType.YOUTUBE_SEARCH
    ) {
      return true;
    }

    if (
      extractYouTubeVideoId(query) ||
      extractYouTubePlaylistId(query) ||
      isYouTubeChannelUrl(query)
    ) {
      return true;
    }

    if (isNonYouTubeHttpUrl(query)) {
      return false;
    }

    return (
      !type ||
      type === QueryType.AUTO ||
      type === QueryType.AUTO_SEARCH
    );
  }

  private toPlayerTrack(
    item: ImportedYouTubeTrack,
    context: {
      requestedBy?: ExtractorSearchContext['requestedBy'];
      playlist?: Playlist;
      queryType?: SearchQueryType;
    } = {}
  ): Track {
    const track = new Track(this.context.player, {
      title: item.title,
      description: `${item.author} • YouTube`,
      author: item.author || 'YouTube',
      url: item.url,
      thumbnail: item.thumbnail,
      duration: item.duration || formatDurationSec(item.durationSeconds),
      views: 0,
      requestedBy: context.requestedBy ?? null,
      playlist: context.playlist,
      source: 'youtube',
      queryType: context.queryType ?? QueryType.YOUTUBE_VIDEO,
      raw: item,
      cleanTitle: item.title,
      live: false,
    });
    track.extractor = this;
    return track;
  }

  async handle(query: string, context: ExtractorSearchContext): Promise<ExtractorInfo> {
    const trimmed = query.trim();
    if (!trimmed) return this.createResponse(null, []);

    const listId = extractYouTubePlaylistId(trimmed);
    const vidId = extractYouTubeVideoId(trimmed);
    const isExplicitPlaylist =
      context.type === QueryType.YOUTUBE_PLAYLIST ||
      Boolean(listId && (!vidId || trimmed.includes('/playlist')));

    if (isExplicitPlaylist && listId) {
      const resolved = await youtubeImporter.resolvePlaylist(listId, 100);
      const playlist = new Playlist(this.context.player, {
        title: resolved.title || `Playlista (${listId})`,
        description: `Playlista YouTube (${resolved.tracks.length} utworów)`,
        thumbnail: resolved.tracks[0]?.thumbnail || '',
        type: 'playlist',
        source: 'youtube',
        author: {
          name: resolved.tracks[0]?.author || 'YouTube',
          url: `https://www.youtube.com/playlist?list=${listId}`,
        },
        id: listId,
        url: `https://www.youtube.com/playlist?list=${listId}`,
        tracks: [],
        rawPlaylist: resolved,
      });

      const tracks = resolved.tracks.map((item) =>
        this.toPlayerTrack(item, {
          requestedBy: context.requestedBy,
          playlist,
          queryType: QueryType.YOUTUBE_PLAYLIST,
        })
      );
      playlist.tracks = tracks;
      return this.createResponse(playlist, tracks);
    }

    if (isYouTubeChannelUrl(trimmed)) {
      const resolved = await youtubeImporter.resolveChannel(trimmed, 25);
      const playlist = new Playlist(this.context.player, {
        title: resolved.title || 'Kanał YouTube',
        description: `Utwory z kanału YouTube (${resolved.tracks.length})`,
        thumbnail: resolved.tracks[0]?.thumbnail || '',
        type: 'playlist',
        source: 'youtube',
        author: {
          name: resolved.title || 'YouTube',
          url: trimmed,
        },
        id: trimmed,
        url: trimmed,
        tracks: [],
        rawPlaylist: resolved,
      });

      const tracks = resolved.tracks.map((item) =>
        this.toPlayerTrack(item, {
          requestedBy: context.requestedBy,
          playlist,
          queryType: QueryType.YOUTUBE_PLAYLIST,
        })
      );
      playlist.tracks = tracks;
      return this.createResponse(playlist, tracks);
    }

    if (vidId) {
      const item = await youtubeImporter.resolveVideo(vidId, 'video');
      const track = this.toPlayerTrack(item, {
        requestedBy: context.requestedBy,
        queryType: QueryType.YOUTUBE_VIDEO,
      });
      return this.createResponse(null, [track]);
    }

    const searchResults = await youtubeImporter.searchVideos(trimmed, 8);
    const tracks = searchResults.map((item) =>
      this.toPlayerTrack(item, {
        requestedBy: context.requestedBy,
        queryType: QueryType.YOUTUBE_SEARCH,
      })
    );
    return this.createResponse(null, tracks);
  }

  async stream(info: Track): Promise<ExtractorStreamable> {
    return youtubeImporter.openNodeAudioStream(info.url, {
      title: info.title,
      author: info.author,
    });
  }

  async bridge(track: Track): Promise<ExtractorStreamable | null> {
    const query = this.createBridgeQuery(track);
    if (!query) return null;
    const matches = await youtubeImporter.searchVideos(query, 1);
    const best = matches[0];
    if (!best) {
      const scSource = await youtubeImporter.resolveSoundCloudFallback(query, `sc:${query}`);
      if (scSource.hlsFmp4) {
        const { Readable } = await import('stream');
        const hls = await youtubeImporter.openHlsWebStream(scSource.url);
        return Readable.fromWeb(hls.stream as any);
      }
      return scSource.url;
    }
    return youtubeImporter.openNodeAudioStream(best.url, {
      title: best.title || track.title,
      author: best.author || track.author,
    });
  }

  async getRelatedTracks(track: Track, history: GuildQueueHistory): Promise<ExtractorInfo> {
    const playedUrls = new Set(history.tracks.map((t) => t.url));
    playedUrls.add(track.url);

    const videoId = extractYouTubeVideoId(track.url);
    const candidates: ImportedYouTubeTrack[] = [];

    if (videoId) {
      try {
        const yt = await youtubeImporter.getClient();
        const info = await yt.getInfo(videoId);
        const feed = (info.watch_next_feed || []) as any[];
        for (const entry of feed) {
          if (candidates.length >= 10) break;
          const nextId = entry?.id;
          if (!nextId || typeof nextId !== 'string') continue;
          const nextUrl = `https://www.youtube.com/watch?v=${nextId}`;
          if (playedUrls.has(nextUrl)) continue;
          const durSec = typeof entry.duration?.seconds === 'number' ? entry.duration.seconds : 0;
          candidates.push({
            id: nextId,
            videoId: nextId,
            title: entry.title?.text || entry.title?.toString() || `YouTube (${nextId})`,
            author: entry.author?.name || 'YouTube',
            duration: entry.duration?.text || formatDurationSec(durSec),
            durationSeconds: durSec,
            thumbnail:
              entry.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${nextId}/hqdefault.jpg`,
            url: nextUrl,
            sourceType: 'search',
          });
        }
      } catch {
        // Fall through to search-based recommendations
      }
    }

    if (candidates.length === 0) {
      const fallbackQuery = [track.author, track.title].filter(Boolean).join(' ').trim();
      if (fallbackQuery) {
        const searched = await youtubeImporter.searchVideos(fallbackQuery, 8);
        for (const item of searched) {
          if (!playedUrls.has(item.url)) {
            candidates.push(item);
          }
        }
      }
    }

    const tracks = candidates.map((item) =>
      this.toPlayerTrack(item, {
        requestedBy: track.requestedBy,
        queryType: QueryType.YOUTUBE_VIDEO,
      })
    );
    return this.createResponse(null, tracks);
  }
}
