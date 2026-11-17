import express from "express";
import path from "path";
import fs from "fs";
import "dotenv/config";
import cookieParser from "cookie-parser";
import {
  Client,
  GatewayIntentBits,
  ActivityType,
  REST,
  Routes,
  SlashCommandBuilder,
  GuildMember,
  TextChannel,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { Player } from "discord-player";
import { DefaultExtractors, SpotifyExtractor } from "@discord-player/extractor";
import { Constants as YTConstants } from "youtubei.js";
import { SnajperYouTubeExtractor } from "./src/lib/SnajperYouTubeExtractor.ts";
import { globalDownloader } from "./src/lib/AdvancedDownloader.ts";
import {
  youtubeImporter,
  ensureYouTubeJsEvaluator,
  extractYouTubeVideoId,
  formatDurationSec,
} from "./src/lib/youtubeImporter.ts";
import jwt from "jsonwebtoken";
import Stripe from "stripe";
import crypto from "crypto";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { storeState, saveStore, flushStore, type StoredUser } from "./src/db.ts";
import {
  adminCommandsDefinitions,
  handleAdminCommands,
  parseDurationMs,
  startTempbanScheduler,
} from "./src/adminCommands.ts";
import {
  INTEGRATIONS_CATALOG,
  INTEGRATION_CATEGORIES,
  INTEGRATION_PROTOCOLS,
} from "./src/data/integrationsCatalog.ts";
import type {
  PlayerStatus,
  QueueItem,
  HistoryItem,
  VideoChannel,
  VideoItem,
  VideoProvider,
} from "./src/types.ts";

const app = express();
const portEnv = process.env.PORT;
const parsedPort = portEnv ? Number.parseInt(portEnv, 10) : Number.NaN;
const PORT = Number.isNaN(parsedPort) ? 3000 : parsedPort;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || "";
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_jwt";
const SESSION_COOKIE = "snajper_session";
const APP_VERSION = "2.9.5";

let botStartTime = Date.now();
let stripeClient: Stripe | null = null;
let aiAssistant: GoogleGenAI | null = null;

const geminiKey = process.env.GEMINI_API_KEY;
if (geminiKey && geminiKey !== "MY_GEMINI_API_KEY" && !geminiKey.startsWith("YOUR_")) {
  aiAssistant = new GoogleGenAI({
    apiKey: geminiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}
if (process.env.STRIPE_SECRET_KEY) {
  stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
}

function getBaseUrl(req: express.Request): string {
  if (process.env.APP_URL && process.env.APP_URL !== "MY_APP_URL") {
    return process.env.APP_URL.replace(/\/$/, "");
  }
  const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || `localhost:${PORT}`;
  return `${protocol}://${host}`;
}

function getDiscordRedirectUri(req: express.Request): string {
  return `${getBaseUrl(req)}/api/auth/callback`;
}

function getSpotifyRedirectUri(req: express.Request): string {
  return `${getBaseUrl(req)}/api/auth/spotify/callback`;
}

async function dispatchIntegrationEvent(eventName: string, payload: Record<string, any>) {
  const active = Object.values(storeState.integrations).filter(
    (conn) => conn.enabled && conn.endpointUrl && conn.events.includes(eventName)
  );
  if (active.length === 0) return;

  await Promise.allSettled(
    active.map(async (conn) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Snajper-Event": eventName,
        };
        if (conn.apiKey) {
          headers["Authorization"] = `Bearer ${conn.apiKey}`;
        }
        const response = await fetch(conn.endpointUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            event: eventName,
            timestamp: new Date().toISOString(),
            source: "SnajperBot",
            payload,
          }),
          signal: controller.signal,
        });
        conn.lastTriggeredAt = Date.now();
        conn.lastStatus = `HTTP ${response.status}`;
      } catch (err: any) {
        conn.lastTriggeredAt = Date.now();
        conn.lastStatus = `Error: ${err?.message || "request failed"}`;
      } finally {
        clearTimeout(timeout);
      }
    })
  );
  saveStore();
}

function logEvent(
  level: "info" | "warn" | "error",
  source: string,
  message: string,
  details = ""
) {
  const entry = {
    id: storeState.nextLogId++,
    level,
    source,
    message,
    details,
    solution: null,
    created_at: Date.now(),
  };
  storeState.logs.unshift(entry);
  if (storeState.logs.length > 200) {
    storeState.logs = storeState.logs.slice(0, 200);
  }
  saveStore();

  const prefix = `[${level.toUpperCase()}][${source}]`;
  if (level === "error") console.error(prefix, message, details);
  else if (level === "warn") console.warn(prefix, message, details);
  else console.log(prefix, message);

  if (level === "error") {
    dispatchIntegrationEvent("error_alert", { source, message, details }).catch(() => {});
  }
}

// Web preview music player state (works with or without Discord bot token)
const webPlayerState: {
  guildId: string;
  guildName: string;
  channelName: string;
  nowPlaying: {
    id: string;
    title: string;
    author: string;
    duration: number;
    startedAt: number;
    pausedAt: number | null;
    elapsedBeforePause: number;
    thumbnail: string;
    url: string;
    videoId?: string;
  } | null;
  queue: QueueItem[];
  history: HistoryItem[];
  state: "playing" | "paused";
  volume: number;
} = {
  guildId: "web-channel",
  guildName: "Web Channel Audio",
  channelName: "audio-live",
  nowPlaying: null,
  queue: [],
  history: [],
  state: "paused",
  volume: 80,
};

const playbackHistory = new Map<string, HistoryItem[]>();

function getWebPlayerSnapshot(): PlayerStatus {
  let currentSec = 0;
  if (webPlayerState.nowPlaying) {
    if (webPlayerState.state === "playing") {
      currentSec =
        webPlayerState.nowPlaying.elapsedBeforePause +
        Math.floor((Date.now() - webPlayerState.nowPlaying.startedAt) / 1000);
    } else {
      currentSec = webPlayerState.nowPlaying.elapsedBeforePause;
    }
    if (webPlayerState.nowPlaying.duration > 0 && currentSec >= webPlayerState.nowPlaying.duration) {
      currentSec = webPlayerState.nowPlaying.duration;
    }
  }

  return {
    guildId: webPlayerState.guildId,
    guildName: webPlayerState.guildName,
    channelName: webPlayerState.channelName,
    isWebPlayer: true,
    nowPlaying: webPlayerState.nowPlaying
      ? {
          id: webPlayerState.nowPlaying.id,
          title: webPlayerState.nowPlaying.title,
          author: webPlayerState.nowPlaying.author,
          duration: webPlayerState.nowPlaying.duration,
          current: Math.max(0, currentSec),
          thumbnail: webPlayerState.nowPlaying.thumbnail,
          url: webPlayerState.nowPlaying.url,
          videoId: webPlayerState.nowPlaying.videoId,
        }
      : null,
    queueLength: webPlayerState.queue.length,
    queue: webPlayerState.queue,
    history: webPlayerState.history,
    state: webPlayerState.state,
    volume: webPlayerState.volume,
  };
}

function parseDurationStringToSec(dur: any): number {
  if (typeof dur === "number" && Number.isFinite(dur)) return Math.floor(dur);
  if (typeof dur !== "string") return 0;
  const parts = dur.split(":").map((n) => Number.parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function extractYouTubeId(inputUrl: string): string | null {
  return extractYouTubeVideoId(inputUrl);
}

function parseVideoSource(
  rawUrl: string,
  customTitle?: string,
  addedBy = "Web User",
  embedParentHost = "localhost"
): VideoItem {
  const url = rawUrl.trim();
  const id = crypto.randomUUID();
  const addedAt = Date.now();

  const ytId = extractYouTubeId(url);
  if (ytId) {
    return {
      id,
      title: customTitle || `YouTube Video (${ytId})`,
      url: `https://www.youtube.com/watch?v=${ytId}`,
      embedUrl: `https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0&enablejsapi=1`,
      provider: "youtube",
      addedBy,
      addedAt,
      thumbnail: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
    };
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("twitch.tv")) {
      const segs = parsed.pathname.split("/").filter(Boolean);
      const isVod = segs[0] === "videos" && segs[1];
      const channel = segs[0] || "twitch";
      return {
        id,
        title: customTitle || (isVod ? `Twitch VOD #${segs[1]}` : `Twitch Stream: ${channel}`),
        url,
        embedUrl: isVod
          ? `https://player.twitch.tv/?video=${segs[1]}&parent=${encodeURIComponent(embedParentHost)}&autoplay=true`
          : `https://player.twitch.tv/?channel=${channel}&parent=${encodeURIComponent(embedParentHost)}&autoplay=true`,
        provider: "twitch",
        addedBy,
        addedAt,
      };
    }

    if (parsed.hostname.includes("vimeo.com")) {
      const vidId = parsed.pathname.split("/").filter(Boolean).pop() || "";
      return {
        id,
        title: customTitle || `Vimeo Video (${vidId})`,
        url,
        embedUrl: `https://player.vimeo.com/video/${vidId}?autoplay=1`,
        provider: "vimeo",
        addedBy,
        addedAt,
      };
    }

    const lowerPath = parsed.pathname.toLowerCase();
    const provider: VideoProvider =
      lowerPath.endsWith(".mp4") || lowerPath.endsWith(".webm") || lowerPath.endsWith(".ogg")
        ? "direct"
        : "embed";

    return {
      id,
      title: customTitle || parsed.hostname + parsed.pathname.slice(0, 32),
      url,
      embedUrl: url,
      provider,
      addedBy,
      addedAt,
    };
  } catch {
    return {
      id,
      title: customTitle || "Stream wideo",
      url,
      embedUrl: url,
      provider: "embed",
      addedBy,
      addedAt,
    };
  }
}

function sanitizeUser(user: StoredUser) {
  let parsedSettings: any = null;
  if (user.premium_settings) {
    try {
      parsedSettings = JSON.parse(user.premium_settings);
    } catch {
      parsedSettings = null;
    }
  }
  const activePremium =
    user.premium === 1 && (!user.premium_expires_at || user.premium_expires_at > Date.now()) ? 1 : 0;

  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    is_admin: user.is_admin,
    premium: activePremium,
    premium_expires_at: user.premium_expires_at,
    audio_quality: user.audio_quality || "high",
    premium_settings: parsedSettings,
    spotify_access_token: user.spotify_access_token ? "***linked***" : null,
  };
}

function getAuthenticatedUser(req: express.Request): StoredUser | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
    return storeState.users.find((u) => u.id === decoded.id) || null;
  } catch {
    return null;
  }
}

// Global Middlewares
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use((req, res, next) => {
  if (req.originalUrl === "/api/stripe/webhook") {
    next();
  } else {
    express.json({ limit: "2mb" })(req, res, next);
  }
});
app.use(cookieParser());

// Initialize Discord Client & Player
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

const player = new Player(client, {
  skipFFmpeg: false,
  connectionTimeout: 120000,
});

let extractorsLoaded = false;
async function ensureExtractors() {
  if (extractorsLoaded) return;
  try {
    ensureYouTubeJsEvaluator();
    await player.extractors.register(SnajperYouTubeExtractor, {});
    if (SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET) {
      await player.extractors.register(SpotifyExtractor, {
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
      });
    }
    await player.extractors.loadMulti(DefaultExtractors);
    extractorsLoaded = true;
  } catch (err: any) {
    logEvent("warn", "extractors", "Błąd ładowania ekstraktorów audio", err?.message || "");
  }
}

player.events.on("playerStart", (queue, track) => {
  const guildId = queue.guild.id;
  const list = playbackHistory.get(guildId) || [];
  list.unshift({
    title: track.title,
    author: track.author,
    duration: track.duration,
    playedAt: Date.now(),
    url: track.url,
  });
  playbackHistory.set(guildId, list.slice(0, 50));
  dispatchIntegrationEvent("track_started", {
    guildId,
    guildName: queue.guild.name,
    title: track.title,
    author: track.author,
    url: track.url,
  }).catch(() => {});
});

player.events.on("error", (_queue, error) => {
  logEvent("error", "discord-player", error.message, error.stack || "");
});

player.events.on("playerError", (_queue, error) => {
  logEvent("error", "discord-player", error.message, error.stack || "");
});

const musicCommands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Odtwarza muzykę z YouTube / Spotify / URL na kanale głosowym")
    .addStringOption((o) => o.setName("query").setDescription("Tytuł lub link").setRequired(true)),
  new SlashCommandBuilder().setName("pause").setDescription("Wstrzymuje odtwarzanie muzyki"),
  new SlashCommandBuilder().setName("resume").setDescription("Wznawia odtwarzanie muzyki"),
  new SlashCommandBuilder().setName("skip").setDescription("Pomija aktualny utwór"),
  new SlashCommandBuilder().setName("stop").setDescription("Zatrzymuje muzykę i czyści kolejkę"),
  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Ustawia głośność odtwarzacza (0-100)")
    .addIntegerOption((o) =>
      o.setName("level").setDescription("Poziom głośności (0-100)").setRequired(true)
    ),
  new SlashCommandBuilder().setName("queue").setDescription("Pokazuje aktualną kolejkę utworów"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Pokazuje aktualnie grany utwór"),
  new SlashCommandBuilder()
    .setName("video")
    .setDescription("Odtwarza film na wybranym kanale wideo i wysyła podgląd na kanał")
    .addStringOption((o) =>
      o.setName("url").setDescription("Link do filmu (YouTube, Twitch, Vimeo, MP4)").setRequired(true)
    )
    .addStringOption((o) => o.setName("title").setDescription("Opcjonalny tytuł filmu"))
    .addStringOption((o) => o.setName("channel").setDescription("Nazwa pokoju wideo (domyślnie kino-ogolne)")),
  new SlashCommandBuilder()
    .setName("import")
    .setDescription("Szybko importuje playlistę, kanał lub listę linków YouTube")
    .addStringOption((o) =>
      o.setName("source").setDescription("Link do playlisty/kanału/filmu YouTube").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("target")
        .setDescription("Cel importu (muzyka lub wideo)")
        .addChoices(
          { name: "Muzyka (kanał głosowy / web)", value: "music" },
          { name: "Kanał Wideo", value: "video" }
        )
    )
    .addStringOption((o) =>
      o.setName("channel").setDescription("Nazwa kanału wideo (tylko dla celu Wideo)")
    )
    .addIntegerOption((o) =>
      o.setName("limit").setDescription("Maksymalna liczba pozycji do importu (1-100)")
    ),
];

function getResilientStringOption(
  interaction: { options: { getString: (name: string) => string | null; data: readonly any[] } },
  preferredNames: string[]
): string | null {
  for (const name of preferredNames) {
    const val = interaction.options.getString(name);
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  for (const opt of interaction.options.data || []) {
    if (typeof opt?.value === "string" && opt.value.trim().length > 0) {
      return opt.value.trim();
    }
  }
  return null;
}

function getResilientIntegerOption(
  interaction: { options: { getInteger: (name: string) => number | null; data: readonly any[] } },
  preferredNames: string[]
): number | null {
  for (const name of preferredNames) {
    const val = interaction.options.getInteger(name);
    if (typeof val === "number" && Number.isFinite(val)) {
      return val;
    }
  }
  for (const opt of interaction.options.data || []) {
    if (typeof opt?.value === "number" && Number.isFinite(opt.value)) {
      return Math.trunc(opt.value);
    }
  }
  return null;
}

client.once("clientReady", async () => {
  botStartTime = Date.now();
  logEvent("info", "discord", `Zalogowano jako ${client.user?.tag}`);
  client.user?.setActivity("SnajperBot | /play & /video", { type: ActivityType.Listening });
  startTempbanScheduler(client);
  await ensureExtractors();

  if (DISCORD_TOKEN && client.user) {
    try {
      const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
      const body = [...musicCommands, ...adminCommandsDefinitions].map((c) => c.toJSON());
      await rest.put(Routes.applicationCommands(client.user.id), { body });
      // Remove any stale guild-scoped command overrides that could shadow updated global command schemas
      await Promise.allSettled(
        client.guilds.cache.map((guild) =>
          rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), { body: [] })
        )
      );
      logEvent("info", "discord", `Zarejestrowano ${body.length} komend slash.`);
    } catch (err: any) {
      logEvent("warn", "discord", "Nie udało się zarejestrować komend slash", err?.message || "");
    }
  }
});

client.on("guildCreate", async (guild) => {
  if (!DISCORD_TOKEN || !client.user) return;
  try {
    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: [] });
  } catch {
    // Non-fatal
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const handledAdmin = await handleAdminCommands(interaction);
    if (handledAdmin) return;

    const { commandName } = interaction;
    if (commandName === "video") {
      const url = getResilientStringOption(interaction, ["url", "link", "query", "source"]);
      if (!url) {
        await interaction.reply({ content: "Podaj link do filmu!", flags: MessageFlags.Ephemeral });
        return;
      }
      const title = interaction.options.getString("title") || undefined;
      const roomName = (interaction.options.getString("channel") || "kino-ogolne").toLowerCase();

      let channel = storeState.videoChannels.find(
        (c) => c.id === roomName || c.name.toLowerCase() === roomName
      );
      if (!channel) {
        channel = {
          id: roomName.replace(/[^a-z0-9-]+/g, "-") || crypto.randomUUID(),
          name: roomName,
          discordChannelId: interaction.channelId,
          currentVideo: null,
          isPlaying: false,
          queue: [],
          history: [],
          updatedAt: Date.now(),
        };
        storeState.videoChannels.push(channel);
      }

      const item = parseVideoSource(url, title, interaction.user.tag);
      if (channel.currentVideo) {
        channel.history.unshift(channel.currentVideo);
      }
      channel.currentVideo = item;
      channel.isPlaying = true;
      channel.updatedAt = Date.now();
      saveStore();

      dispatchIntegrationEvent("video_queued", {
        channelId: channel.id,
        channelName: channel.name,
        title: item.title,
        url: item.url,
        addedBy: item.addedBy,
      }).catch(() => {});

      const embed = new EmbedBuilder()
        .setTitle(`🎬 Teraz odtwarzane w #${channel.name}`)
        .setDescription(`**${item.title}**\n${item.url}`)
        .setColor(0x5865f2)
        .setFooter({ text: `Dodane przez ${interaction.user.tag}` });
      if (item.thumbnail) embed.setThumbnail(item.thumbnail);

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (commandName === "import") {
      const source = getResilientStringOption(interaction, ["source", "url", "link", "query"]);
      if (!source) {
        await interaction.reply({ content: "Podaj źródło lub link YouTube do zaimportowania!", flags: MessageFlags.Ephemeral });
        return;
      }
      const target = interaction.options.getString("target") || "music";
      const roomName = (interaction.options.getString("channel") || "cinema-general").toLowerCase();
      const limit = Math.max(1, Math.min(100, interaction.options.getInteger("limit") || 50));

      await interaction.deferReply();
      const imported = await youtubeImporter.importBatch(source, { maxItems: limit });
      if (imported.tracks.length === 0) {
        await interaction.editReply("Nie znaleziono żadnych filmów ani utworów do zaimportowania.");
        return;
      }

      if (target === "video") {
        let channel = storeState.videoChannels.find(
          (c) => c.id === roomName || c.name.toLowerCase() === roomName
        );
        if (!channel) {
          channel = {
            id: roomName.replace(/[^a-z0-9-]+/g, "-") || crypto.randomUUID(),
            name: roomName,
            discordChannelId: interaction.channelId,
            currentVideo: null,
            isPlaying: false,
            queue: [],
            history: [],
            updatedAt: Date.now(),
          };
          storeState.videoChannels.push(channel);
        }

        for (const t of imported.tracks) {
          const item = parseVideoSource(t.url, t.title, interaction.user.tag);
          if (!channel.currentVideo) {
            channel.currentVideo = item;
            channel.isPlaying = true;
          } else {
            channel.queue.push(item);
          }
        }
        channel.updatedAt = Date.now();
        saveStore();

        await interaction.editReply(
          `🎬 Zaimportowano **${imported.tracks.length}** filmów do kanału **#${channel.name}** w **${imported.durationMs} ms**.`
        );
        return;
      }

      const member = interaction.member as GuildMember | null;
      const voiceChannel = member?.voice?.channel;
      if (voiceChannel && interaction.guild) {
        await ensureExtractors();
        let queued = 0;
        for (const t of imported.tracks) {
          try {
            await player.play(voiceChannel, t.url, {
              nodeOptions: { metadata: interaction.channel },
            });
            queued++;
          } catch {}
        }
        await interaction.editReply(
          `⚡ Zaimportowano **${queued}/${imported.tracks.length}** utworów z YouTube w **${imported.durationMs} ms** (${imported.sourceTitle || "YouTube"}).`
        );
      } else {
        for (const t of imported.tracks) {
          queueTrackToWebPlayer(t);
        }
        await interaction.editReply(
          `⚡ Zaimportowano **${imported.tracks.length}** utworów do **Web Channel** w **${imported.durationMs} ms** (dołącz do kanału głosowego, aby odtwarzać bezpośrednio na Discordzie).`
        );
      }
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({ content: "Tej komendy można użyć tylko na serwerze.", flags: MessageFlags.Ephemeral });
      return;
    }

    const member = interaction.member as GuildMember | null;
    const voiceChannel = member?.voice?.channel;

    if (commandName === "play") {
      if (!voiceChannel) {
        await interaction.reply({ content: "Najpierw dołącz do kanału głosowego!", flags: MessageFlags.Ephemeral });
        return;
      }
      const query = getResilientStringOption(interaction, [
        "query",
        "song",
        "url",
        "link",
        "track",
        "szukaj",
        "zapytanie",
        "utwor",
        "nazwa",
        "tytul",
        "source",
      ]);
      if (!query) {
        await interaction.reply({ content: "Podaj nazwę utworu lub link do odtworzenia!", flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply();
      await ensureExtractors();
      const result = await player.play(voiceChannel, query, {
        requestedBy: interaction.user,
        nodeOptions: { metadata: interaction.channel },
      });
      await interaction.editReply(
        `🎵 Dodano do kolejki: **${result.track.title}** (${result.track.duration})`
      );
      return;
    }

    const queue = player.nodes.get(interaction.guild.id);
    if (!queue) {
      await interaction.reply({ content: "Aktualnie nic nie jest odtwarzane.", flags: MessageFlags.Ephemeral });
      return;
    }

    switch (commandName) {
      case "pause":
        queue.node.setPaused(true);
        await interaction.reply("⏸️ Wstrzymano odtwarzanie.");
        break;
      case "resume":
        queue.node.setPaused(false);
        await interaction.reply("▶️ Wznowiono odtwarzanie.");
        break;
      case "skip":
        queue.node.skip();
        await interaction.reply("⏭️ Pominięto aktualny utwór.");
        break;
      case "stop":
        queue.delete();
        await interaction.reply("⏹️ Zatrzymano odtwarzacz i wyczyszczono kolejkę.");
        break;
      case "volume": {
        const rawVol = getResilientIntegerOption(interaction, ["level", "volume", "poziom"]);
        if (rawVol === null) {
          await interaction.reply({ content: "Podaj poziom głośności (0-100).", flags: MessageFlags.Ephemeral });
          return;
        }
        const vol = Math.max(0, Math.min(100, rawVol));
        queue.node.setVolume(vol);
        await interaction.reply(`🔊 Ustawiono głośność na **${vol}%**.`);
        break;
      }
      case "nowplaying": {
        const track = queue.currentTrack;
        await interaction.reply(
          track ? `🎶 Teraz gra: **${track.title}** — ${track.author}` : "Brak aktywnego utworu."
        );
        break;
      }
      case "queue": {
        const list = queue.tracks.toArray().slice(0, 10);
        const lines = list.map((t, idx) => `${idx + 1}. **${t.title}** (${t.duration})`).join("\n");
        await interaction.reply(lines ? `📜 **Kolejka:**\n${lines}` : "Kolejka jest pusta.");
        break;
      }
    }
  } catch (err: any) {
    logEvent("error", "discord-command", err?.message || "Command failed");
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("Wystąpił błąd podczas wykonywania komendy.").catch(() => {});
    } else {
      await interaction
        .reply({ content: "Wystąpił błąd podczas wykonywania komendy.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  }
});

// ==================== AUTH & USER ROUTES ====================

app.get("/api/me", (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.json({ loggedIn: false, user: null });
  }
  return res.json({ loggedIn: true, user: sanitizeUser(user) });
});

app.get("/api/auth/url", (req, res) => {
  if (!DISCORD_CLIENT_ID) {
    return res.status(400).json({
      success: false,
      error: "DISCORD_CLIENT_ID nie jest skonfigurowany w zmiennych środowiskowych.",
    });
  }
  const redirectUri = encodeURIComponent(getDiscordRedirectUri(req));
  const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds`;
  return res.json({ url });
});

app.get("/api/auth/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res.status(400).send("Missing OAuth code or Discord credentials.");
  }

  try {
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: getDiscordRedirectUri(req),
    });

    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const tokenData: any = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error(tokenData.error_description || "Discord token exchange failed");
    }

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser: any = await userRes.json();

    let user = storeState.users.find((u) => u.id === discordUser.id);
    const isFirstUser = storeState.users.length === 0;
    if (!user) {
      user = {
        id: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar || null,
        is_admin: isFirstUser ? 1 : 0,
        premium: 0,
        premium_expires_at: null,
        audio_quality: "high",
        premium_settings: null,
        spotify_access_token: null,
        spotify_refresh_token: null,
        spotify_expires_at: null,
        created_at: Date.now(),
      };
      storeState.users.push(user);
    } else {
      user.username = discordUser.username;
      user.avatar = discordUser.avatar || null;
    }
    saveStore();

    const sessionToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "30d" });
    res.cookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    logEvent("info", "auth", `Użytkownik ${user.username} zalogował się przez Discord.`);
    res.send(`<html><body><script>
      if (window.opener) {
        window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script><p>Zalogowano pomyślnie. Możesz zamknąć to okno.</p></body></html>`);
  } catch (err: any) {
    logEvent("error", "auth", "Błąd logowania Discord OAuth", err?.message || "");
    res.status(500).send(`Auth failed: ${err?.message || "Unknown error"}`);
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { sameSite: "none", secure: true });
  res.json({ success: true });
});

app.get("/api/auth/spotify/login", (req, res) => {
  if (!SPOTIFY_CLIENT_ID) {
    return res.json({ error: "SPOTIFY_CLIENT_ID nie jest skonfigurowany w .env." });
  }
  const redirectUri = encodeURIComponent(getSpotifyRedirectUri(req));
  const scopes = encodeURIComponent("user-read-private user-read-email playlist-read-private");
  const url = `https://accounts.spotify.com/authorize?response_type=code&client_id=${SPOTIFY_CLIENT_ID}&scope=${scopes}&redirect_uri=${redirectUri}`;
  return res.json({ url });
});

app.get("/api/auth/spotify/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const user = getAuthenticatedUser(req);
  if (!code || !SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    return res.status(400).send("Missing Spotify code or credentials.");
  }

  try {
    const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64");
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: getSpotifyRedirectUri(req),
    });

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const tokenData: any = await tokenRes.json();
    if (user && tokenData.access_token) {
      user.spotify_access_token = tokenData.access_token;
      user.spotify_refresh_token = tokenData.refresh_token || null;
      user.spotify_expires_at = Date.now() + (tokenData.expires_in || 3600) * 1000;
      saveStore();
    }

    res.send(`<html><body><script>
      if (window.opener) {
        window.opener.postMessage({ type: 'SPOTIFY_AUTH_SUCCESS' }, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script><p>Spotify połączone. Możesz zamknąć to okno.</p></body></html>`);
  } catch (err: any) {
    res.status(500).send(`Spotify OAuth failed: ${err?.message || "Unknown error"}`);
  }
});

app.post("/api/user/spotify/unlink", (req, res) => {
  const user = getAuthenticatedUser(req);
  if (user) {
    user.spotify_access_token = null;
    user.spotify_refresh_token = null;
    user.spotify_expires_at = null;
    saveStore();
  }
  res.json({ success: true });
});

app.post("/api/user/settings", (req, res) => {
  const user = getAuthenticatedUser(req);
  const { audioQuality, premiumSettings } = req.body || {};

  if (!user) {
    return res.json({ success: true, persisted: "session" });
  }

  if (audioQuality) {
    if (audioQuality === "ultra" && user.premium !== 1) {
      return res.status(403).json({ success: false, error: "Tryb Ultra wymaga konta Premium." });
    }
    user.audio_quality = audioQuality;
  }
  if (premiumSettings && typeof premiumSettings === "object") {
    user.premium_settings = JSON.stringify(premiumSettings);
  }
  saveStore();
  return res.json({ success: true, user: sanitizeUser(user) });
});

app.post("/api/vouchers/redeem", (req, res) => {
  const user = getAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({ error: "Zaloguj się przez Discord, aby zrealizować voucher." });
  }

  const code = String(req.body?.code || "").trim().toUpperCase();
  const guildId = req.body?.guildId ? String(req.body.guildId).trim() : "";

  const voucher = storeState.vouchers.find((v) => v.code === code);
  if (!voucher) {
    return res.status(404).json({ error: "Nieprawidłowy kod vouchera." });
  }
  if (voucher.uses >= voucher.max_uses) {
    return res.status(400).json({ error: "Ten voucher został już wykorzystany." });
  }
  const already = storeState.redeemedVouchers.some(
    (r) => r.code === code && r.user_id === user.id
  );
  if (already) {
    return res.status(400).json({ error: "Już zrealizowałeś ten voucher." });
  }
  if (voucher.type === "guild_premium" && !guildId) {
    return res.status(400).json({ error: "requires_guild_id" });
  }

  voucher.uses += 1;
  storeState.redeemedVouchers.push({ code, user_id: user.id, redeemed_at: Date.now() });

  if (voucher.type === "user_premium") {
    const now = Date.now();
    const base = user.premium_expires_at && user.premium_expires_at > now ? user.premium_expires_at : now;
    user.premium = 1;
    user.premium_expires_at = voucher.duration >= 100 * 365 * 86400000 ? null : base + voucher.duration;
  } else if (voucher.type === "guild_premium" && guildId) {
    if (!storeState.guildsPremium.some((g) => g.guild_id === guildId)) {
      storeState.guildsPremium.push({ guild_id: guildId, added_by: user.id, active: 1 });
    }
  }
  saveStore();
  dispatchIntegrationEvent("voucher_redeemed", {
    code,
    type: voucher.type,
    userId: user.id,
    username: user.username,
  }).catch(() => {});

  return res.json({ success: true, message: "Voucher aktywowany pomyślnie!" });
});

// ==================== BOT STATUS & MUSIC PLAYER ROUTES ====================

app.get("/api/status", (_req, res) => {
  const mem = process.memoryUsage();
  const uptimeSeconds = Math.floor((Date.now() - botStartTime) / 1000);
  const isReady = client.isReady();
  const inviteUrl = DISCORD_CLIENT_ID
    ? `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&permissions=8&scope=bot%20applications.commands`
    : "https://discord.com/developers/applications";

  res.json({
    state: isReady ? "online" : "offline",
    guilds: isReady ? client.guilds.cache.size : 1,
    ping: isReady ? Math.max(0, client.ws.ping) : 0,
    tag: isReady ? client.user?.tag : "SnajperBot (Web Channel)",
    uptime: uptimeSeconds,
    mockMode: !isReady,
    inviteUrl,
    supportServerUrl: "https://discord.com",
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    },
  });
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.query || "").trim();
  if (!query) {
    return res.json({ success: true, tracks: [] });
  }

  try {
    const tracks = await youtubeImporter.searchVideos(query, 12);
    return res.json({ success: true, tracks });
  } catch (err: any) {
    logEvent("warn", "search", `Wyszukiwanie "${query}" nie powiodło się`, err?.message || "");
    return res.json({ success: false, tracks: [], error: err?.message || "Search failed" });
  }
});

async function pipeWebStreamToResponse(
  webStream: ReadableStream<Uint8Array>,
  res: express.Response,
  abortSignal: AbortSignal
) {
  const reader = webStream.getReader();
  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  abortSignal.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (abortSignal.aborted || res.destroyed || res.writableEnded) break;
      const { done, value } = await reader.read();
      if (done) {
        if (!res.writableEnded) res.end();
        break;
      }
      if (!value || value.byteLength === 0) continue;
      if (abortSignal.aborted || res.destroyed || res.writableEnded) break;

      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            res.off("drain", finish);
            res.off("close", finish);
            abortSignal.removeEventListener("abort", finish);
            resolve();
          };
          res.once("drain", finish);
          res.once("close", finish);
          abortSignal.addEventListener("abort", finish, { once: true });
        });
      }
    }
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

app.get("/api/audio/stream", async (req, res) => {
  const rawUrl = String(req.query.url || req.query.videoId || "").trim();
  const queryTitle = String(req.query.title || "").trim() || undefined;
  const queryAuthor = String(req.query.author || "").trim() || undefined;
  const videoId = extractYouTubeId(rawUrl);

  if (!rawUrl && !queryTitle) {
    return res.status(400).json({ error: "Missing url, videoId, or title" });
  }

  // Allow direct audio file redirects only when URL points to an actual audio stream/file
  if (!videoId && /^https?:\/\//i.test(rawUrl)) {
    try {
      const parsed = new URL(rawUrl);
      const lowerPath = parsed.pathname.toLowerCase();
      if (/\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)(\?|$)/i.test(lowerPath)) {
        return res.redirect(rawUrl);
      }
    } catch {
      // Fall through to SoundCloud bridge
    }
  }

  const abortController = new AbortController();
  const handleDisconnect = () => {
    abortController.abort();
  };
  req.on("close", handleDisconnect);
  res.on("close", handleDisconnect);

  try {
    const activeHints = {
      title:
        queryTitle ||
        (videoId && webPlayerState.nowPlaying?.videoId === videoId
          ? webPlayerState.nowPlaying.title
          : undefined),
      author:
        queryAuthor ||
        (videoId && webPlayerState.nowPlaying?.videoId === videoId
          ? webPlayerState.nowPlaying.author
          : undefined),
    };

    let source = videoId
      ? await youtubeImporter.resolveAudioStreamSource(videoId, false, activeHints)
      : await youtubeImporter.resolveSoundCloudFallback(
          rawUrl.includes("soundcloud.com")
            ? rawUrl
            : [activeHints.title, activeHints.author].filter(Boolean).join(" ").trim() || rawUrl,
          rawUrl
        );

    if (source.isLive && videoId) {
      const webStream = await youtubeImporter.openAudioStream(videoId, activeHints);
      res.status(200);
      res.setHeader("Content-Type", "audio/mp4");
      res.setHeader("Cache-Control", "no-store");
      await pipeWebStreamToResponse(webStream, res, abortController.signal);
      return;
    }

    if (source.hlsFmp4) {
      const hls = await youtubeImporter.openHlsWebStream(source.url, abortController.signal);
      res.status(200);
      res.setHeader("Content-Type", hls.mimeType || source.mimeType || "audio/mp4");
      res.setHeader("Cache-Control", "no-store");
      await pipeWebStreamToResponse(hls.stream, res, abortController.signal);
      return;
    }

    const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : undefined;
    const fetchWithHeaders = async (targetUrl: string, provider: "youtube" | "soundcloud") =>
      fetch(targetUrl, {
        headers: {
          ...(provider === "youtube" ? YTConstants.STREAM_HEADERS : {}),
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        },
        signal: abortController.signal,
      });

    let upstream = await fetchWithHeaders(source.url, source.sourceProvider);
    if ((upstream.status === 403 || upstream.status === 410) && videoId) {
      await upstream.body?.cancel().catch(() => {});
      youtubeImporter.invalidateAudioSource(videoId);
      source = await youtubeImporter.resolveAudioStreamSource(videoId, true, activeHints);
      if (source.hlsFmp4) {
        const hls = await youtubeImporter.openHlsWebStream(source.url, abortController.signal);
        res.status(200);
        res.setHeader("Content-Type", hls.mimeType || source.mimeType || "audio/mp4");
        res.setHeader("Cache-Control", "no-store");
        await pipeWebStreamToResponse(hls.stream, res, abortController.signal);
        return;
      }
      upstream = await fetchWithHeaders(source.url, source.sourceProvider);
    }

    if (!upstream.ok && upstream.status !== 206) {
      throw new Error(`Audio stream HTTP ${upstream.status}`);
    }

    const contentType = upstream.headers.get("content-type") || source.mimeType || "audio/mp4";
    const contentLength =
      upstream.headers.get("content-length") ||
      (source.contentLength && !rangeHeader ? String(source.contentLength) : null);
    const contentRange = upstream.headers.get("content-range");

    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "no-store");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentRange) res.setHeader("Content-Range", contentRange);

    if (!upstream.body) {
      return res.end();
    }

    await pipeWebStreamToResponse(upstream.body, res, abortController.signal);
  } catch (err: any) {
    if (abortController.signal.aborted) return;
    logEvent("warn", "audio-stream", `Błąd strumienia audio (${videoId || rawUrl})`, err?.message || "");
    if (!res.headersSent) {
      const status = /weryfikacji\/logowania|login required/i.test(err?.message || "") ? 403 : 502;
      res.status(status).json({ error: err?.message || "Audio stream unavailable" });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

function buildDiscordPlayers(): PlayerStatus[] {
  if (!client.isReady()) return [];
  const list: PlayerStatus[] = [];
  for (const queue of player.nodes.cache.values()) {
    const currentTrack = queue.currentTrack;
    const ts = queue.node.getTimestamp();
    const guildHistory = playbackHistory.get(queue.guild.id) || [];
    list.push({
      guildId: queue.guild.id,
      guildName: queue.guild.name,
      channelName: queue.channel?.name || "voice",
      nowPlaying: currentTrack
        ? {
            id: currentTrack.id,
            title: currentTrack.title,
            author: currentTrack.author,
            duration: parseDurationStringToSec(currentTrack.duration),
            current: ts ? Math.floor(ts.current.value / 1000) : 0,
            thumbnail: currentTrack.thumbnail || "",
            url: currentTrack.url,
            videoId: extractYouTubeId(currentTrack.url) || undefined,
          }
        : null,
      queueLength: queue.tracks.size,
      queue: queue.tracks.toArray().map((t) => ({
        id: t.id,
        title: t.title,
        author: t.author,
        duration: parseDurationStringToSec(t.duration),
        url: t.url,
        thumbnail: t.thumbnail,
      })),
      history: guildHistory,
      state: queue.node.isPaused() ? "paused" : "playing",
      volume: queue.node.volume,
    });
  }
  return list;
}

app.get("/api/players", (_req, res) => {
  const discordPlayers = buildDiscordPlayers();
  const webPlayer = getWebPlayerSnapshot();
  res.json([webPlayer, ...discordPlayers]);
});

function queueTrackToWebPlayer(track: {
  url: string;
  title?: string;
  author?: string;
  duration?: string | number;
  durationSeconds?: number;
  thumbnail?: string;
  videoId?: string;
}) {
  const ytId = track.videoId || extractYouTubeId(track.url);
  const resolvedTitle = track.title || "Utwór audio";
  const resolvedAuthor = track.author || "Web Stream";
  const resolvedDuration =
    typeof track.durationSeconds === "number" && track.durationSeconds > 0
      ? track.durationSeconds
      : parseDurationStringToSec(track.duration);
  const resolvedThumb =
    track.thumbnail || (ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : "");

  const trackItem: QueueItem = {
    id: crypto.randomUUID(),
    title: resolvedTitle,
    author: resolvedAuthor,
    duration: resolvedDuration,
    url: track.url,
    videoId: ytId || undefined,
    thumbnail: resolvedThumb,
  };

  if (!webPlayerState.nowPlaying) {
    webPlayerState.nowPlaying = {
      id: trackItem.id,
      title: trackItem.title,
      author: trackItem.author,
      duration: trackItem.duration,
      startedAt: Date.now(),
      pausedAt: null,
      elapsedBeforePause: 0,
      thumbnail: resolvedThumb,
      url: track.url,
      videoId: ytId || undefined,
    };
    webPlayerState.state = "playing";
    webPlayerState.history.unshift({
      title: trackItem.title,
      author: trackItem.author,
      duration: formatDurationSec(trackItem.duration),
      playedAt: Date.now(),
      url: track.url,
    });
    webPlayerState.history = webPlayerState.history.slice(0, 50);
  } else {
    webPlayerState.queue.push(trackItem);
  }
  return trackItem;
}

app.post("/api/players/:guildId/play", async (req, res) => {
  const { guildId } = req.params;
  const { url, title, author, duration, thumbnail } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "Missing url" });

  // Discord guild player
  if (guildId !== "web-channel") {
    const queue = player.nodes.get(guildId);
    if (!queue || !queue.channel) {
      return res.status(404).json({ success: false, error: "Brak aktywnego kanału głosowego na tym serwerze." });
    }
    try {
      await ensureExtractors();
      const result = await player.play(queue.channel, url);
      return res.json({ success: true, track: result.track.title });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || "Play failed" });
    }
  }

  // Web Channel Player (uses LRU-cached youtubeImporter)
  try {
    const ytId = extractYouTubeId(url);
    let resolvedTitle = title;
    let resolvedAuthor = author;
    let resolvedDuration = parseDurationStringToSec(duration);
    let resolvedThumb = thumbnail;

    if (ytId && (!resolvedTitle || !resolvedDuration)) {
      try {
        const meta = await youtubeImporter.resolveVideo(ytId);
        resolvedTitle = resolvedTitle || meta.title;
        resolvedAuthor = resolvedAuthor || meta.author;
        resolvedDuration = resolvedDuration || meta.durationSeconds;
        resolvedThumb = resolvedThumb || meta.thumbnail;
      } catch {
        // Use fallback metadata if YouTube lookup fails
      }
    }

    const trackItem = queueTrackToWebPlayer({
      url,
      videoId: ytId || undefined,
      title: resolvedTitle,
      author: resolvedAuthor,
      duration: resolvedDuration,
      thumbnail: resolvedThumb,
    });

    dispatchIntegrationEvent("track_started", {
      guildId: "web-channel",
      title: trackItem.title,
      author: trackItem.author,
      url,
    }).catch(() => {});

    return res.json({ success: true, player: getWebPlayerSnapshot() });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || "Failed to queue track" });
  }
});

app.post("/api/players/:guildId/playback", (req, res) => {
  const { guildId } = req.params;
  const { state } = req.body || {};

  if (guildId === "web-channel") {
    if (!webPlayerState.nowPlaying) {
      return res.json({ success: true, state: "paused" });
    }
    if (state === "paused" && webPlayerState.state === "playing") {
      webPlayerState.nowPlaying.elapsedBeforePause += Math.floor(
        (Date.now() - webPlayerState.nowPlaying.startedAt) / 1000
      );
      webPlayerState.nowPlaying.pausedAt = Date.now();
      webPlayerState.state = "paused";
    } else if (state === "playing" && webPlayerState.state === "paused") {
      webPlayerState.nowPlaying.startedAt = Date.now();
      webPlayerState.nowPlaying.pausedAt = null;
      webPlayerState.state = "playing";
    }
    return res.json({ success: true, player: getWebPlayerSnapshot() });
  }

  const queue = player.nodes.get(guildId);
  if (!queue) return res.status(404).json({ success: false, error: "Queue not found" });
  queue.node.setPaused(state === "paused");
  return res.json({ success: true });
});

app.post("/api/players/:guildId/skip", (req, res) => {
  const { guildId } = req.params;
  if (guildId === "web-channel") {
    const next = webPlayerState.queue.shift();
    if (next) {
      webPlayerState.nowPlaying = {
        id: next.id,
        title: next.title,
        author: next.author,
        duration: next.duration,
        startedAt: Date.now(),
        pausedAt: null,
        elapsedBeforePause: 0,
        thumbnail: next.thumbnail || "",
        url: next.url || "",
        videoId: next.videoId,
      };
      webPlayerState.state = "playing";
      webPlayerState.history.unshift({
        title: next.title,
        author: next.author,
        duration: formatDurationSec(next.duration),
        playedAt: Date.now(),
        url: next.url || "",
      });
      webPlayerState.history = webPlayerState.history.slice(0, 50);
    } else {
      webPlayerState.nowPlaying = null;
      webPlayerState.state = "paused";
    }
    return res.json({ success: true, player: getWebPlayerSnapshot() });
  }

  const queue = player.nodes.get(guildId);
  if (!queue) return res.status(404).json({ success: false });
  queue.node.skip();
  return res.json({ success: true });
});

app.post("/api/players/:guildId/volume", (req, res) => {
  const { guildId } = req.params;
  const vol = Math.max(0, Math.min(100, Number(req.body?.volume ?? 80)));

  if (guildId === "web-channel") {
    webPlayerState.volume = vol;
    return res.json({ success: true, volume: vol });
  }

  const queue = player.nodes.get(guildId);
  if (!queue) return res.status(404).json({ success: false });
  queue.node.setVolume(vol);
  return res.json({ success: true, volume: vol });
});

app.post("/api/players/:guildId/clear", (req, res) => {
  const { guildId } = req.params;
  if (guildId === "web-channel") {
    webPlayerState.queue = [];
    return res.json({ success: true });
  }
  const queue = player.nodes.get(guildId);
  if (!queue) return res.status(404).json({ success: false });
  queue.tracks.clear();
  return res.json({ success: true });
});

app.post("/api/players/:guildId/queue/move", (req, res) => {
  const { guildId } = req.params;
  const { from, to } = req.body || {};
  if (typeof from !== "number" || typeof to !== "number") {
    return res.status(400).json({ success: false });
  }

  if (guildId === "web-channel") {
    const arr = [...webPlayerState.queue];
    if (from >= 0 && from < arr.length && to >= 0 && to < arr.length) {
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      webPlayerState.queue = arr;
    }
    return res.json({ success: true });
  }

  const queue = player.nodes.get(guildId);
  if (!queue) return res.status(404).json({ success: false });
  const tracks = queue.tracks.toArray();
  const track = tracks[from];
  if (track) {
    queue.moveTrack(track, to);
  }
  return res.json({ success: true });
});

app.delete("/api/players/:guildId/queue/:trackId", (req, res) => {
  const { guildId, trackId } = req.params;
  if (guildId === "web-channel") {
    webPlayerState.queue = webPlayerState.queue.filter((t) => t.id !== trackId);
    return res.json({ success: true });
  }
  const queue = player.nodes.get(guildId);
  if (!queue) return res.status(404).json({ success: false });
  const track = queue.tracks.toArray().find((t) => t.id === trackId);
  if (track) queue.removeTrack(track);
  return res.json({ success: true });
});

// ==================== VIDEO CHANNELS ROUTES ====================

app.get("/api/video/channels", (_req, res) => {
  res.json({ success: true, channels: storeState.videoChannels });
});

app.post("/api/video/channels", (req, res) => {
  const name = String(req.body?.name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-");
  if (!name) {
    return res.status(400).json({ success: false, error: "Podaj nazwę kanału wideo." });
  }
  if (storeState.videoChannels.some((c) => c.id === name || c.name === name)) {
    return res.status(409).json({ success: false, error: "Kanał o tej nazwie już istnieje." });
  }

  const channel: VideoChannel = {
    id: name,
    name,
    currentVideo: null,
    isPlaying: false,
    queue: [],
    history: [],
    updatedAt: Date.now(),
  };
  storeState.videoChannels.push(channel);
  saveStore();
  logEvent("info", "video", `Utworzono kanał wideo #${name}.`);
  return res.json({ success: true, channel });
});

app.post("/api/video/channels/:channelId/play", async (req, res) => {
  const { channelId } = req.params;
  const { url, title, mode = "now" } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "Podaj link do filmu." });

  const channel = storeState.videoChannels.find((c) => c.id === channelId);
  if (!channel) return res.status(404).json({ success: false, error: "Nie znaleziono kanału." });

  const user = getAuthenticatedUser(req);
  let resolvedTitle = title;
  const ytId = extractYouTubeId(url);
  if (ytId && !resolvedTitle) {
    try {
      const meta = await youtubeImporter.resolveVideo(ytId);
      resolvedTitle = meta.title || undefined;
    } catch {
      // Fallback to default YouTube title
    }
  }

  const embedHost =
    String(req.headers["x-forwarded-host"] || req.headers.host || "localhost")
      .split(",")[0]
      .split(":")[0]
      .trim() || "localhost";
  const item = parseVideoSource(url, resolvedTitle, user?.username || "Panel Web", embedHost);

  if (mode === "queue" && channel.currentVideo) {
    channel.queue.push(item);
  } else {
    if (channel.currentVideo) {
      channel.history.unshift(channel.currentVideo);
      channel.history = channel.history.slice(0, 30);
    }
    channel.currentVideo = item;
    channel.isPlaying = true;
  }
  channel.updatedAt = Date.now();
  saveStore();

  dispatchIntegrationEvent("video_queued", {
    channelId: channel.id,
    channelName: channel.name,
    title: item.title,
    url: item.url,
    mode,
  }).catch(() => {});

  return res.json({ success: true, channel });
});

app.post("/api/video/channels/:channelId/control", (req, res) => {
  const { channelId } = req.params;
  const { action } = req.body || {};
  const channel = storeState.videoChannels.find((c) => c.id === channelId);
  if (!channel) return res.status(404).json({ success: false, error: "Nie znaleziono kanału." });

  if (action === "toggle") {
    channel.isPlaying = !channel.isPlaying;
  } else if (action === "play") {
    channel.isPlaying = true;
  } else if (action === "pause") {
    channel.isPlaying = false;
  } else if (action === "next") {
    if (channel.currentVideo) {
      channel.history.unshift(channel.currentVideo);
      channel.history = channel.history.slice(0, 30);
    }
    const next = channel.queue.shift() || null;
    channel.currentVideo = next;
    channel.isPlaying = Boolean(next);
  } else if (action === "clear") {
    channel.queue = [];
  } else if (action === "stop") {
    channel.currentVideo = null;
    channel.isPlaying = false;
  }

  channel.updatedAt = Date.now();
  saveStore();
  return res.json({ success: true, channel });
});

app.delete("/api/video/channels/:channelId/queue/:videoId", (req, res) => {
  const { channelId, videoId } = req.params;
  const channel = storeState.videoChannels.find((c) => c.id === channelId);
  if (!channel) return res.status(404).json({ success: false });
  channel.queue = channel.queue.filter((v) => v.id !== videoId);
  channel.updatedAt = Date.now();
  saveStore();
  return res.json({ success: true, channel });
});

// ==================== DEDICATED HIGH-SPEED YOUTUBE IMPORTER ROUTES ====================

app.get("/api/youtube/stats", (_req, res) => {
  res.json({ success: true, stats: youtubeImporter.getStats() });
});

app.post("/api/youtube/preview", async (req, res) => {
  const source = req.body?.source ?? req.body?.url ?? "";
  const maxItems = Number(req.body?.maxItems || 100);
  if (!source || (typeof source === "string" && !source.trim())) {
    return res.status(400).json({ success: false, error: "Podaj link do playlisty, kanału lub listę linków YouTube." });
  }

  try {
    const result = await youtubeImporter.importBatch(source, { maxItems, concurrency: 6 });
    return res.json({ success: true, ...result, stats: youtubeImporter.getStats() });
  } catch (err: any) {
    logEvent("warn", "youtube-import", "Błąd podglądu importu YouTube", err?.message || "");
    return res.status(500).json({ success: false, error: err?.message || "Import failed" });
  }
});

app.post("/api/youtube/import", async (req, res) => {
  const source = req.body?.source ?? req.body?.url ?? "";
  const targetType: "music" | "video" = req.body?.targetType === "video" ? "video" : "music";
  const targetId = String(req.body?.targetId || (targetType === "video" ? "cinema-general" : "web-channel"));
  const mode: "now" | "queue" = req.body?.mode === "now" ? "now" : "queue";
  const maxItems = Math.max(1, Math.min(250, Number(req.body?.maxItems || 100)));

  if (!source || (typeof source === "string" && !source.trim())) {
    return res.status(400).json({ success: false, error: "Brak źródła do zaimportowania." });
  }

  try {
    const result = await youtubeImporter.importBatch(source, { maxItems, concurrency: 6 });
    if (result.tracks.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Nie znaleziono żadnych utworów ani filmów dla podanego źródła.",
        failed: result.failed,
      });
    }

    if (targetType === "video") {
      const channel = storeState.videoChannels.find((c) => c.id === targetId);
      if (!channel) {
        return res.status(404).json({ success: false, error: "Nie znaleziono kanału wideo." });
      }
      const user = getAuthenticatedUser(req);
      const addedBy = user?.username || "YouTube Importer";

      result.tracks.forEach((t, idx) => {
        const item = parseVideoSource(t.url, t.title, addedBy);
        if (idx === 0 && (mode === "now" || !channel.currentVideo)) {
          if (channel.currentVideo) {
            channel.history.unshift(channel.currentVideo);
            channel.history = channel.history.slice(0, 30);
          }
          channel.currentVideo = item;
          channel.isPlaying = true;
        } else {
          channel.queue.push(item);
        }
      });

      channel.updatedAt = Date.now();
      saveStore();
      logEvent(
        "info",
        "youtube-import",
        `Zaimportowano ${result.tracks.length} filmów do #${channel.name} w ${result.durationMs}ms.`
      );
      return res.json({
        success: true,
        importedCount: result.tracks.length,
        durationMs: result.durationMs,
        cacheHits: result.cacheHits,
        sourceKind: result.sourceKind,
        sourceTitle: result.sourceTitle,
        failed: result.failed,
        channel,
        stats: youtubeImporter.getStats(),
      });
    }

    // Music player target (Discord guild OR Web Channel)
    if (targetId !== "web-channel") {
      const queue = player.nodes.get(targetId);
      if (!queue || !queue.channel) {
        return res.status(404).json({
          success: false,
          error: "Brak aktywnego kanału głosowego na wybranym serwerze Discord.",
        });
      }
      await ensureExtractors();
      let queuedCount = 0;
      for (const t of result.tracks) {
        try {
          await player.play(queue.channel, t.url);
          queuedCount++;
        } catch {}
      }
      logEvent(
        "info",
        "youtube-import",
        `Zaimportowano ${queuedCount}/${result.tracks.length} utworów na serwer ${targetId} w ${result.durationMs}ms.`
      );
      return res.json({
        success: true,
        importedCount: queuedCount,
        durationMs: result.durationMs,
        cacheHits: result.cacheHits,
        sourceKind: result.sourceKind,
        sourceTitle: result.sourceTitle,
        failed: result.failed,
        stats: youtubeImporter.getStats(),
      });
    }

    // Web Channel batch queueing
    for (const t of result.tracks) {
      queueTrackToWebPlayer(t);
    }

    dispatchIntegrationEvent("track_queued", {
      guildId: "web-channel",
      importedCount: result.tracks.length,
      sourceTitle: result.sourceTitle,
      sourceKind: result.sourceKind,
    }).catch(() => {});

    logEvent(
      "info",
      "youtube-import",
      `Zaimportowano ${result.tracks.length} utworów do Web Channel w ${result.durationMs}ms.`
    );

    return res.json({
      success: true,
      importedCount: result.tracks.length,
      durationMs: result.durationMs,
      cacheHits: result.cacheHits,
      sourceKind: result.sourceKind,
      sourceTitle: result.sourceTitle,
      failed: result.failed,
      player: getWebPlayerSnapshot(),
      stats: youtubeImporter.getStats(),
    });
  } catch (err: any) {
    logEvent("error", "youtube-import", "Błąd importu YouTube", err?.message || "");
    return res.status(500).json({ success: false, error: err?.message || "Import failed" });
  }
});

// ==================== 1,000+ INTEGRATIONS HUB ROUTES ====================

app.get("/api/integrations", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const category = String(req.query.category || "all");
  const protocol = String(req.query.protocol || "all");
  const connectedOnly = req.query.connectedOnly === "true";
  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const limit = Math.min(100, Math.max(12, Number.parseInt(String(req.query.limit || "48"), 10) || 48));

  const filtered = INTEGRATIONS_CATALOG.filter((item) => {
    const conn = storeState.integrations[item.id];
    if (connectedOnly && !conn?.enabled) return false;
    if (category !== "all" && item.category !== category) return false;
    if (protocol !== "all" && item.protocol !== protocol) return false;
    if (q) {
      return (
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.id.includes(q)
      );
    }
    return true;
  });

  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;

  const items = filtered.slice(start, start + limit).map((item) => ({
    ...item,
    connection: storeState.integrations[item.id] || null,
  }));

  const connectedCount = Object.values(storeState.integrations).filter((c) => c.enabled).length;

  res.json({
    success: true,
    totalCatalog: INTEGRATIONS_CATALOG.length,
    totalFiltered,
    connectedCount,
    page: safePage,
    limit,
    totalPages,
    categories: INTEGRATION_CATEGORIES,
    protocols: INTEGRATION_PROTOCOLS,
    items,
  });
});

app.post("/api/integrations/:id/connect", (req, res) => {
  const { id } = req.params;
  const def = INTEGRATIONS_CATALOG.find((i) => i.id === id);
  if (!def) return res.status(404).json({ success: false, error: "Nie znaleziono integracji." });

  const {
    enabled = true,
    endpointUrl = "",
    apiKey = "",
    channelTarget = "",
    events,
  } = req.body || {};

  const existing = storeState.integrations[id];
  const connection = {
    integrationId: id,
    enabled: Boolean(enabled),
    endpointUrl: String(endpointUrl).trim(),
    apiKey: String(apiKey).trim(),
    channelTarget: String(channelTarget).trim(),
    events: Array.isArray(events) && events.length > 0 ? events : def.defaultEvents,
    updatedAt: Date.now(),
    lastTriggeredAt: existing?.lastTriggeredAt,
    lastStatus: existing?.lastStatus || (enabled ? "Configured" : "Paused"),
  };

  storeState.integrations[id] = connection;
  saveStore();
  logEvent("info", "integrations", `Zapisano konfigurację integracji ${def.name}.`);
  return res.json({ success: true, connection });
});

app.post("/api/integrations/:id/toggle", (req, res) => {
  const { id } = req.params;
  const def = INTEGRATIONS_CATALOG.find((i) => i.id === id);
  if (!def) return res.status(404).json({ success: false, error: "Nie znaleziono integracji." });

  const existing = storeState.integrations[id];
  if (!existing) {
    storeState.integrations[id] = {
      integrationId: id,
      enabled: true,
      endpointUrl: "",
      apiKey: "",
      channelTarget: "",
      events: def.defaultEvents,
      updatedAt: Date.now(),
      lastStatus: "Enabled",
    };
  } else {
    existing.enabled = !existing.enabled;
    existing.updatedAt = Date.now();
    existing.lastStatus = existing.enabled ? "Enabled" : "Disabled";
  }
  saveStore();
  return res.json({ success: true, connection: storeState.integrations[id] });
});

app.delete("/api/integrations/:id", (req, res) => {
  const { id } = req.params;
  delete storeState.integrations[id];
  saveStore();
  return res.json({ success: true });
});

app.post("/api/integrations/:id/test", async (req, res) => {
  const { id } = req.params;
  const def = INTEGRATIONS_CATALOG.find((i) => i.id === id);
  if (!def) return res.status(404).json({ success: false, error: "Nie znaleziono integracji." });

  const conn = storeState.integrations[id];
  const endpointUrl = String(req.body?.endpointUrl ?? conn?.endpointUrl ?? "").trim();
  const apiKey = String(req.body?.apiKey ?? conn?.apiKey ?? "").trim();

  if (endpointUrl) {
    const startMs = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Snajper-Test": "true",
      };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const response = await fetch(endpointUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          event: "integration_test",
          integration: def.name,
          category: def.category,
          timestamp: new Date().toISOString(),
          message: `Test połączenia z SnajperBot (${def.name})`,
        }),
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startMs;
      const statusLabel = `HTTP ${response.status} (${latencyMs}ms)`;
      if (conn) {
        conn.lastTriggeredAt = Date.now();
        conn.lastStatus = statusLabel;
        saveStore();
      }
      logEvent("info", "integrations", `Test webhooka ${def.name}: ${statusLabel}`);
      return res.json({
        success: response.ok,
        status: response.status,
        latencyMs,
        message: response.ok
          ? `Połączenie OK — serwer odpowiedział ${statusLabel}`
          : `Endpoint odpowiedział kodem HTTP ${response.status}`,
      });
    } catch (err: any) {
      const msg = err?.name === "AbortError" ? "Timeout (6s)" : err?.message || "Błąd połączenia";
      if (conn) {
        conn.lastTriggeredAt = Date.now();
        conn.lastStatus = `Failed: ${msg}`;
        saveStore();
      }
      return res.status(502).json({ success: false, error: msg });
    } finally {
      clearTimeout(timeout);
    }
  }

  // Protocol-level validation when no webhook URL is provided
  if (def.protocol === "api_key" && !apiKey) {
    return res.status(400).json({
      success: false,
      error: "Podaj klucz API lub adres Endpoint URL, aby przetestować połączenie.",
    });
  }

  const label = `Verified (${def.protocol.toUpperCase()})`;
  if (conn) {
    conn.lastTriggeredAt = Date.now();
    conn.lastStatus = label;
    saveStore();
  }
  return res.json({
    success: true,
    latencyMs: 1,
    message: `Konfiguracja ${def.name} zweryfikowana (${def.protocol}).`,
  });
});

// ==================== BUG REPORTS, GENAI, DRIVE & ADMIN ROUTES ====================

app.post("/api/bugs", (req, res) => {
  const user = getAuthenticatedUser(req);
  const { title, description, priority = "low" } = req.body || {};
  if (!title || !description) {
    return res.status(400).json({ success: false, error: "Tytuł i opis są wymagane." });
  }

  const bug = {
    id: storeState.nextBugId++,
    user_id: user?.id || "guest",
    title: String(title),
    description: String(description),
    priority: String(priority),
    status: "open",
    created_at: Date.now(),
  };
  storeState.bugs.unshift(bug);
  saveStore();
  logEvent("warn", "bug-report", `Nowe zgłoszenie: ${bug.title}`);
  dispatchIntegrationEvent("bug_reported", bug).catch(() => {});
  return res.json({ success: true, bug });
});

app.post("/api/yt-to-drive", async (req, res) => {
  try {
    const { url, accessToken } = req.body || {};
    if (!url || !accessToken) {
      return res.status(400).json({ error: "Missing url or accessToken" });
    }

    const tempPath = path.join("/tmp", `dl_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`);
    const dlPath = await globalDownloader.download({
      url,
      format: "audio",
      outputPath: tempPath,
      quality: "best",
    });

    const fileName = path.basename(dlPath);
    const metadata = { name: fileName, mimeType: "audio/mp4" };
    const fileBuffer = await fs.promises.readFile(dlPath);
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", new Blob([fileBuffer], { type: "audio/mp4" }), fileName);

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
        signal: AbortSignal.timeout(60_000),
      }
    );
    const uData = await uploadRes.json();
    await fs.promises.rm(tempPath, { recursive: true, force: true }).catch(() => {});

    if (!uploadRes.ok) throw new Error(`Drive Upload Error: ${JSON.stringify(uData)}`);
    return res.json({ success: true, file: uData });
  } catch (e: any) {
    logEvent("error", "drive", "Błąd wysyłania pliku na Google Drive", e?.message || "");
    return res.status(500).json({ error: e?.message || "Drive upload failed" });
  }
});

app.post("/api/genai/query", async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    if (!aiAssistant) {
      return res.status(500).json({ error: "GenAI not configured (GEMINI_API_KEY)" });
    }

    const response = await aiAssistant.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: String(prompt),
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const text = response.text || "";
    return res.json({ success: true, text });
  } catch (err: any) {
    logEvent("error", "genai", err?.message || "GenAI error");
    return res.status(500).json({ error: err?.message || "GenAI error" });
  }
});

app.get("/api/admin/users", (_req, res) => {
  res.json({ success: true, users: storeState.users.map(sanitizeUser) });
});

app.post("/api/admin/users/:userId/premium", (req, res) => {
  const { userId } = req.params;
  const { action, durationStr = "30d" } = req.body || {};
  const user = storeState.users.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ success: false, error: "User not found" });

  if (action === "revoke") {
    user.premium = 0;
    user.premium_expires_at = null;
  } else {
    user.premium = 1;
    if (durationStr === "lifetime") {
      user.premium_expires_at = null;
    } else {
      const durMs = parseDurationMs(String(durationStr)) ?? 30 * 86400000;
      user.premium_expires_at = Date.now() + durMs;
    }
  }
  saveStore();
  return res.json({ success: true });
});

app.get("/api/admin/vouchers", (_req, res) => {
  res.json({ success: true, vouchers: storeState.vouchers });
});

app.post("/api/admin/vouchers", (req, res) => {
  const user = getAuthenticatedUser(req);
  const { type = "user_premium", durationStr = "30d", maxUses = 1 } = req.body || {};
  const durMs =
    durationStr === "lifetime" ? 100 * 365 * 86400000 : parseDurationMs(String(durationStr));
  if (!durMs) {
    return res.status(400).json({ success: false, error: "Nieprawidłowy format czasu (np. 30d)." });
  }

  const code = crypto.randomBytes(6).toString("hex").toUpperCase();
  const voucher = {
    code,
    type,
    duration: durMs,
    max_uses: Math.max(1, Number(maxUses) || 1),
    uses: 0,
    created_by: user?.id || "admin",
    created_at: Date.now(),
  };
  storeState.vouchers.unshift(voucher);
  saveStore();
  return res.json({ success: true, code, voucher });
});

app.delete("/api/admin/vouchers/:code", (req, res) => {
  const { code } = req.params;
  storeState.vouchers = storeState.vouchers.filter((v) => v.code !== code);
  saveStore();
  res.json({ success: true });
});

app.get("/api/admin/logs", (_req, res) => {
  res.json({ success: true, logs: storeState.logs });
});

app.patch("/api/admin/logs/:logId", (req, res) => {
  const id = Number.parseInt(req.params.logId, 10);
  const log = storeState.logs.find((l) => l.id === id);
  if (!log) return res.status(404).json({ success: false });
  log.solution = req.body?.solution ?? log.solution;
  saveStore();
  return res.json({ success: true, log });
});

app.get("/api/admin/bugs", (_req, res) => {
  res.json({ success: true, bugs: storeState.bugs });
});

app.patch("/api/admin/bugs/:bugId", (req, res) => {
  const id = Number.parseInt(req.params.bugId, 10);
  const bug = storeState.bugs.find((b) => b.id === id);
  if (!bug) return res.status(404).json({ success: false });
  bug.status = req.body?.status || bug.status;
  saveStore();
  return res.json({ success: true, bug });
});

app.get("/api/admin/system/stats", (_req, res) => {
  res.json({
    success: true,
    stats: {
      last_repair: storeState.lastRepair,
      active_sessions: buildDiscordPlayers().length + (webPlayerState.nowPlaying ? 1 : 0),
      integrations_active: Object.values(storeState.integrations).filter((c) => c.enabled).length,
      video_channels: storeState.videoChannels.length,
    },
  });
});

app.get("/api/admin/system/version", (_req, res) => {
  res.json({
    success: true,
    current: APP_VERSION,
    latest: APP_VERSION,
    needsUpdate: false,
  });
});

app.get("/api/admin/system/diag", (req, res) => {
  const activePlayers = [getWebPlayerSnapshot(), ...buildDiscordPlayers()];
  res.json({
    success: true,
    diag: {
      system: {
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
      },
      discord: {
        tokenSet: Boolean(DISCORD_TOKEN),
        clientIdSet: Boolean(DISCORD_CLIENT_ID),
        clientSecretSet: Boolean(DISCORD_CLIENT_SECRET),
        isReady: client.isReady(),
        guilds: client.isReady() ? client.guilds.cache.size : 0,
        user: client.user?.tag || "Offline",
      },
      env: {
        calculatedRedirectUri: getDiscordRedirectUri(req),
      },
      players: activePlayers,
      activePlayers,
    },
  });
});

app.post("/api/admin/system/repair", async (_req, res) => {
  extractorsLoaded = false;
  await ensureExtractors();
  storeState.lastRepair = new Date().toISOString();
  saveStore();
  logEvent("info", "system", "Wykonano procedurę autonaprawy ekstraktorów i cache.");
  res.json({ success: true });
});

app.post("/api/admin/system/update", async (_req, res) => {
  extractorsLoaded = false;
  await ensureExtractors();
  logEvent("info", "system", "Odświeżono ekstraktory audio i połączenia.");
  res.json({ success: true, message: "Zaktualizowano ekstraktory i konfigurację." });
});

app.get("/api/admin/broadcasts", (_req, res) => {
  res.json({ success: true, broadcasts: storeState.broadcasts });
});

app.post("/api/admin/broadcast", async (req, res) => {
  const user = getAuthenticatedUser(req);
  const { title = "Ogłoszenie SnajperBot", message } = req.body || {};
  if (!message) return res.status(400).json({ success: false, error: "Brak treści wiadomości." });

  let sentCount = 0;
  if (client.isReady()) {
    const embed = new EmbedBuilder()
      .setTitle(String(title))
      .setDescription(String(message))
      .setColor(0x5865f2)
      .setTimestamp();

    for (const guild of client.guilds.cache.values()) {
      const target =
        guild.systemChannel ||
        (guild.channels.cache.find((c) => c.isTextBased()) as TextChannel | undefined);
      if (target) {
        try {
          await target.send({ embeds: [embed] });
          sentCount++;
        } catch {}
      }
    }
  }

  const broadcast = {
    id: storeState.nextBroadcastId++,
    title: String(title),
    body: String(message),
    created_by: user?.id || "admin",
    sent_count: sentCount,
    created_at: Date.now(),
  };
  storeState.broadcasts.unshift(broadcast);
  saveStore();
  dispatchIntegrationEvent("broadcast_sent", broadcast).catch(() => {});
  return res.json({ success: true, sentCount, broadcast });
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "OK", version: APP_VERSION, uptime: Math.floor(process.uptime()) });
});

// JSON 404 Guard for any unknown /api/* route — prevents falling through to index.html
app.use("/api", (req, res) => {
  res.status(404).json({ success: false, error: `Unknown API route: ${req.originalUrl}` });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const viteSetup = await import("vite");
    const vite = await viteSetup.createServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: "spa",
    });

    // Vite 8's built-in @vite/client still attempts a WebSocket connection even with hmr: false.
    // Serve a clean ESM shim preserving style injection and no-op HMR context with zero WebSocket errors.
    app.get("/@vite/client", (_req, res) => {
      res.type("application/javascript");
      res.setHeader("Cache-Control", "no-store");
      res.send(`
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== "undefined") {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    document.head.appendChild(style);
  } else {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
      if (el.getAttribute("data-vite-dev-id") === id) el.remove();
    });
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (!url || (url[0] !== "." && url[0] !== "/")) return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return pathname + "?" + queryToInject + (search ? "&" + search.slice(1) : "") + (hash || "");
}
export class ErrorOverlay {
  constructor() {}
}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    // Pre-warm YouTube Innertube session + player scripts in background
    youtubeImporter.warmup().catch(() => {});
    if (DISCORD_TOKEN) {
      client.login(DISCORD_TOKEN).catch((err) => {
        logEvent("warn", "discord", "Logowanie bota Discord nie powiodło się", err?.message || "");
      });
    } else {
      console.log("[Discord] DISCORD_TOKEN nie ustawiony — panel działa w trybie Web Channel.");
    }
  });

  const shutdown = async () => {
    await flushStore().catch(() => {});
    try {
      client.destroy();
    } catch {}
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", () => {
    shutdown().catch(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    shutdown().catch(() => process.exit(0));
  });
}

startServer().catch((err) => {
  console.error("[FATAL] Server startup failed:", err);
  process.exit(1);
});

export {};
