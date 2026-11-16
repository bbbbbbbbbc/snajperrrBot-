import React, { useState, useEffect, useRef } from 'react';
import {
  AnimatePresence,
  motion
} from 'motion/react';
import {
  Bot,
  Activity,
  Tv,
  Plug,
  History,
  Terminal,
  Settings,
  Mail,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  X
} from 'lucide-react';
import { arrayMove } from '@dnd-kit/sortable';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

// Types, Constants & API
import {
  BotStatus,
  PlayerStatus,
  PremiumSettings,
  DEFAULT_PREMIUM_SETTINGS
} from './types';
import { CHANGELOG_VERSION } from './constants';
import { apiFetch } from './lib/api';

// Components
import { Sidebar } from './components/Sidebar';
import { ConfirmModal, BugReportModal, ChangelogModal } from './components/Modals';

// Tabs
import { DashboardTab } from './tabs/DashboardTab';
import { VideoChannelsTab } from './tabs/VideoChannelsTab';
import { IntegrationsTab } from './tabs/IntegrationsTab';
import { HistoryTab } from './tabs/HistoryTab';
import { LogsTab } from './tabs/LogsTab';
import { AdminTab } from './tabs/AdminTab';
import { SettingsTab } from './tabs/SettingsTab';
import { GmailTab } from './tabs/GmailTab';
import { GoogleDriveTab } from './tabs/GoogleDriveTab';

type TabId =
  | 'dashboard'
  | 'video'
  | 'integrations'
  | 'history'
  | 'logs'
  | 'admin'
  | 'settings'
  | 'gmail'
  | 'drive';

const TAB_TITLES: Record<TabId, string> = {
  dashboard: 'Muzyka i Dashboard',
  video: 'Kanały Wideo',
  integrations: 'Hub Integracji',
  history: 'Historia Odtwarzania',
  logs: 'Logi Systemowe',
  admin: 'Panel Administratora',
  settings: 'Ustawienia',
  gmail: 'Gmail',
  drive: 'Google Drive'
};

export default function App() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [players, setPlayers] = useState<PlayerStatus[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [clearConfirmGuildId, setClearConfirmGuildId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTargetGuild, setSearchTargetGuild] = useState<string>('');

  const [user, setUser] = useState<any>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);

  // Changelog state
  const [showChangelog, setShowChangelog] = useState(false);

  // Premium settings state
  const [premiumSettings, setPremiumSettings] = useState<PremiumSettings>({ ...DEFAULT_PREMIUM_SETTINGS });
  const [savingPremiumSetting, setSavingPremiumSetting] = useState<string | null>(null);

  // Admin state
  const [voucherType, setVoucherType] = useState('user_premium');
  const [voucherDuration, setVoucherDuration] = useState('30d');
  const [voucherMaxUses, setVoucherMaxUses] = useState(1);
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [createdVoucher, setCreatedVoucher] = useState<any>(null);
  const [adminTab, setAdminTab] = useState<'vouchers' | 'users' | 'logs' | 'bugs' | 'updates' | 'diag' | 'players' | 'news'>('vouchers');
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [systemLogs, setSystemLogs] = useState<any[]>([]);
  const [bugReports, setBugReports] = useState<any[]>([]);
  const [analyzingLogId, setAnalyzingLogId] = useState<number | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<Record<number, string>>({});
  const [diagData, setDiagData] = useState<any>(null);

  const [versionInfo, setVersionInfo] = useState<{ current: string; latest: string; needsUpdate: boolean } | null>(null);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // Bug report state (user)
  const [showBugModal, setShowBugModal] = useState(false);
  const [bugTitle, setBugTitle] = useState('');
  const [bugDescription, setBugDescription] = useState('');
  const [bugPriority, setBugPriority] = useState('low');
  const [isSubmittingBug, setIsSubmittingBug] = useState(false);

  // Voucher state
  const [showRedeemInput, setShowRedeemInput] = useState(false);
  const [voucherInput, setVoucherInput] = useState('');
  const [redeemMessage, setRedeemMessage] = useState<{ text: string; type: 'error' | 'success' } | null>(null);

  // Managed web audio element for 'web-channel' player
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentStreamIdRef = useRef<string | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchAdminUsers = async () => {
    try {
      const data = await apiFetch('/api/admin/users');
      if (data.success) setAdminUsers(data.users);
    } catch {}
  };

  const fetchAdminVouchers = async () => {
    try {
      const data = await apiFetch('/api/admin/vouchers');
      if (data.success) setVouchers(data.vouchers);
    } catch {}
  };

  const fetchAdminLogs = async () => {
    try {
      const data = await apiFetch('/api/admin/logs');
      if (data.success) setSystemLogs(data.logs);
    } catch {}
  };

  const fetchAdminBugs = async () => {
    try {
      const data = await apiFetch('/api/admin/bugs');
      if (data.success) setBugReports(data.bugs);
    } catch {}
  };

  const [systemStats, setSystemStats] = useState<{ last_repair?: string }>({});
  const fetchSystemStats = async () => {
    try {
      const data = await apiFetch('/api/admin/system/stats');
      if (data.success) setSystemStats(data.stats);
    } catch {}
  };

  const fetchVersionInfo = async () => {
    setCheckingVersion(true);
    try {
      const data = await apiFetch('/api/admin/system/version');
      if (data.success) {
        setVersionInfo({
          current: data.current,
          latest: data.latest,
          needsUpdate: data.needsUpdate
        });
      }
    } catch (err) {
      console.error('Fetch version error:', err);
    } finally {
      setCheckingVersion(false);
    }
  };

  const fetchDiagData = async () => {
    try {
      const data = await apiFetch('/api/admin/system/diag');
      if (data.success) setDiagData(data.diag);
    } catch {}
  };

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchAdminLogs();
    } else if (activeTab === 'admin' && user?.is_admin === 1) {
      if (adminTab === 'users') fetchAdminUsers();
      else if (adminTab === 'vouchers') fetchAdminVouchers();
      else if (adminTab === 'logs') {
        fetchAdminLogs();
        fetchSystemStats();
      } else if (adminTab === 'bugs') fetchAdminBugs();
      else if (adminTab === 'updates') fetchVersionInfo();
      else if (adminTab === 'diag' || adminTab === 'players') fetchDiagData();
    }
  }, [activeTab, adminTab, user]);

  const fetchUserData = async () => {
    try {
      const data = await apiFetch('/api/me');
      if (data.loggedIn) {
        setUser(data.user);
        if (data.user.premium_settings && typeof data.user.premium_settings === 'object') {
          setPremiumSettings((prev) => ({ ...prev, ...data.user.premium_settings }));
        }
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error('fetchUserData error:', err);
      setUser(null);
    } finally {
      setIsLoadingUser(false);
    }
  };

  useEffect(() => {
    fetchUserData();
    const lastSeen = localStorage.getItem('changelog_version');
    if (lastSeen !== CHANGELOG_VERSION) setShowChangelog(true);

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('checkout') === 'success') {
      showToast('Dziękujemy! Twój zakup Premium zakończył się pomyślnie.');
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('checkout') === 'cancel') {
      showToast('Anulowano zakup Premium.', 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' || event.data?.type === 'SPOTIFY_AUTH_SUCCESS') {
        fetchUserData();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogin = async () => {
    try {
      const data = await apiFetch('/api/auth/url');
      if (!data?.url) {
        showToast(data?.error || 'Discord OAuth nie jest skonfigurowany.', 'error');
        return;
      }
      const authWindow = window.open(data.url, 'oauth_popup', 'width=600,height=700');
      if (!authWindow) showToast('Zezwól na wyskakujące okna dla logowania.', 'error');
    } catch (err: any) {
      showToast(err?.message || 'Błąd logowania Discord.', 'error');
    }
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  };

  const handleSpotifyLogin = async () => {
    try {
      const data = await apiFetch('/api/auth/spotify/login');
      if (data.error) {
        showToast(data.error, 'error');
        return;
      }
      const authWindow = window.open(data.url, 'spotify_popup', 'width=600,height=700');
      if (!authWindow) showToast('Zezwól na wyskakujące okna dla Spotify.', 'error');
    } catch (err: any) {
      showToast(err?.message || 'Błąd połączenia ze Spotify.', 'error');
    }
  };

  const handleSpotifyUnlink = async () => {
    try {
      const data = await apiFetch('/api/user/spotify/unlink', { method: 'POST' });
      if (data.success) {
        showToast('Odłączono konto Spotify.');
        fetchUserData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateQuality = async (quality: string) => {
    try {
      const data = await apiFetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioQuality: quality })
      });
      if (data.success) {
        setUser((prev: any) => (prev ? { ...prev, audio_quality: quality } : prev));
        showToast(`Zapisano jakość dźwięku: ${quality}`);
      } else {
        showToast(data.error || 'Nie udało się zmienić jakości.', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Błąd sieciowy.', 'error');
    }
  };

  const handleUpdatePremiumSetting = async <K extends keyof PremiumSettings>(key: K, value: PremiumSettings[K]) => {
    const previousSettings = { ...premiumSettings };
    const newSettings = { ...premiumSettings, [key]: value };
    setPremiumSettings(newSettings);
    setSavingPremiumSetting(key);
    try {
      await apiFetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ premiumSettings: newSettings })
      });
    } catch {
      setPremiumSettings(previousSettings);
    } finally {
      setSavingPremiumSetting(null);
    }
  };

  const handleRedeemVoucher = async (guildIdToUse?: string) => {
    if (!voucherInput.trim()) return;
    try {
      const payload: any = { code: voucherInput.trim() };
      if (guildIdToUse) payload.guildId = guildIdToUse;
      const res = await fetch('/api/vouchers/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const contentType = res.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await res.json() : { error: 'Nieprawidłowa odpowiedź serwera' };
      if (res.ok) {
        setRedeemMessage({ text: data.message || 'Aktywowano!', type: 'success' });
        setVoucherInput('');
        fetchUserData();
      } else if (data.error === 'requires_guild_id') {
        setRedeemMessage({ text: 'Ten voucher wymaga ID serwera (Guild ID).', type: 'error' });
      } else {
        setRedeemMessage({ text: `Błąd: ${data.error}`, type: 'error' });
      }
    } catch {
      setRedeemMessage({ text: 'Błąd serwera.', type: 'error' });
    }
  };

  const handleAdminUserPremium = async (userId: string, action: 'grant' | 'extend' | 'revoke') => {
    let durationStr = '30d';
    if (action !== 'revoke') {
      const input = window.prompt('Czas trwania (np. 30d, 1y, lifetime):', '30d');
      if (!input) return;
      durationStr = input;
    }
    try {
      const data = await apiFetch(`/api/admin/users/${userId}/premium`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, durationStr })
      });
      if (data.success) fetchAdminUsers();
      else showToast(data.error || 'Błąd aktualizacji Premium', 'error');
    } catch {
      showToast('Błąd serwera', 'error');
    }
  };

  const handleCreateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = await apiFetch('/api/admin/vouchers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: voucherType, durationStr: voucherDuration, maxUses: voucherMaxUses })
      });
      if (data.success) {
        setCreatedVoucher(data);
        fetchAdminVouchers();
      } else {
        showToast(data.error || 'Nie udało się utworzyć vouchera.', 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const refreshPlayersAndStatus = async () => {
    try {
      const [statusData, playersData] = await Promise.all([
        apiFetch<BotStatus>('/api/status'),
        apiFetch<PlayerStatus[]>('/api/players')
      ]);
      if (statusData) setStatus(statusData);
      if (Array.isArray(playersData)) setPlayers(playersData);
    } catch {
      // Ignored during background polling
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const data = await apiFetch(`/api/search?query=${encodeURIComponent(searchQuery)}`);
      setSearchResults(data.success ? data.tracks : []);
    } catch {
      setSearchResults([]);
      showToast('Nie udało się wyszukać utworów.', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const handlePlayFromWeb = async (track: {
    url: string;
    title?: string;
    author?: string;
    duration?: string | number;
    thumbnail?: string;
  }) => {
    const target = searchTargetGuild || (players.length > 0 ? players[0].guildId : 'web-channel');
    try {
      const data = await apiFetch(`/api/players/${target}/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: track.url,
          title: track.title,
          author: track.author,
          duration: track.duration,
          thumbnail: track.thumbnail
        })
      });
      if (data.success) {
        showToast(`Dodano do kolejki: ${track.title || 'utwór'}`);
        await refreshPlayersAndStatus();
      } else {
        showToast(data.error || 'Nie udało się dodać utworu.', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Błąd dodawania utworu.', 'error');
    }
  };

  const handleVolumeChange = async (guildId: string, newVolume: number) => {
    setPlayers((prev) => prev.map((p) => (p.guildId === guildId ? { ...p, volume: newVolume } : p)));
    if (guildId === 'web-channel' && audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, newVolume / 100));
    }
    try {
      await apiFetch(`/api/players/${guildId}/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: newVolume })
      });
    } catch {}
  };

  const handlePlaybackToggle = async (guildId: string, currentState: 'playing' | 'paused') => {
    const newState = currentState === 'playing' ? 'paused' : 'playing';
    setPlayers((prev) => prev.map((p) => (p.guildId === guildId ? { ...p, state: newState } : p)));
    if (guildId === 'web-channel' && audioRef.current) {
      if (newState === 'playing') {
        audioRef.current.play().catch(() => {});
      } else {
        audioRef.current.pause();
      }
    }
    try {
      await apiFetch(`/api/players/${guildId}/playback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: newState })
      });
    } catch {}
  };

  const handleSkipForward = async (guildId: string) => {
    try {
      await apiFetch(`/api/players/${guildId}/skip`, { method: 'POST' });
      await refreshPlayersAndStatus();
    } catch {}
  };

  const handleClearQueue = async (guildId: string) => {
    try {
      await apiFetch(`/api/players/${guildId}/clear`, { method: 'POST' });
      setClearConfirmGuildId(null);
      await refreshPlayersAndStatus();
    } catch {}
  };

  const handleRemoveTrack = async (guildId: string, trackId: string) => {
    setPlayers((prev) =>
      prev.map((p) =>
        p.guildId === guildId
          ? { ...p, queue: p.queue.filter((t) => t.id !== trackId), queueLength: Math.max(0, p.queueLength - 1) }
          : p
      )
    );
    try {
      await apiFetch(`/api/players/${guildId}/queue/${trackId}`, { method: 'DELETE' });
    } catch {}
  };

  const handleSubmitBug = async () => {
    if (!bugTitle || !bugDescription) return;
    setIsSubmittingBug(true);
    try {
      const data = await apiFetch('/api/bugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: bugTitle, description: bugDescription, priority: bugPriority })
      });
      if (data.success) {
        setShowBugModal(false);
        setBugTitle('');
        setBugDescription('');
        showToast('Wysłano zgłoszenie błędu!');
      }
    } catch {
      showToast('Nie udało się wysłać zgłoszenia.', 'error');
    } finally {
      setIsSubmittingBug(false);
    }
  };

  const [isRepairing, setIsRepairing] = useState(false);
  const handleSystemRepair = async () => {
    setIsRepairing(true);
    try {
      const data = await apiFetch('/api/admin/system/repair', { method: 'POST' });
      if (data.success) {
        showToast('Naprawa systemu zakończona.');
        fetchAdminLogs();
        fetchSystemStats();
      } else {
        showToast('Błąd naprawy.', 'error');
      }
    } catch {
      showToast('Błąd naprawy.', 'error');
    } finally {
      setIsRepairing(false);
    }
  };

  const handleUpdateBugStatus = async (bugId: number, nextStatus: string) => {
    try {
      await apiFetch(`/api/admin/bugs/${bugId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      fetchAdminBugs();
    } catch {}
  };

  async function callGenAI(prompt: string) {
    const data = await apiFetch('/api/genai/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (data.error) throw new Error(data.error);
    return data?.text ?? data?.data ?? data;
  }

  const handleAnalyzeWithAI = async (logId: number) => {
    setAnalyzingLogId(logId);
    try {
      const log = systemLogs.find((l) => l.id === logId);
      const prompt = `Analizuj błąd: ${log?.message || 'Nieznany błąd'}. Podaj krótkie rozwiązanie (Markdown, PL).`;
      const response = await callGenAI(prompt);
      const analysis = typeof response === 'string' ? response : response.text || 'Błąd analizy AI.';
      setAiAnalysis((prev) => ({ ...prev, [logId]: analysis }));
      await apiFetch(`/api/admin/logs/${logId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solution: analysis })
      });
      fetchAdminLogs();
    } catch (e: any) {
      showToast(e?.message || 'Błąd AI (sprawdź GEMINI_API_KEY na serwerze)', 'error');
    } finally {
      setAnalyzingLogId(null);
    }
  };

  const handleDragEnd = async (event: DragEndEvent, guildId: string) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const player = players.find((p) => p.guildId === guildId);
      if (!player) return;
      const oldIndex = player.queue.findIndex((t) => t.id === active.id);
      const newIndex = player.queue.findIndex((t) => t.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        setPlayers((prev) =>
          prev.map((p) => (p.guildId === guildId ? { ...p, queue: arrayMove(p.queue, oldIndex, newIndex) } : p))
        );
        try {
          await apiFetch(`/api/players/${guildId}/queue/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: oldIndex, to: newIndex })
          });
        } catch {}
      }
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    refreshPlayersAndStatus();
    const interval = setInterval(refreshPlayersAndStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Synchronize browser <audio> element with the 'web-channel' player
  const webPlayer = players.find((p) => p.guildId === 'web-channel');
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !webPlayer) return;

    audio.volume = Math.max(0, Math.min(1, webPlayer.volume / 100));

    const track = webPlayer.nowPlaying;
    if (!track) {
      if (currentStreamIdRef.current !== null) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        currentStreamIdRef.current = null;
      }
      return;
    }

    const trackKey = track.id || track.videoId || track.url || track.title;
    if (currentStreamIdRef.current !== trackKey) {
      const streamParam = track.videoId
        ? `videoId=${encodeURIComponent(track.videoId)}`
        : track.url
          ? `url=${encodeURIComponent(track.url)}`
          : '';
      if (streamParam) {
        currentStreamIdRef.current = trackKey;
        audio.src = `/api/audio/stream?${streamParam}`;
        if (webPlayer.state === 'playing') {
          audio.play().catch(() => {});
        }
      }
    } else {
      if (webPlayer.state === 'playing' && audio.paused) {
        audio.play().catch(() => {});
      } else if (webPlayer.state === 'paused' && !audio.paused) {
        audio.pause();
      }
    }
  }, [webPlayer]);

  const formatTime = (s: number) => {
    if (!s || s === 0) return '0:00';
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = Math.floor(s % 60);
    if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleTriggerUpdate = async () => {
    if (!window.confirm('Czy na pewno uruchomić aktualizację?')) return;
    setIsUpdating(true);
    try {
      const data = await apiFetch('/api/admin/system/update', { method: 'POST' });
      if (data.success) showToast(data.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteVoucher = async (code: string) => {
    if (!window.confirm(`Czy na pewno usunąć voucher ${code}?`)) return;
    const res = await fetch(`/api/admin/vouchers/${code}`, { method: 'DELETE' });
    if (res.ok) {
      setVouchers((prev) => prev.filter((v) => v.code !== code));
    }
  };

  const handleSendAnnouncement = async (title: string, message: string) => {
    if (!message) return;
    try {
      const data = await apiFetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message })
      });
      if (data.success) {
        showToast(`Wysłano do ${data.sentCount} serwerów.`);
      } else {
        showToast('Błąd podczas wysyłania ogłoszenia.', 'error');
      }
    } catch {
      showToast('Błąd podczas wysyłania ogłoszenia.', 'error');
    }
  };

  const mobileNavItems: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'dashboard', label: 'Muzyka', icon: Activity },
    { id: 'video', label: 'Wideo', icon: Tv },
    { id: 'integrations', label: 'Integracje', icon: Plug },
    { id: 'history', label: 'Historia', icon: History },
    { id: 'logs', label: 'Logi', icon: Terminal },
    { id: 'settings', label: 'Ustawienia', icon: Settings },
    { id: 'gmail', label: 'Gmail', icon: Mail },
    { id: 'drive', label: 'Drive', icon: HardDrive }
  ];

  return (
    <div className="min-h-screen bg-[#09090B] text-slate-200 font-sans selection:bg-[#5865F2] selection:text-white flex overflow-hidden">
      <audio
        ref={audioRef}
        className="hidden"
        onEnded={() => handleSkipForward('web-channel')}
      />

      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        status={status}
        user={user}
        isLoadingUser={isLoadingUser}
        handleLogin={handleLogin}
        handleLogout={handleLogout}
        setShowBugModal={setShowBugModal}
        showRedeemInput={showRedeemInput}
        setShowRedeemInput={setShowRedeemInput}
        voucherInput={voucherInput}
        setVoucherInput={setVoucherInput}
        handleRedeemVoucher={handleRedeemVoucher}
        redeemMessage={redeemMessage}
        setRedeemMessage={setRedeemMessage}
        setShowChangelog={setShowChangelog}
      />

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto custom-scrollbar">
        <header className="min-h-20 flex flex-col md:flex-row md:items-center justify-between gap-3 px-6 md:px-8 py-3 bg-[#09090B]/80 backdrop-blur-xl border-b border-white/5 sticky top-0 z-40">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="md:hidden w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-xl font-black text-white tracking-tight">{TAB_TITLES[activeTab]}</h2>
            </div>
            {webPlayer?.nowPlaying && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
                <span className="font-semibold text-indigo-400">Web Audio:</span>
                <span className="truncate max-w-[200px] text-slate-200">{webPlayer.nowPlaying.title}</span>
              </div>
            )}
          </div>

          <div className="flex md:hidden items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            {mobileNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                    activeTab === item.id
                      ? 'bg-[#5865F2] text-white'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
            {user?.is_admin === 1 && (
              <button
                onClick={() => setActiveTab('admin')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                  activeTab === 'admin'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white/5 text-slate-400 hover:text-white'
                }`}
              >
                Admin
              </button>
            )}
          </div>
        </header>

        <div className="p-6 md:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'dashboard' && (
                <DashboardTab
                  status={status}
                  players={players}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  handleSearch={handleSearch}
                  isSearching={isSearching}
                  searchTargetGuild={searchTargetGuild}
                  setSearchTargetGuild={setSearchTargetGuild}
                  searchResults={searchResults}
                  handlePlayFromWeb={handlePlayFromWeb}
                  formatTime={formatTime}
                  handlePlaybackToggle={handlePlaybackToggle}
                  handleVolumeChange={handleVolumeChange}
                  handleSkipForward={handleSkipForward}
                  setClearConfirmGuildId={setClearConfirmGuildId}
                  handleDragEnd={handleDragEnd}
                  handleRemoveTrack={handleRemoveTrack}
                  sensors={sensors}
                  setShowChangelog={setShowChangelog}
                />
              )}
              {activeTab === 'video' && <VideoChannelsTab />}
              {activeTab === 'integrations' && <IntegrationsTab />}
              {activeTab === 'history' && <HistoryTab players={players} />}
              {activeTab === 'logs' && (
                <LogsTab
                  systemLogs={systemLogs}
                  user={user}
                  handleAnalyzeWithAI={handleAnalyzeWithAI}
                  analyzingLogId={analyzingLogId}
                  aiAnalysis={aiAnalysis}
                />
              )}
              {activeTab === 'admin' && user?.is_admin === 1 && (
                <AdminTab
                  adminTab={adminTab}
                  setAdminTab={setAdminTab}
                  systemLogs={systemLogs}
                  systemStats={systemStats}
                  voucherType={voucherType}
                  setVoucherType={setVoucherType}
                  voucherDuration={voucherDuration}
                  setVoucherDuration={setVoucherDuration}
                  voucherMaxUses={voucherMaxUses}
                  setVoucherMaxUses={setVoucherMaxUses}
                  handleCreateVoucher={handleCreateVoucher}
                  createdVoucher={createdVoucher}
                  setCreatedVoucher={setCreatedVoucher}
                  vouchers={vouchers}
                  adminUsers={adminUsers}
                  handleAdminUserPremium={handleAdminUserPremium}
                  analyzingLogId={analyzingLogId}
                  handleAnalyzeWithAI={handleAnalyzeWithAI}
                  aiAnalysis={aiAnalysis}
                  bugReports={bugReports}
                  handleUpdateBugStatus={handleUpdateBugStatus}
                  versionInfo={versionInfo}
                  checkingVersion={checkingVersion}
                  fetchVersionInfo={fetchVersionInfo}
                  handleTriggerUpdate={handleTriggerUpdate}
                  isUpdating={isUpdating}
                  handleSystemRepair={handleSystemRepair}
                  isRepairing={isRepairing}
                  fetchAdminLogs={fetchAdminLogs}
                  diagData={diagData}
                  handleDeleteVoucher={handleDeleteVoucher}
                  handleSendAnnouncement={handleSendAnnouncement}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsTab
                  user={user}
                  handleUpdateQuality={handleUpdateQuality}
                  premiumSettings={premiumSettings}
                  handleUpdatePremiumSetting={handleUpdatePremiumSetting}
                  savingPremiumSetting={savingPremiumSetting}
                  status={status}
                  handleSpotifyLogin={handleSpotifyLogin}
                  handleSpotifyUnlink={handleSpotifyUnlink}
                />
              )}
              {activeTab === 'gmail' && <GmailTab />}
              {activeTab === 'drive' && <GoogleDriveTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-2xl bg-[#111114] border-white/10 text-sm font-medium text-white max-w-sm">
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <span className="flex-1">{toast.text}</span>
          <button onClick={() => setToast(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {clearConfirmGuildId && (
        <ConfirmModal
          onCancel={() => setClearConfirmGuildId(null)}
          onConfirm={() => handleClearQueue(clearConfirmGuildId)}
        />
      )}
      {showBugModal && (
        <BugReportModal
          title={bugTitle}
          setTitle={setBugTitle}
          description={bugDescription}
          setDescription={setBugDescription}
          priority={bugPriority}
          setPriority={setBugPriority}
          onCancel={() => setShowBugModal(false)}
          onConfirm={handleSubmitBug}
          submitting={isSubmittingBug}
        />
      )}
      {showChangelog && (
        <ChangelogModal
          onClose={() => {
            localStorage.setItem('changelog_version', CHANGELOG_VERSION);
            setShowChangelog(false);
          }}
        />
      )}
    </div>
  );
}
