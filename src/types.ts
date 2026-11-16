export type BotStatus = {
  state: 'online' | 'offline';
  guilds: number;
  ping: number;
  tag: string;
  uptime: number;
  mockMode?: boolean;
  inviteUrl?: string;
  supportServerUrl?: string;
  memory?: {
    rss: number;
    heapUsed: number;
  };
};

export type QueueItem = {
  id: string;
  title: string;
  author: string;
  duration: number;
  url?: string;
  videoId?: string;
  thumbnail?: string;
  thumbnailColor?: string;
};

export type HistoryItem = {
  title: string;
  author: string;
  duration: string;
  playedAt: number;
  url: string;
};

export type PlayerStatus = {
  guildId: string;
  guildName: string;
  channelName: string;
  isWebPlayer?: boolean;
  nowPlaying: {
    id?: string;
    title: string;
    author: string;
    duration: number;
    current: number;
    thumbnail: string;
    url?: string;
    videoId?: string;
  } | null;
  queueLength: number;
  queue: QueueItem[];
  history: HistoryItem[];
  state: 'playing' | 'paused';
  volume: number;
};

export type VideoProvider = 'youtube' | 'twitch' | 'vimeo' | 'direct' | 'embed';

export type VideoItem = {
  id: string;
  title: string;
  url: string;
  embedUrl: string;
  provider: VideoProvider;
  addedBy: string;
  addedAt: number;
  thumbnail?: string;
};

export type VideoChannel = {
  id: string;
  name: string;
  discordChannelId?: string;
  currentVideo: VideoItem | null;
  isPlaying: boolean;
  queue: VideoItem[];
  history: VideoItem[];
  updatedAt: number;
};

export type IntegrationProtocol = 'webhook' | 'api_key' | 'oauth2' | 'bot_command';

export type IntegrationDefinition = {
  id: string;
  name: string;
  category: string;
  protocol: IntegrationProtocol;
  description: string;
  docsUrl: string;
  defaultEvents: string[];
  popular?: boolean;
};

export type IntegrationConnection = {
  integrationId: string;
  enabled: boolean;
  endpointUrl: string;
  apiKey: string;
  channelTarget: string;
  events: string[];
  updatedAt: number;
  lastTriggeredAt?: number;
  lastStatus?: string;
};

export const DEFAULT_PREMIUM_SETTINGS = {
  // Player
  loopMode: 'none' as 'none' | 'track' | 'queue',
  shuffleEnabled: false,
  crossfadeSeconds: 0,
  volumeNormalize: false,
  volumeLimit: 100,
  autoplay: false,
  queuePriority: false,
  playbackSpeed: '1.0',
  // Audio Effects
  eqPreset: 'flat' as 'flat' | 'bass' | 'treble' | 'rock' | 'pop' | 'jazz' | 'classical' | 'electronic',
  bassBoost: 0,
  reverbLevel: 0,
  stereoWide: false,
  pitchCorrection: false,
  // Notifications
  nowPlayingEmbed: true,
  notifyQueueEnd: false,
  notifyError: true,
  dmNotifications: false,
  notifyJoin: false,
  weeklyReport: false,
  // UI
  accentColor: 'indigo' as 'indigo' | 'blue' | 'purple' | 'emerald' | 'rose' | 'amber',
  animationsEnabled: true,
  compactMode: false,
  showEqViz: false,
  largeThumbnails: false,
  // AI
  aiRecommendations: false,
  moodAnalysis: false,
  aiAutopilot: false,
  extendedHistory: false,
  aiAssistantEnabled: false,
  // Advanced
  explicitFilter: false,
  ytRegion: 'pl' as 'pl' | 'us' | 'gb' | 'de' | 'fr',
  qualityFallback: true,
  richPresence: false,
  botLanguage: 'pl' as 'pl' | 'en' | 'de' | 'fr',
};

export type PremiumSettings = typeof DEFAULT_PREMIUM_SETTINGS;

export type ChangelogFeature = {
  type: 'new' | 'fix' | 'improvement';
  text: string;
};

export type ChangelogEntry = {
  version: string;
  date: string;
  title?: string;
  features: ChangelogFeature[];
};
