import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { IntegrationConnection, VideoChannel } from './types.ts';

export interface StoredUser {
  id: string;
  username: string;
  avatar: string | null;
  is_admin: number;
  premium: number;
  premium_expires_at: number | null;
  audio_quality: string;
  premium_settings: string | null;
  spotify_access_token: string | null;
  spotify_refresh_token: string | null;
  spotify_expires_at: number | null;
  created_at: number;
}

export interface StoredVoucher {
  code: string;
  type: 'user_premium' | 'guild_premium' | string;
  duration: number;
  max_uses: number;
  uses: number;
  created_by: string;
  created_at: number;
}

export interface StoredLog {
  id: number;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
  details: string;
  solution: string | null;
  created_at: number;
}

export interface StoredBug {
  id: number;
  user_id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | string;
  status: 'open' | 'fixed' | 'closed' | string;
  created_at: number;
}

export interface StoredBroadcast {
  id: number;
  title: string;
  body: string;
  created_by: string;
  sent_count: number;
  created_at: number;
}

export interface StoredWarning {
  guild_id: string;
  user_id: string;
  moderator_id: string;
  reason: string;
  timestamp: number;
}

export interface StoredTempban {
  guild_id: string;
  user_id: string;
  moderator_id: string;
  reason: string;
  expires_at: number;
  created_at: number;
}

export interface StoredRedeemedVoucher {
  code: string;
  user_id: string;
  redeemed_at: number;
}

export interface StoredGuildPremium {
  guild_id: string;
  added_by: string;
  active: number;
}

export interface StoreState {
  users: StoredUser[];
  vouchers: StoredVoucher[];
  redeemedVouchers: StoredRedeemedVoucher[];
  guildsPremium: StoredGuildPremium[];
  warnings: StoredWarning[];
  tempbans: StoredTempban[];
  logs: StoredLog[];
  bugs: StoredBug[];
  broadcasts: StoredBroadcast[];
  videoChannels: VideoChannel[];
  integrations: Record<string, IntegrationConnection>;
  lastRepair: string | null;
  nextLogId: number;
  nextBugId: number;
  nextBroadcastId: number;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const STORE_TMP_PATH = path.join(DATA_DIR, 'store.json.tmp');

function createDefaultState(): StoreState {
  const now = Date.now();
  return {
    users: [],
    vouchers: [],
    redeemedVouchers: [],
    guildsPremium: [],
    warnings: [],
    tempbans: [],
    logs: [
      {
        id: 1,
        level: 'info',
        source: 'system',
        message: 'SnajperBot Control Panel uruchomiony pomyślnie.',
        details: 'API endpoints, Web Player, Video Channels i Integrations Hub aktywne.',
        solution: null,
        created_at: now,
      },
    ],
    bugs: [],
    broadcasts: [],
    videoChannels: [
      {
        id: 'cinema-general',
        name: 'kino-ogolne',
        currentVideo: {
          id: 'default-lofi-stream',
          title: 'Best of Lofi Hip Hop — Beats to Relax/Study to',
          url: 'https://www.youtube.com/watch?v=n61ULEU7CO0',
          embedUrl: 'https://www.youtube.com/embed/n61ULEU7CO0?autoplay=0&rel=0&enablejsapi=1',
          provider: 'youtube',
          addedBy: 'System',
          addedAt: now,
          thumbnail: 'https://i.ytimg.com/vi/n61ULEU7CO0/hqdefault.jpg',
        },
        isPlaying: false,
        queue: [],
        history: [],
        updatedAt: now,
      },
      {
        id: 'watch-party',
        name: 'watch-party',
        currentVideo: null,
        isPlaying: false,
        queue: [],
        history: [],
        updatedAt: now,
      },
      {
        id: 'music-videos',
        name: 'teledyski-live',
        currentVideo: null,
        isPlaying: false,
        queue: [],
        history: [],
        updatedAt: now,
      },
    ],
    integrations: {
      'discord-webhook': {
        integrationId: 'discord-webhook',
        enabled: true,
        endpointUrl: '',
        apiKey: '',
        channelTarget: '#muzyka-logi',
        events: ['track_started', 'video_queued'],
        updatedAt: now,
        lastStatus: 'Ready',
      },
      'youtube-data-api': {
        integrationId: 'youtube-data-api',
        enabled: true,
        endpointUrl: 'https://www.youtube.com',
        apiKey: '',
        channelTarget: 'youtubei.js',
        events: ['track_started', 'video_queued'],
        updatedAt: now,
        lastStatus: 'Active (Innertube)',
      },
    },
    lastRepair: null,
    nextLogId: 2,
    nextBugId: 1,
    nextBroadcastId: 1,
  };
}

function loadState(): StoreState {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      const defaults = createDefaultState();
      const channels =
        Array.isArray(parsed.videoChannels) && parsed.videoChannels.length > 0
          ? parsed.videoChannels.map((ch: VideoChannel) => {
              if (ch?.currentVideo?.url?.includes('jfKfPfyJRdk')) {
                return {
                  ...ch,
                  currentVideo: defaults.videoChannels[0].currentVideo,
                };
              }
              return ch;
            })
          : defaults.videoChannels;
      return {
        ...defaults,
        ...parsed,
        tempbans: Array.isArray(parsed.tempbans) ? parsed.tempbans : [],
        videoChannels: channels,
        integrations:
          parsed.integrations && typeof parsed.integrations === 'object'
            ? parsed.integrations
            : defaults.integrations,
      };
    }
  } catch (err) {
    console.warn('[DB] Failed to load store.json, using defaults:', err);
  }
  return createDefaultState();
}

export const storeState: StoreState = loadState();

// Coalesced non-blocking atomic writer (never blocks the Node.js event loop during bursts)
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writeInFlight: Promise<void> | null = null;
let dirty = false;

async function persistAtomic(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  try {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const serialized = JSON.stringify(storeState, null, 2);
    await fs.promises.writeFile(STORE_TMP_PATH, serialized, 'utf-8');
    await fs.promises.rename(STORE_TMP_PATH, STORE_PATH);
  } catch (err) {
    dirty = true;
    console.error('[DB] Failed to save store.json:', err);
  }
}

export function saveStore(): void {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (!writeInFlight) {
      writeInFlight = persistAtomic().finally(() => {
        writeInFlight = null;
        if (dirty) saveStore();
      });
    }
  }, 40);
  writeTimer.unref?.();
}

export async function flushStore(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (writeInFlight) {
    await writeInFlight;
  }
  if (dirty) {
    await persistAtomic();
  }
}

export const dbOps = {
  warnings: {
    list(guildId: string, userId: string): StoredWarning[] {
      return storeState.warnings.filter((w) => w.guild_id === guildId && w.user_id === userId);
    },
    add(guildId: string, userId: string, moderatorId: string, reason: string): StoredWarning {
      const entry: StoredWarning = {
        guild_id: guildId,
        user_id: userId,
        moderator_id: moderatorId,
        reason,
        timestamp: Date.now(),
      };
      storeState.warnings.push(entry);
      saveStore();
      return entry;
    },
    clear(guildId: string, userId: string): number {
      const before = storeState.warnings.length;
      storeState.warnings = storeState.warnings.filter(
        (w) => !(w.guild_id === guildId && w.user_id === userId)
      );
      const removed = before - storeState.warnings.length;
      if (removed > 0) saveStore();
      return removed;
    },
  },

  tempbans: {
    add(
      guildId: string,
      userId: string,
      moderatorId: string,
      reason: string,
      expiresAt: number
    ): StoredTempban {
      storeState.tempbans = storeState.tempbans.filter(
        (b) => !(b.guild_id === guildId && b.user_id === userId)
      );
      const record: StoredTempban = {
        guild_id: guildId,
        user_id: userId,
        moderator_id: moderatorId,
        reason,
        expires_at: expiresAt,
        created_at: Date.now(),
      };
      storeState.tempbans.push(record);
      saveStore();
      return record;
    },
    remove(guildId: string, userId: string): void {
      const before = storeState.tempbans.length;
      storeState.tempbans = storeState.tempbans.filter(
        (b) => !(b.guild_id === guildId && b.user_id === userId)
      );
      if (storeState.tempbans.length !== before) saveStore();
    },
    listDue(now = Date.now()): StoredTempban[] {
      return storeState.tempbans.filter((b) => b.expires_at <= now);
    },
  },

  vouchers: {
    findByCode(code: string): StoredVoucher | null {
      const normalized = code.trim().toUpperCase();
      return storeState.vouchers.find((v) => v.code === normalized) || null;
    },
    create(
      type: StoredVoucher['type'],
      durationMs: number,
      maxUses: number,
      createdBy: string
    ): StoredVoucher {
      const voucher: StoredVoucher = {
        code: crypto.randomBytes(6).toString('hex').toUpperCase(),
        type,
        duration: durationMs,
        max_uses: Math.max(1, maxUses),
        uses: 0,
        created_by: createdBy,
        created_at: Date.now(),
      };
      storeState.vouchers.unshift(voucher);
      saveStore();
      return voucher;
    },
    redeem(
      rawCode: string,
      userId: string,
      guildId: string,
      username: string
    ): { ok: true; voucher: StoredVoucher } | { ok: false; error: string } {
      const code = rawCode.trim().toUpperCase();
      const alreadyUsed = storeState.redeemedVouchers.some(
        (r) => r.code === code && r.user_id === userId
      );
      if (alreadyUsed) {
        return { ok: false, error: 'Już użyłeś/aś tego vouchera.' };
      }

      const voucher = storeState.vouchers.find((v) => v.code === code);
      if (!voucher) {
        return { ok: false, error: 'Podałeś/aś nieprawidłowy kod vouchera.' };
      }
      if (voucher.uses >= voucher.max_uses) {
        return { ok: false, error: 'Ten voucher został już w pełni wykorzystany.' };
      }

      voucher.uses += 1;
      storeState.redeemedVouchers.push({
        code,
        user_id: userId,
        redeemed_at: Date.now(),
      });

      const now = Date.now();
      if (voucher.type === 'user_premium') {
        const existing = storeState.users.find((u) => u.id === userId);
        if (existing) {
          existing.premium = 1;
          const base =
            existing.premium_expires_at && existing.premium_expires_at > now
              ? existing.premium_expires_at
              : now;
          existing.premium_expires_at = base + Number(voucher.duration || 0);
        } else {
          storeState.users.push({
            id: userId,
            username,
            avatar: null,
            is_admin: 0,
            premium: 1,
            premium_expires_at: now + Number(voucher.duration || 0),
            audio_quality: 'high',
            premium_settings: null,
            spotify_access_token: null,
            spotify_refresh_token: null,
            spotify_expires_at: null,
            created_at: now,
          });
        }
      } else if (voucher.type === 'guild_premium') {
        const exists = storeState.guildsPremium.some((g) => g.guild_id === guildId);
        if (!exists) {
          storeState.guildsPremium.push({ guild_id: guildId, added_by: userId, active: 1 });
        }
      }

      saveStore();
      return { ok: true, voucher };
    },
  },
};

export default dbOps;
