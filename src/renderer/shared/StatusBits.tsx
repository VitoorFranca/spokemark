// Pieces shared by panel, main window and onboarding.
import { Download, X } from 'lucide-react';
import type { AppStateMsg, ModelStatusMsg, SpeakerModelStatusMsg, Status } from '../../shared/appIpc';
import type { StringKey } from '../../shared/i18n';
import { formatMB, formatSpeed } from './format';
import { api } from './hooks';
import { Button, ProgressBar, cx } from './ui';

type T = (k: StringKey, v?: Record<string, string | number>) => string;

export function statusLabel(s: Status, t: T): string {
  return t((`state.${s === 'processing' ? 'listening' : s}`) as StringKey);
}

export function StatusDot({ status }: { status: Status }) {
  const color = status === 'listening' || status === 'processing' ? 'var(--signal)'
    : status === 'silent' || status === 'loading' || status === 'stopping' || status === 'paused' ? 'var(--warning)'
    : status === 'permission' || status === 'error' || status === 'modelMissing' ? 'var(--danger)' : 'var(--text-3)';
  return <span aria-hidden className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: color }} />;
}

/** Audio level bars: driven only by level events, so they move only while capturing. */
export function LevelMeter({ db, active, label }: { db: number; active: boolean; label: string }) {
  const v = active ? Math.min(1, Math.max(0, (db + 60) / 50)) : 0;
  const bars = [0.55, 0.8, 1, 0.8, 0.55];
  return (
    <div role="meter" aria-label={label} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={active ? Math.round(db) : -60} className="flex h-4 items-center gap-[3px]">
      {bars.map((k, i) => (
        <span key={i} className="w-[3px] rounded-full transition-[height] duration-100 ease-out"
          style={{ height: `${Math.max(3, Math.round(16 * Math.min(1, v * k * 1.25)))}px`, background: active ? 'currentColor' : 'var(--text-3)', opacity: active ? 0.9 : 0.5 }} />
      ))}
    </div>
  );
}

/** Model download card / row content with progress, speed and cancel. */
export function ModelDownload({ model, t, compact }: { model: ModelStatusMsg; t: T; compact?: boolean }) {
  return <Download_ status={model} t={t} compact={compact} start={() => void api().request('model.download', model.id)} cancel={() => void api().request('model.cancel', model.id)} />;
}

/** The same for the speaker-change model. */
export function SpeakerModelDownload({ model, t, compact }: { model: SpeakerModelStatusMsg; t: T; compact?: boolean }) {
  return <Download_ status={model} t={t} compact={compact} label={t('speakers.download', { size: formatMB(model.bytes) })}
    start={() => void api().request('speakerModel.download')} cancel={() => void api().request('speakerModel.cancel')} />;
}

function Download_({ status, t, compact, label, start, cancel }: {
  status: { download: { received: number; total: number; bytesPerSec: number; phase: 'downloading' | 'verifying' } | null; error: string | null };
  t: T; compact?: boolean; label?: string; start: () => void; cancel: () => void;
}) {
  const d = status.download;
  if (!d) {
    return (
      <div className={cx('flex items-center gap-2', compact ? '' : 'flex-wrap')}>
        <Button variant="primary" icon={Download} onClick={start}>{status.error ? t('action.retry') : label ?? t('action.downloadModel')}</Button>
        {status.error && <span className="text-[12px] text-[var(--danger)]" title={status.error}>{t('model.downloadFailed')}</span>}
      </div>
    );
  }
  const pct = d.total ? d.received / d.total : 0;
  return (
    <div className="w-full">
      <div className="flex items-center gap-2">
        <div className="flex-1"><ProgressBar value={pct} label={label ?? t('action.downloadModel')} /></div>
        <button type="button" aria-label={t('action.cancel')} title={t('action.cancel')} onClick={cancel} className="rounded-full p-0.5 text-[var(--text-2)] hover:bg-[var(--surface-hover)]"><X size={14} strokeWidth={2} /></button>
      </div>
      <p className="mt-1 text-[12px] text-[var(--text-2)] tabular" aria-live="polite">
        {d.phase === 'verifying' ? t('model.verifying') : t('model.downloading', { done: formatMB(d.received), total: formatMB(d.total), speed: d.bytesPerSec > 0 ? formatSpeed(d.bytesPerSec) : '—' })}
      </p>
    </div>
  );
}

export const currentModel = (s: AppStateMsg) => s.models.find((m) => m.id === s.settings.model)!;
