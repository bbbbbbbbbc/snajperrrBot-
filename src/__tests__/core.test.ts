import { describe, expect, it } from 'vitest';
import {
  cleanTrackSearchQuery,
  extractYouTubePlaylistId,
  extractYouTubeVideoId,
  formatDurationSec,
  isSoundCloudUrl,
  isYouTubeChannelUrl,
} from '../lib/youtubeImporter.ts';
import { parseDurationMs } from '../adminCommands.ts';

describe('youtubeImporter URL & duration helpers', () => {
  it('extracts video IDs from watch, youtu.be, shorts, and embed URLs', () => {
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('rick astley never gonna give you up')).toBeNull();
  });

  it('extracts playlist IDs and channel/soundcloud URLs accurately', () => {
    expect(
      extractYouTubePlaylistId('https://www.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i')
    ).toBe('PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i');
    expect(isYouTubeChannelUrl('https://www.youtube.com/@YouTube')).toBe(true);
    expect(isYouTubeChannelUrl('https://open.spotify.com/track/123')).toBe(false);
    expect(isSoundCloudUrl('https://soundcloud.com/artist/track-name')).toBe(true);
    expect(isSoundCloudUrl('https://on.soundcloud.com/abc123')).toBe(true);
    expect(isSoundCloudUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
  });

  it('cleans cluttered YouTube titles without duplicating author', () => {
    const sanahQueries = cleanTrackSearchQuery('sanah - Szampan (Official Video)', 'sanah');
    expect(sanahQueries[0]).toBe('sanah - Szampan');
    expect(sanahQueries).toContain('sanah Szampan');
    expect(sanahQueries.every((q) => !/official video/i.test(q))).toBe(true);
    expect(sanahQueries.every((q) => !/sanah.*sanah/i.test(q))).toBe(true);

    const numbQueries = cleanTrackSearchQuery(
      'Numb (Official Music Video) [4K UPGRADE] – Linkin Park',
      'Linkin Park'
    );
    expect(numbQueries[0]).toBe('Numb - Linkin Park');
  });

  it('formats durations into mm:ss and hh:mm:ss', () => {
    expect(formatDurationSec(0)).toBe('0:00');
    expect(formatDurationSec(214)).toBe('3:34');
    expect(formatDurationSec(3665)).toBe('1:01:05');
  });
});

describe('adminCommands duration parser', () => {
  it('parses valid human-readable durations and rejects invalid strings', () => {
    expect(parseDurationMs('10m')).toBe(600_000);
    expect(parseDurationMs('2h')).toBe(7_200_000);
    expect(parseDurationMs('7d')).toBe(604_800_000);
    expect(parseDurationMs('')).toBeNull();
    expect(parseDurationMs('invalid-time')).toBeNull();
  });
});
