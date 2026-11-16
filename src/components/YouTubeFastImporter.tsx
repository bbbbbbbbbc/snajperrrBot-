import React, { useState } from 'react';
import {
  Zap,
  ListVideo,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  Download,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { apiFetch } from '../lib/api';

interface YouTubeFastImporterProps {
  targetType: 'music' | 'video';
  targetId: string;
  targetLabel?: string;
  onImported?: (result: {
    importedCount: number;
    durationMs: number;
    sourceTitle?: string;
  }) => void;
}

interface PreviewTrack {
  videoId: string;
  title: string;
  author: string;
  duration: string;
  thumbnail: string;
  url: string;
}

export const YouTubeFastImporter: React.FC<YouTubeFastImporterProps> = ({
  targetType,
  targetId,
  targetLabel,
  onImported,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [source, setSource] = useState('');
  const [maxItems, setMaxItems] = useState(50);
  const [mode, setMode] = useState<'now' | 'queue'>('queue');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewTracks, setPreviewTracks] = useState<PreviewTrack[]>([]);
  const [previewMeta, setPreviewMeta] = useState<{
    sourceTitle?: string;
    durationMs: number;
    cacheHits: number;
  } | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handlePreview = async () => {
    if (!source.trim()) return;
    setLoadingPreview(true);
    setStatusMsg(null);
    try {
      const data = await apiFetch('/api/youtube/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, maxItems }),
      });
      if (data.success) {
        setPreviewTracks(data.tracks || []);
        setPreviewMeta({
          sourceTitle: data.sourceTitle,
          durationMs: data.durationMs || 0,
          cacheHits: data.cacheHits || 0,
        });
      } else {
        setStatusMsg({ type: 'error', text: data.error || 'Nie udało się odczytać źródła YouTube.' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Błąd połączenia podczas podglądu.' });
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleImport = async () => {
    if (!source.trim()) return;
    setImporting(true);
    setStatusMsg(null);
    try {
      const data = await apiFetch('/api/youtube/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          targetType,
          targetId,
          mode,
          maxItems,
        }),
      });
      if (data.success) {
        setStatusMsg({
          type: 'success',
          text: `Zaimportowano ${data.importedCount} pozycji w ${data.durationMs} ms (cache hits: ${data.cacheHits}).`,
        });
        setSource('');
        setPreviewTracks([]);
        setPreviewMeta(null);
        onImported?.({
          importedCount: data.importedCount,
          durationMs: data.durationMs,
          sourceTitle: data.sourceTitle,
        });
      } else {
        setStatusMsg({ type: 'error', text: data.error || 'Import nie powiódł się.' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Błąd podczas importu z YouTube.' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="bg-[#111114] border border-white/10 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-5 py-4 flex items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-red-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-white truncate">
                Szybki Import YouTube (Playlisty · Kanały · Lista linków)
              </h4>
              <span className="text-[11px] font-mono text-emerald-400 shrink-0">Turbo Batch</span>
            </div>
            <p className="text-xs text-slate-400 truncate">
              Wklej link do playlisty, kanału YouTube lub wiele linków naraz — cel:{' '}
              <span className="text-slate-200 font-semibold">{targetLabel || targetId}</span>
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-5 pb-5 pt-2 border-t border-white/5 space-y-4">
          <textarea
            rows={3}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={
              'Wklej link do playlisty (youtube.com/playlist?list=...), kanału (@nazwa) albo wiele linków/tytułów w osobnych liniach...'
            }
            className="w-full bg-[#18181B] border border-white/10 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#5865F2] placeholder:text-slate-600 custom-scrollbar"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <span>Limit:</span>
                <select
                  value={maxItems}
                  onChange={(e) => setMaxItems(Number(e.target.value))}
                  className="bg-[#18181B] border border-white/10 text-white text-xs rounded-lg px-2.5 py-1.5"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </label>

              {targetType === 'video' && (
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'now' | 'queue')}
                  className="bg-[#18181B] border border-white/10 text-white text-xs rounded-lg px-2.5 py-1.5"
                >
                  <option value="now">Odtwórz pierwszy i zakolejkuj resztę</option>
                  <option value="queue">Dodaj wszystko do kolejki</option>
                </select>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePreview}
                disabled={loadingPreview || importing || !source.trim()}
                className="px-3.5 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                {loadingPreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                Podgląd
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={importing || loadingPreview || !source.trim()}
                className="px-4 py-2 bg-[#5865F2] hover:bg-[#4752c4] disabled:opacity-40 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Importuj do {targetType === 'video' ? 'kanału' : 'kolejki'}
              </button>
            </div>
          </div>

          {statusMsg && (
            <div
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-medium border ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                  : 'bg-red-500/10 border-red-500/20 text-red-300'
              }`}
            >
              {statusMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{statusMsg.text}</span>
            </div>
          )}

          {previewTracks.length > 0 && previewMeta && (
            <div className="bg-[#18181B] border border-white/10 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-white/5">
                <span className="flex items-center gap-1.5 font-semibold text-white">
                  <ListVideo className="w-4 h-4 text-red-400" />
                  {previewMeta.sourceTitle || 'Znalezione pozycje'} ({previewTracks.length})
                </span>
                <span className="font-mono tabular-nums text-emerald-400">
                  {previewMeta.durationMs} ms · cache hits: {previewMeta.cacheHits}
                </span>
              </div>
              <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                {previewTracks.slice(0, 20).map((t) => (
                  <div key={t.videoId} className="flex items-center gap-2.5 text-xs py-1">
                    <img
                      src={t.thumbnail}
                      alt={t.title}
                      referrerPolicy="no-referrer"
                      className="w-10 h-6 rounded object-cover shrink-0 bg-black"
                    />
                    <span className="text-slate-200 truncate flex-1">{t.title}</span>
                    <span className="text-slate-500 font-mono tabular-nums shrink-0">{t.duration}</span>
                  </div>
                ))}
                {previewTracks.length > 20 && (
                  <p className="text-[11px] text-slate-500 pt-1">
                    ... oraz jeszcze {previewTracks.length - 20} kolejnych pozycji.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
