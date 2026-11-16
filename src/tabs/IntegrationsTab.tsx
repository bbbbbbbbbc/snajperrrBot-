import React, { useState, useEffect, useCallback } from 'react';
import {
  Plug,
  Search,
  CheckCircle2,
  ExternalLink,
  SlidersHorizontal,
  Send,
  X,
  Loader2,
  Power,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  IntegrationConnection,
  IntegrationDefinition,
  IntegrationProtocol,
} from '../types';
import { cn } from '../lib/utils';

type IntegrationWithConn = IntegrationDefinition & {
  connection: IntegrationConnection | null;
};

interface IntegrationsResponse {
  success: boolean;
  totalCatalog: number;
  totalFiltered: number;
  connectedCount: number;
  page: number;
  limit: number;
  totalPages: number;
  categories: string[];
  protocols: IntegrationProtocol[];
  items: IntegrationWithConn[];
}

const PROTOCOL_LABELS: Record<IntegrationProtocol, string> = {
  webhook: 'Webhook',
  api_key: 'API Key',
  oauth2: 'OAuth 2.0',
  bot_command: 'Bot Command',
};

const ALL_EVENTS = [
  { id: 'track_started', label: 'Start utworu' },
  { id: 'track_queued', label: 'Dodanie utworu do kolejki' },
  { id: 'video_queued', label: 'Odtworzenie filmu na kanale' },
  { id: 'voucher_redeemed', label: 'Aktywacja vouchera' },
  { id: 'broadcast_sent', label: 'Globalne ogłoszenie' },
  { id: 'bug_reported', label: 'Nowe zgłoszenie błędu' },
  { id: 'error_alert', label: 'Alert błędu systemu' },
];

export const IntegrationsTab: React.FC = () => {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [protocol, setProtocol] = useState<'all' | IntegrationProtocol>('all');
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Configuration Drawer state
  const [selected, setSelected] = useState<IntegrationWithConn | null>(null);
  const [endpointUrl, setEndpointUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [channelTarget, setChannelTarget] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  const fetchIntegrations = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams({
        q: debouncedQuery,
        category,
        protocol,
        connectedOnly: String(connectedOnly),
        page: String(page),
        limit: '48',
      });
      const res = await apiFetch<IntegrationsResponse>(`/api/integrations?${params.toString()}`);
      setData(res);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Nie udało się załadować integracji.');
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, category, protocol, connectedOnly, page]);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const openConfig = (item: IntegrationWithConn) => {
    setSelected(item);
    setEndpointUrl(item.connection?.endpointUrl || '');
    setApiKey(item.connection?.apiKey || '');
    setChannelTarget(item.connection?.channelTarget || '');
    setSelectedEvents(item.connection?.events || item.defaultEvents);
    setTestResult(null);
  };

  const handleToggleEvent = (eventId: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId]
    );
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setTestResult(null);
    try {
      const res = await apiFetch<{ success: boolean; connection: IntegrationConnection }>(
        `/api/integrations/${selected.id}/connect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: true,
            endpointUrl,
            apiKey,
            channelTarget,
            events: selectedEvents,
          }),
        }
      );
      if (res.success) {
        setTestResult({ ok: true, text: 'Integracja zapisana i aktywna.' });
        await fetchIntegrations();
        setSelected((prev) => (prev ? { ...prev, connection: res.connection } : null));
      }
    } catch (err: any) {
      setTestResult({ ok: false, text: err?.message || 'Błąd zapisu.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!selected) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch<{ success: boolean; message?: string; error?: string }>(
        `/api/integrations/${selected.id}/test`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpointUrl, apiKey }),
        }
      );
      setTestResult({
        ok: Boolean(res.success),
        text: res.message || res.error || 'Zakończono test.',
      });
      await fetchIntegrations();
    } catch (err: any) {
      setTestResult({ ok: false, text: err?.message || 'Test nie powiódł się.' });
    } finally {
      setTesting(false);
    }
  };

  const handleQuickToggle = async (item: IntegrationWithConn) => {
    try {
      await apiFetch(`/api/integrations/${item.id}/toggle`, { method: 'POST' });
      await fetchIntegrations();
    } catch {}
  };

  const handleDisconnect = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/api/integrations/${selected.id}`, { method: 'DELETE' });
      setSelected(null);
      await fetchIntegrations();
    } catch {}
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      {/* Header & Metrics */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Katalog Integracji</h2>
          <p className="text-sm text-slate-400 mt-1">
            Podłącz ponad 1,000 usług audio, wideo, webhooków, baz danych, botów i narzędzi automatyzacji.
          </p>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <div>
            <p className="text-xs text-slate-500">Dostępne</p>
            <p className="text-xl font-bold font-mono text-white tabular-nums">
              {data?.totalCatalog ?? 1040}
            </p>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div>
            <p className="text-xs text-slate-500">Aktywne</p>
            <p className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
              {data?.connectedCount ?? 0}
            </p>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div>
            <p className="text-xs text-slate-500">Kategorie</p>
            <p className="text-xl font-bold font-mono text-indigo-400 tabular-nums">
              {data?.categories.length ?? 16}
            </p>
          </div>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-[#111114] border border-white/10 rounded-2xl p-4 space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj integracji (np. Spotify, OBS, Hostinger, Slack, Twitch, Stripe)..."
              className="w-full bg-[#18181B] border border-white/10 text-white text-sm rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#5865F2]"
            />
          </div>

          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="bg-[#18181B] border border-white/10 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#5865F2]"
          >
            <option value="all">Wszystkie kategorie ({data?.categories.length ?? 16})</option>
            {(data?.categories || []).map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              setConnectedOnly((v) => !v);
              setPage(1);
            }}
            className={cn(
              'px-4 py-2.5 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 flex items-center gap-2',
              connectedOnly
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-[#18181B] text-slate-300 border-white/10 hover:bg-white/5'
            )}
          >
            <CheckCircle2 className="w-4 h-4" />
            Tylko aktywne
          </button>
        </div>

        {/* Protocol segmented controls */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
          {(['all', 'webhook', 'api_key', 'oauth2', 'bot_command'] as const).map((p) => (
            <button
              key={p}
              onClick={() => {
                setProtocol(p);
                setPage(1);
              }}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0',
                protocol === p
                  ? 'bg-[#5865F2] text-white'
                  : 'bg-[#18181B] text-slate-400 hover:text-white'
              )}
            >
              {p === 'all' ? 'Wszystkie protokoły' : PROTOCOL_LABELS[p]}
            </button>
          ))}
          <span className="ml-auto text-xs font-mono text-slate-500 tabular-nums whitespace-nowrap shrink-0">
            Wyniki: {data?.totalFiltered ?? 0}
          </span>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-300 text-sm rounded-xl px-4 py-3">
          {errorMsg}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, idx) => (
            <div
              key={idx}
              className="h-40 bg-[#111114] border border-white/5 rounded-2xl animate-pulse"
            />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="bg-[#111114] border border-white/10 rounded-2xl p-12 text-center space-y-3">
          <Plug className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm font-semibold text-white">Brak pasujących integracji</p>
          <p className="text-xs text-slate-500">
            Zmień frazę wyszukiwania lub wyczyść filtry kategorii i protokołów.
          </p>
          <button
            onClick={() => {
              setQuery('');
              setCategory('all');
              setProtocol('all');
              setConnectedOnly(false);
              setPage(1);
            }}
            className="px-4 py-2 bg-[#5865F2] text-white text-xs font-semibold rounded-lg"
          >
            Resetuj filtry
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.items.map((item) => {
              const isEnabled = Boolean(item.connection?.enabled);
              return (
                <div
                  key={item.id}
                  className={cn(
                    'bg-[#111114] border rounded-2xl p-5 flex flex-col justify-between gap-4 transition-colors',
                    isEnabled
                      ? 'border-emerald-500/30 hover:border-emerald-500/50'
                      : 'border-white/10 hover:border-white/20'
                  )}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-base font-bold text-white truncate">{item.name}</h3>
                      <button
                        onClick={() => handleQuickToggle(item)}
                        title={isEnabled ? 'Wyłącz integrację' : 'Włącz integrację'}
                        className={cn(
                          'p-1.5 rounded-lg border transition-colors shrink-0',
                          isEnabled
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            : 'bg-[#18181B] text-slate-500 border-white/10 hover:text-white'
                        )}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                      <span>{item.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{PROTOCOL_LABELS[item.protocol]}</span>
                      <span aria-hidden="true">·</span>
                      <span className={isEnabled ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                        {isEnabled ? 'Aktywna' : 'Niepodłączona'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                      {item.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-white/5 gap-2">
                    <a
                      href={item.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-slate-400 hover:text-white flex items-center gap-1 whitespace-nowrap shrink-0"
                    >
                      Dokumentacja
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <button
                      onClick={() => openConfig(item)}
                      className="px-3.5 py-1.5 bg-[#18181B] hover:bg-[#5865F2] text-slate-200 hover:text-white border border-white/10 hover:border-transparent rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      Konfiguruj
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-white/5">
              <p className="text-xs text-slate-400 font-mono tabular-nums">
                Strona {data.page} z {data.totalPages} ({data.totalFiltered} integracji)
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={data.page <= 1}
                  className="px-3 py-2 bg-[#111114] border border-white/10 rounded-lg text-xs font-semibold text-slate-300 disabled:opacity-40 flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Poprzednia
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  disabled={data.page >= data.totalPages}
                  className="px-3 py-2 bg-[#111114] border border-white/10 rounded-lg text-xs font-semibold text-slate-300 disabled:opacity-40 flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  Następna
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Configuration Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-[#111114] border border-white/10 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">{selected.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selected.category} · {PROTOCOL_LABELS[selected.protocol]}
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-2 text-slate-400 hover:text-white bg-white/5 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">{selected.description}</p>

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Endpoint / Webhook URL
                </label>
                <input
                  type="url"
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                  placeholder="https://hooks.example.com/..."
                  className="w-full bg-[#18181B] border border-white/10 text-white text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#5865F2]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Klucz API / Bearer Token (opcjonalny)
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk_live_... lub token autoryzacyjny"
                  className="w-full bg-[#18181B] border border-white/10 text-white text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#5865F2]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Kanał docelowy / ID zasobu
                </label>
                <input
                  type="text"
                  value={channelTarget}
                  onChange={(e) => setChannelTarget(e.target.value)}
                  placeholder="np. #muzyka-powiadomienia lub ID kanału"
                  className="w-full bg-[#18181B] border border-white/10 text-white text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#5865F2]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Wyzwalacze zdarzeń
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ALL_EVENTS.map((ev) => {
                    const checked = selectedEvents.includes(ev.id);
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => handleToggleEvent(ev.id)}
                        className={cn(
                          'px-3 py-2 rounded-lg text-xs text-left font-medium border transition-colors',
                          checked
                            ? 'bg-[#5865F2]/20 text-white border-[#5865F2]/60'
                            : 'bg-[#18181B] text-slate-400 border-white/10 hover:text-white'
                        )}
                      >
                        {ev.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {testResult && (
                <div
                  className={cn(
                    'text-xs rounded-xl px-3.5 py-2.5 border',
                    testResult.ok
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
                  )}
                >
                  {testResult.text}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing}
                  className="px-4 py-2.5 bg-[#18181B] hover:bg-white/10 text-white border border-white/10 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Testuj połączenie
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 px-4 bg-[#5865F2] hover:bg-[#4752c4] text-white rounded-xl text-xs font-semibold whitespace-nowrap"
                >
                  {saving ? 'Zapisywanie...' : 'Zapisz i aktywuj'}
                </button>

                {selected.connection && (
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="p-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl"
                    title="Rozłącz integrację"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
