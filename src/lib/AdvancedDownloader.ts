import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { Constants } from 'youtubei.js';
import {
  ensureYouTubeJsEvaluator,
  extractYouTubeVideoId,
  youtubeImporter,
} from './youtubeImporter.ts';

export interface DownloadOptions {
  url: string;
  outputPath: string;
  format: 'audio' | 'video' | 'both';
  quality?: 'best' | 'lowest';
}

function sanitizeFileName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 80);
  return cleaned || 'download';
}

export class AdvancedDownloader extends EventEmitter {
  public async initialize(): Promise<void> {
    ensureYouTubeJsEvaluator();
    await youtubeImporter.getClient();
  }

  public async download(options: DownloadOptions): Promise<string> {
    await this.initialize();
    this.emit('start', options.url);

    try {
      const videoId = extractYouTubeVideoId(options.url) || options.url.trim();
      const meta = await youtubeImporter.resolveVideo(videoId, 'video');
      const safeTitle = sanitizeFileName(meta.title);

      await fs.promises.mkdir(options.outputPath, { recursive: true });

      let finalPath = '';
      if (options.format === 'audio') {
        finalPath = path.join(options.outputPath, `${safeTitle}.m4a`);
        await this.downloadAudioStream(videoId, finalPath);
      } else if (options.format === 'video') {
        finalPath = path.join(options.outputPath, `${safeTitle}.mp4`);
        await this.downloadVideoStream(videoId, finalPath, options.quality || 'best');
      } else {
        const audioPath = path.join(options.outputPath, `${safeTitle}.m4a`);
        const videoPath = path.join(options.outputPath, `${safeTitle}_video.mp4`);
        await Promise.all([
          this.downloadAudioStream(videoId, audioPath),
          this.downloadVideoStream(videoId, videoPath, options.quality || 'best'),
        ]);
        finalPath = options.outputPath;
      }

      this.emit('finish', finalPath);
      return finalPath;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  private async downloadAudioStream(videoId: string, dest: string): Promise<void> {
    const source = await youtubeImporter.resolveAudioStreamSource(videoId);
    let bodyStream: ReadableStream<Uint8Array>;

    if (!source.isLive) {
      const resp = await fetch(source.url, { headers: Constants.STREAM_HEADERS });
      if (resp.ok && resp.body) {
        bodyStream = resp.body;
      } else {
        bodyStream = await youtubeImporter.openAudioStream(videoId);
      }
    } else {
      bodyStream = await youtubeImporter.openAudioStream(videoId);
    }

    await this.pipeWebStreamToFile(bodyStream, dest);
  }

  private async downloadVideoStream(
    videoId: string,
    dest: string,
    quality: 'best' | 'lowest'
  ): Promise<void> {
    const yt = await youtubeImporter.getClient();
    const clients = ['IOS', 'MWEB', 'ANDROID_VR', 'WEB'] as const;
    let stream: ReadableStream<Uint8Array> | null = null;
    let lastError: unknown = null;

    for (const client of clients) {
      try {
        stream = await yt.download(videoId, {
          type: 'video+audio',
          quality,
          format: 'mp4',
          client,
        });
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!stream) {
      throw lastError instanceof Error ? lastError : new Error('Video stream unavailable');
    }

    await this.pipeWebStreamToFile(stream, dest);
  }

  private async pipeWebStreamToFile(
    webStream: ReadableStream<Uint8Array>,
    dest: string
  ): Promise<void> {
    let downloadedBytes = 0;
    const nodeReadable = Readable.fromWeb(webStream as any);
    nodeReadable.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.byteLength;
      this.emit('progress', downloadedBytes);
    });
    const fileStream = fs.createWriteStream(dest);
    await pipeline(nodeReadable, fileStream);
  }
}

export const globalDownloader = new AdvancedDownloader();
