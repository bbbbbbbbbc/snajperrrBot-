import React, { useState, useEffect } from 'react';
import {
  Tv,
  Play,
  Pause,
  SkipForward,
  Square,
  Plus,
  Trash2,
  Search,
  ExternalLink,
  Film,
  Loader2,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { VideoChannel } from '../types';
import { cn } from '../lib/utils';

export const VideoChannelsTab: React.FC = () => {
  const [channels, setChannels] = useState<VideoChannel[]>([]);
  const [selectedId, setSelectedId] = useState<string>('cinema-general');
  const [loading, setLoading] = useState(true);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadChannels = async () => {
    try {
      const data = await apiFetch<{ success: boolean; channels: VideoChannel[] }>('/api/video/channels');
      if (data.success && Array.isArray(data.channels)) {
        setChannels(data.channels);
        if (!data.channels.some((c) => c.id === selectedId) && data.channels.length > 0) {
          setSelectedId(data.channels[0].id);
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Nie udało się pobrać kanałów wideo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChannels();
    const timer = setInterval(loadChannels, 4000);
    return () => clearInterval(timer);
  }, []);

  const activeChannel = channels.find((c) => c.id === selectedId) || channels[0] || null;

  const handlePlayOrQueue = async (
    urlToUse: string,
    titleToUse?: string,
    mode: 'now' | 'queue' = 'now'
  ) => {
    if (!activeChannel || !urlToUse.trim()) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const data = await apiFetch<{ success: boolean; channel: VideoChannel }>(
        `/api/video/channels/${activeChannel.id}/play`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: urlToUse.trim(),
            title: titleToUse?.trim() || undefined,
            mode,
          }),
        }
      );
      if (data.success && data.channel) {
        setChannels((prev) => prev.map((c) => (c.id === data.channel.id ? data.channel : c)));
        if (urlToUse === videoUrl) {
          setVideoUrl('');
          setVideoTitle('');
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Nie udało się odtworzyć filmu.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleControl = async (action: 'toggle' | 'next' | 'clear' | 'stop') => {
    if (!activeChannel) return;
    try {
      const data = await apiFetch<{ success: boolean; channel: VideoChannel }>(
        `/api/video/channels/${activeChannel.id}/control`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }
      );
      if (data.success && data.channel) {
        setChannels((prev) => prev.map((c) => (c.id === data.channel.id ? data.channel : c)));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Błąd sterowania odtwarzaczem.');
    }
  };

  const handleRemoveQueued = async (videoId: string) => {
    if (!activeChannel) return;
    try {
      const data = await apiFetch<{ success: boolean; channel: VideoChannel }>(
        `/api/video/channels/${activeChannel.id}/queue/${videoId}`,
        { method: 'DELETE' }
      );
      if (data.success && data.channel) {
        setChannels((prev) => prev.map((c) => (c.id === data.channel.id ? data.channel : c)));
      }
    } catch {}
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    setCreatingChannel(true);
    setErrorMsg(null);
    try {
      const data = await apiFetch<{ success: boolean; channel: VideoChannel }>('/api/video/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newChannelName.trim() }),
      });
      if (data.success && data.channel) {
        setChannels((prev) => [...prev, data.channel]);
        setSelectedId(data.channel.id);
        setNewChannelName('');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Nie udało się utworzyć kanału.');
    } finally {
      setCreatingChannel(false);
    }
  };

  const handleVideoSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setErrorMsg(null);
    try {
      const data = await apiFetch<{ success: boolean; tracks: any[] }>(
        `/api/search?query=${encodeURIComponent(searchQuery)}`
      );
      setSearchResults(data.success ? data.tracks : []);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Wyszukiwanie nie powiodło się.');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-16 flex items-center justify-center text-slate-400 gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-[#5865F2]" />
        <span className="text-sm font-medium">Ładowanie kanałów wideo...</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-16">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Kanały Wideo i Watch Party</h2>
          <p className="text-sm text-slate-400 mt-1">
            Odtwarzaj filmy z YouTube, Twitch, Vimeo lub bezpośrednich linków MP4 z synchronizacją kolejki i komendą /video na Discordzie.
          </p>
        </div>

        <form onSubmit={handleCreateChannel} className="flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={newChannelName}
            onChange={(e) => setNewChannelName(e.target.value)}
            placeholder="np. nocny-seans"
            className="bg-[#18181B] border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#5865F2] w-44"
          />
          <button
            type="submit"
            disabled={creatingChannel || !newChannelName.trim()}
            className="px-4 py-2 bg-[#5865F2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Nowy kanał
          </button>
        </form>
      </div>

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-300 text-sm rounded-xl px-4 py-3">
          {errorMsg}
        </div>
      )}

      {/* Channel selector strip */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {channels.map((ch) => {
          const active = ch.id === activeChannel?.id;
          return (
            <button
              key={ch.id}
              onClick={() => setSelectedId(ch.id)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 border',
                active
                  ? 'bg-[#5865F2] text-white border-transparent'
                  : 'bg-[#111114] text-slate-400 border-white/10 hover:text-white hover:bg-[#18181B]'
              )}
            >
              <Tv className="w-4 h-4" />
              <span>#{ch.name}</span>
              <span className="text-xs font-mono opacity-75 tabular-nums">
                {ch.queue.length + (ch.currentVideo ? 1 : 0)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Theater + Queue Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 bg-[#111114] border border-white/10 rounded-2xl overflow-hidden">
          <div className="aspect-video bg-black relative flex items-center justify-center">
            {activeChannel?.currentVideo ? (
              activeChannel.currentVideo.provider === 'direct' ? (
                <video
                  key={activeChannel.currentVideo.id}
                  src={activeChannel.currentVideo.embedUrl}
                  controls
                  autoPlay={activeChannel.isPlaying}
                  className="w-full h-full object-contain bg-black"
                />
              ) : (
                <iframe
                  key={activeChannel.currentVideo.id}
                  src={activeChannel.currentVideo.embedUrl}
                  title={activeChannel.currentVideo.title}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              )
            ) : (
              <div className="text-center px-6 space-y-3">
                <Film className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="text-sm font-semibold text-white">Kanał #{activeChannel?.name} jest pusty</p>
                <p className="text-xs text-slate-500 max-w-sm">
                  Wklej link do filmu poniżej albo wyszukaj wideo na YouTube, aby rozpocząć wspólne oglądanie.
                </p>
              </div>
            )}
          </div>

          <div className="p-5 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white truncate">
                {activeChannel?.currentVideo?.title || 'Brak aktywnego wideo'}
              </h3>
              <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                <span>Kanał #{activeChannel?.name}</span>
                {activeChannel?.currentVideo && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{activeChannel.currentVideo.provider}</span>
                    <span aria-hidden="true">·</span>
                    <span>Dodał: {activeChannel.currentVideo.addedBy}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleControl('toggle')}
                disabled={!activeChannel?.currentVideo}
                className="px-3.5 py-2 bg-[#5865F2] hover:bg-[#4752c4] disabled:opacity-40 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {activeChannel?.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {activeChannel?.isPlaying ? 'Pauza' : 'Odtwarzaj'}
              </button>
              <button
                onClick={() => handleControl('next')}
                disabled={!activeChannel?.currentVideo && (activeChannel?.queue.length || 0) === 0}
                className="px-3 py-2 bg-[#18181B] hover:bg-white/10 disabled:opacity-40 text-slate-200 border border-white/10 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <SkipForward className="w-3.5 h-3.5" />
                Następny
              </button>
              <button
                onClick={() => handleControl('stop')}
                disabled={!activeChannel?.currentVideo}
                className="px-3 py-2 bg-[#18181B] hover:bg-red-500/20 disabled:opacity-40 text-slate-300 hover:text-red-300 border border-white/10 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </button>
              {activeChannel?.currentVideo?.url && (
                <a
                  href={activeChannel.currentVideo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="p-2 bg-[#18181B] hover:bg-white/10 text-slate-300 border border-white/10 rounded-lg"
                  title="Otwórz źródło"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Queue Panel */}
        <div className="bg-[#111114] border border-white/10 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Kolejka kanału</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-slate-400 tabular-nums">
                {activeChannel?.queue.length || 0} w kolejce
              </span>
              {(activeChannel?.queue.length || 0) > 0 && (
                <button
                  onClick={() => handleControl('clear')}
                  className="text-xs text-red-400 hover:text-red-300 font-semibold whitespace-nowrap shrink-0"
                >
                  Wyczyść
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
            {!activeChannel || activeChannel.queue.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500 border border-dashed border-white/10 rounded-xl">
                Brak filmów w kolejce dla #{activeChannel?.name}.
              </div>
            ) : (
              activeChannel.queue.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-3 bg-[#18181B] border border-white/5 rounded-xl"
                >
                  <span className="text-xs font-mono text-slate-500 w-5 tabular-nums">
                    {idx + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {item.provider} · {item.addedBy}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRemoveQueued(item.id)}
                    className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg transition-colors"
                    title="Usuń z kolejki"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Add Direct URL & YouTube Search */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-white">Odtwórz z linku (YouTube / Twitch / Vimeo / MP4)</h3>
          <div className="space-y-3">
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full bg-[#18181B] border border-white/10 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#5865F2]"
            />
            <input
              type="text"
              value={videoTitle}
              onChange={(e) => setVideoTitle(e.target.value)}
              placeholder="Opcjonalny tytuł filmu na kanale"
              className="w-full bg-[#18181B] border border-white/10 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#5865F2]"
            />
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                disabled={submitting || !videoUrl.trim()}
                onClick={() => handlePlayOrQueue(videoUrl, videoTitle, 'now')}
                className="flex-1 py-2.5 px-4 bg-[#5865F2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
              >
                Odtwórz teraz na #{activeChannel?.name}
              </button>
              <button
                type="button"
                disabled={submitting || !videoUrl.trim()}
                onClick={() => handlePlayOrQueue(videoUrl, videoTitle, 'queue')}
                className="py-2.5 px-4 bg-[#18181B] hover:bg-white/10 disabled:opacity-50 text-white border border-white/10 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                Dodaj do kolejki
              </button>
            </div>
          </div>
        </div>

        <div className="bg-[#111114] border border-white/10 rounded-2xl p-6 space-y-4">
          <h3 className="text-base font-bold text-white">Wyszukaj film na YouTube</h3>
          <form onSubmit={handleVideoSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Wpisz tytuł filmu, koncertu lub transmisji..."
                className="w-full bg-[#18181B] border border-white/10 text-white text-sm rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#5865F2]"
              />
            </div>
            <button
              type="submit"
              disabled={searching}
              className="px-4 py-3 bg-[#5865F2] hover:bg-[#4752c4] disabled:opacity-50 text-white text-xs font-semibold rounded-xl whitespace-nowrap shrink-0"
            >
              {searching ? 'Szukam...' : 'Szukaj'}
            </button>
          </form>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
            {searchResults.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                Wyniki wyszukiwania pojawią się tutaj.
              </p>
            ) : (
              searchResults.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="flex items-center gap-3 p-2.5 bg-[#18181B] border border-white/5 rounded-xl"
                >
                  {item.thumbnail && (
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      className="w-16 h-10 object-cover rounded-lg shrink-0 bg-black"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                    <p className="text-[11px] text-slate-500 truncate">
                      {item.author} · {item.duration}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handlePlayOrQueue(item.url, item.title, 'now')}
                      className="px-2.5 py-1.5 bg-[#5865F2] hover:bg-[#4752c4] text-white text-[11px] font-semibold rounded-lg whitespace-nowrap"
                    >
                      Oglądaj
                    </button>
                    <button
                      onClick={() => handlePlayOrQueue(item.url, item.title, 'queue')}
                      className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-semibold rounded-lg whitespace-nowrap"
                    >
                      + Kolejka
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
