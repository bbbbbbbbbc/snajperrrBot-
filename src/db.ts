import fs from 'fs';
import path from 'path';
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

function createDefaultState(): StoreState {
  const now = Date.now();
  return {
    users: [],
    vouchers: [],
    redeemedVouchers: [],
    guildsPremium: [],
    warnings: [],
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
          title: 'Lofi Hip Hop Radio — Beats to Relax/Study to',
          url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
          embedUrl: 'https://www.youtube.com/embed/jfKfPfyJRdk?autoplay=0&rel=0',
          provider: 'youtube',
          addedBy: 'System',
          addedAt: now,
          thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg',
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
      return {
        ...defaults,
        ...parsed,
        videoChannels: Array.isArray(parsed.videoChannels) && parsed.videoChannels.length > 0
          ? parsed.videoChannels
          : defaults.videoChannels,
        integrations: parsed.integrations && typeof parsed.integrations === 'object'
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

export function saveStore(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(storeState, null, 2), 'utf-8');
  } catch (err) {
    console.error('[DB] Failed to save store.json:', err);
  }
}

class PreparedStatement {
  constructor(private query: string) {}

  run(...params: any[]) {
    const q = this.query.trim().toLowerCase();

    if (q === 'begin' || q === 'commit' || q === 'rollback') {
      if (q === 'commit') saveStore();
      return { changes: 0, lastInsertRowid: 0 };
    }

    if (q.startsWith('insert into warnings')) {
      const [guild_id, user_id, moderator_id, reason, timestamp] = params;
      storeState.warnings.push({ guild_id, user_id, moderator_id, reason, timestamp });
      saveStore();
      return { changes: 1, lastInsertRowid: storeState.warnings.length };
    }

    if (q.startsWith('delete from warnings')) {
      const [guild_id, user_id] = params;
      const before = storeState.warnings.length;
      storeState.warnings = storeState.warnings.filter(
        (w) => !(w.guild_id === guild_id && w.user_id === user_id)
      );
      saveStore();
      return { changes: before - storeState.warnings.length, lastInsertRowid: 0 };
    }

    if (q.startsWith('insert into vouchers')) {
      const [code, type, duration, max_uses, uses, created_by, created_at] = params;
      storeState.vouchers.unshift({ code, type, duration, max_uses, uses, created_by, created_at });
      saveStore();
      return { changes: 1, lastInsertRowid: storeState.vouchers.length };
    }

    if (q.startsWith('update vouchers set uses = uses + 1')) {
      const [code] = params;
      const v = storeState.vouchers.find((item) => item.code === code);
      if (v) {
        v.uses += 1;
        saveStore();
        return { changes: 1, lastInsertRowid: 0 };
      }
      return { changes: 0, lastInsertRowid: 0 };
    }

    if (q.startsWith('insert into redeemed_vouchers')) {
      const [code, user_id, redeemed_at] = params;
      storeState.redeemedVouchers.push({ code, user_id, redeemed_at });
      saveStore();
      return { changes: 1, lastInsertRowid: storeState.redeemedVouchers.length };
    }

    if (q.startsWith('insert into users')) {
      const [id, username, durationMs] = params;
      const existing = storeState.users.find((u) => u.id === id);
      const now = Date.now();
      if (existing) {
        existing.premium = 1;
        const base = existing.premium_expires_at && existing.premium_expires_at > now
          ? existing.premium_expires_at
          : now;
        existing.premium_expires_at = base + Number(durationMs || 0);
      } else {
        storeState.users.push({
          id,
          username,
          avatar: null,
          is_admin: 0,
          premium: 1,
          premium_expires_at: now + Number(durationMs || 0),
          audio_quality: 'high',
          premium_settings: null,
          spotify_access_token: null,
          spotify_refresh_token: null,
          spotify_expires_at: null,
          created_at: now,
        });
      }
      saveStore();
      return { changes: 1, lastInsertRowid: 0 };
    }

    if (q.startsWith('insert into guilds_premium')) {
      const [guild_id, added_by] = params;
      const exists = storeState.guildsPremium.some((g) => g.guild_id === guild_id);
      if (!exists) {
        storeState.guildsPremium.push({ guild_id, added_by, active: 1 });
        saveStore();
        return { changes: 1, lastInsertRowid: 0 };
      }
      return { changes: 0, lastInsertRowid: 0 };
    }

    return { changes: 0, lastInsertRowid: 0 };
  }

  get(...params: any[]) {
    const q = this.query.trim().toLowerCase();

    if (q.startsWith('select * from redeemed_vouchers')) {
      const [code, user_id] = params;
      return (
        storeState.redeemedVouchers.find((r) => r.code === code && r.user_id === user_id) || null
      );
    }

    if (q.startsWith('select * from vouchers')) {
      const [code] = params;
      return storeState.vouchers.find((v) => v.code === code) || null;
    }

    return null;
  }

  all(...params: any[]) {
    const q = this.query.trim().toLowerCase();

    if (q.startsWith('select * from warnings')) {
      const [guild_id, user_id] = params;
      return storeState.warnings.filter((w) => w.guild_id === guild_id && w.user_id === user_id);
    }

    return [];
  }
}

const db = {
  pragma: (_s: string) => {},
  exec: (_s: string) => {},
  prepare: (s: string) => new PreparedStatement(s),
  transaction: (fn: (...args: any[]) => any) => (...args: any[]) => fn(...args),
};

export default db;
