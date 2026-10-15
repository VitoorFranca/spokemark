import { AppWindow, Info, Lock, LogOut, MessageSquareText, MoreHorizontal, Move, Play, Settings2, ShieldAlert, Square, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Command } from '../../shared/appIpc';
import { MODELS, speakerChangesActive, TURN_MODELS } from '../../shared/models';
import '../shared/base.css';
import { api, useAppState, useCommand, useLevel, useLive, useT } from '../shared/hooks';
import { lastLines } from '../shared/liveReducer';
import { currentModel, LevelMeter, ModelDownload, statusLabel, StatusDot } from '../shared/StatusBits';
import { WaveBackdrop } from '../shared/WaveBackdrop';
import { Button, Card, cx, IconButton, Kbd, Segmented, Select, Toggle } from '../shared/ui';
import { formatMB } from '../shared/format';
import { VAD_BYTES } from '../../shared/models';
import { APP_NAME } from '../../shared/brand';

const SIZES = [24, 28, 34, 40] as const;
const langName = (id: string, lang: string) => { try { return new Intl.DisplayNames([lang], { type: 'language' }).of(id) ?? id; } catch { return id; } };

function MoreMenu({ t, onClose }: { t: ReturnType<typeof useT>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(); }, []);
  const items = [
    { icon: Settings2, label: t('action.openSettings'), run: () => api().request('window.open', { window: 'settings' }) },
    { icon: AppWindow, label: t('action.openWindow'), run: () => api().request('window.open', { window: 'main' }) },
    { icon: Info, label: t('action.about'), run: () => api().request('window.open', { window: 'settings', tab: 'about' }) },
    { icon: LogOut, label: t('action.quit'), run: () => api().request('app.quit') },
  ];
  const onKey = (e: React.KeyboardEvent) => {
    const els = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
  };
  return (
    <div ref={ref} role="menu" aria-label={t('panel.more')} onKeyDown={onKey}
      className="fade-in absolute right-3 top-11 z-20 w-52 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[0_12px_32px_rgba(0,0,0,.35)]">
      {items.map((it, i) => (
        <div key={it.label}>
          {i === 3 && <div className="my-1 h-px bg-[var(--separator)]" />}
          <button type="button" role="menuitem" onClick={() => { onClose(); void it.run(); }}
            className="flex w-full items-center gap-2 rounded-[6px] px-2 h-7 text-left text-[13px] hover:bg-[var(--accent)] hover:text-[var(--on-accent)] focus-visible:bg-[var(--accent)] focus-visible:text-[var(--on-accent)] focus-visible:outline-none">
            <it.icon size={15} strokeWidth={1.75} aria-hidden />{it.label}
          </button>
        </div>
      ))}
    </div>
  );
}

function Panel() {
  const s = useAppState();
  const t = useT(s);
  const live = useLive();
  const db = useLevel();
  const [menu, setMenu] = useState(false);
  const mainBtn = useRef<HTMLButtonElement>(null);

  useCommand(useCallback((c: Command) => {
    if (c.type !== 'panel-shown') return;
    setMenu(false);
    requestAnimationFrame(() => { mainBtn.current?.focus({ focusVisible: false } as FocusOptions); requestAnimationFrame(() => void api().request('panel.rendered')); });
  }, []));
  // A cold-created panel may get 'panel-shown' before React mounts: focus the main control on mount too.
  const hasState = useAppState() !== null;
  useEffect(() => { if (hasState) mainBtn.current?.focus({ focusVisible: false } as FocusOptions); }, [hasState]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !menu) void api().request('panel.hide'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  if (!s) return null;
  const st = s.status;
  const capturing = st === 'listening' || st === 'processing' || st === 'silent';
  const model = currentModel(s);
  const preview = lastLines(live, 3);
  const installed = s.models.filter((m) => m.installed);

  return (
    <div className="relative isolate flex h-full flex-col p-3 gap-3 bg-[var(--bg)]" onClick={() => menu && setMenu(false)}>
      {/* sound waves behind the header while listening, driven by the real level */}
      {capturing && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[150px] fade-in [mask-image:linear-gradient(to_bottom,#000_55%,transparent)]">
          <WaveBackdrop animate={db > -50} db={db} dpr={1} top={0.95} time={9} className="opacity-70" />
        </div>
      )}
      {/* header */}
      <header className="flex items-center gap-2.5 px-1 pt-0.5">
        <img src="./icon.png" alt="" className="h-8 w-8 -my-0.5" />
        <div className="flex-1 min-w-0">
          <h1 className="text-[14px] font-semibold leading-tight">{APP_NAME}</h1>
          <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-2)]" aria-live="polite"><StatusDot status={st} />{statusLabel(st, t)}</p>
        </div>
        <IconButton icon={MoreHorizontal} label={t('panel.more')} aria-haspopup="menu" aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }} />
      </header>
      {menu && <MoreMenu t={t} onClose={() => setMenu(false)} />}

      {/* primary control */}
      <button ref={mainBtn} type="button" disabled={st === 'stopping' || (!s.running && (st === 'modelMissing' || s.errorKind === 'model'))}
        onClick={() => void api().request('captions.toggle')}
        aria-label={s.running ? t('action.stop') : t('action.start')}
        className={cx('flex h-14 w-full items-center gap-3 rounded-full pl-2 pr-5 text-left transition-[background-color,transform] duration-[var(--dur)] active:scale-[0.99] disabled:opacity-50',
          s.running || st === 'modelMissing' || s.errorKind === 'model'
            ? cx('bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-2)]', capturing && 'shadow-[var(--glow)]') // the card below holds the primary action; static ember glow while listening
            : 'bg-[var(--primary-bg)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]')}>
        <span className={cx('flex h-10 w-10 items-center justify-center rounded-full', s.running || st === 'modelMissing' || s.errorKind === 'model' ? 'bg-[var(--ember)] text-white' : 'bg-[var(--primary-fg)] text-[var(--primary-bg)]')}>
          {s.running ? <Square size={14} strokeWidth={2.2} fill="currentColor" aria-hidden /> : <Play size={16} strokeWidth={2.2} fill="currentColor" aria-hidden className="ml-0.5" />}
        </span>
        <span className="flex-1 text-[15px] font-semibold">{s.running ? t('action.stop') : t('action.start')}</span>
        {capturing && <span className="text-[var(--signal)]"><LevelMeter db={db} active label={t('panel.level')} /></span>}
      </button>

      {/* actionable states */}
      {st === 'permission' && (
        <Card tone="warning" className="p-3 fade-in">
          <div className="flex gap-2.5">
            <ShieldAlert size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--warning)]" aria-hidden />
            <div className="flex-1">
              <p className="text-[13px] font-semibold">{t('perm.title')}</p>
              <p className="mt-0.5 text-[12px] text-[var(--text-2)]">{t('perm.body')}</p>
              <Button className="mt-2" variant="primary" size="sm" onClick={() => void api().request('permission.openSettings')}>{t('action.openPrivacy')}</Button>
            </div>
          </div>
        </Card>
      )}
      {st === 'modelMissing' && (
        <Card tone="accent" className="p-3 fade-in">
          <p className="text-[13px] font-semibold">{t('model.missingTitle')}</p>
          <p className="mt-0.5 mb-2 text-[12px] text-[var(--text-2)]">{t('model.missingBody', { size: formatMB(model.bytes + (s.vadInstalled ? 0 : VAD_BYTES)) })}</p>
          <ModelDownload model={model} t={t} />
        </Card>
      )}
      {st === 'error' && (
        <Card tone="danger" className="p-3 fade-in">
          <div className="flex gap-2.5">
            <TriangleAlert size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--danger)]" aria-hidden />
            <div className="flex-1">
              <p className="text-[13px] font-semibold">{t('state.error')}</p>
              <p className="mt-0.5 text-[12px] text-[var(--text-2)]" title={s.errorMessage ?? undefined}>{t(s.errorKind === 'model' ? 'error.model' : s.errorKind === 'capture' ? 'error.capture' : 'error.generic')}</p>
              {s.errorKind === 'model'
                ? <Button className="mt-2" size="sm" variant="primary" onClick={() => void api().request('model.download', s.settings.model)}>{t('action.redownload')}</Button>
                : <Button className="mt-2" size="sm" onClick={() => void api().request('captions.toggle')}>{t('action.retry')}</Button>}
            </div>
          </div>
        </Card>
      )}

      {/* live preview */}
      <section aria-label={t('panel.live')} className="flex-1 min-h-0 rounded-[var(--r-lg)] bg-[var(--surface)] border border-[var(--border)] p-3 flex flex-col">
        <h2 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">{t('panel.live')}</h2>
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col justify-end selectable" aria-live="off">
          {preview.confirmed || preview.provisional ? (
            <p className="text-[14px] leading-[1.45] line-clamp-5 font-[family-name:var(--font-read)]">
              <span>{preview.confirmed}</span>{preview.provisional && <span className="text-[var(--text-2)]"> {preview.provisional}</span>}
            </p>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-[var(--text-2)]">
              {st !== 'modelMissing' && st !== 'error' && st !== 'permission' && <MessageSquareText size={22} strokeWidth={1.5} aria-hidden className="opacity-70" />}
              <p className="max-w-[230px] text-[13px]">{s.running ? t('panel.liveEmpty') : t('panel.liveIdle')}</p>
            </div>
          )}
        </div>
      </section>

      {/* quick actions */}
      <div className="rounded-[var(--r-lg)] bg-[var(--surface)] border border-[var(--border)] divide-y divide-[var(--separator)]">
        <div className="flex items-center gap-2 px-3 h-10">
          <span className="flex-1 text-[13px]">{t('panel.overlay')}</span>
          <IconButton icon={Move} label={t('panel.editOverlay')} onClick={() => void api().request('overlay.setEdit', !s.overlay.editMode)} aria-pressed={s.overlay.editMode} />
          <Toggle checked={s.overlay.visible} onChange={(v) => void api().request('overlay.setVisible', v)} label={t('panel.overlay')} />
        </div>
        {s.translation.available !== false && (
          <div className="flex items-center gap-2 px-3 h-10">
            <span className="flex-1 text-[13px]">{t('panel.translation')}</span>
            {s.settings.translationEnabled && <span className="text-[12px] text-[var(--text-2)]">{langName(s.settings.translationTarget, s.lang)}</span>}
            <Toggle checked={s.settings.translationEnabled} onChange={(v) => void api().request('settings.update', { translationEnabled: v })} label={t('panel.translation')} />
          </div>
        )}
        <div className="flex items-center gap-2 px-3 h-10">
          <span className="flex-1 text-[13px]">{t('panel.model')}</span>
          <Select label={t('panel.model')} value={s.settings.model} className="w-[150px]"
            options={(installed.some((m) => m.id === s.settings.model) ? installed : [model, ...installed]).map((m) => ({ value: m.id, label: t(MODELS[m.id].label) }))}
            onChange={(v) => void api().request('model.use', v)} />
        </div>
        {s.settings.speakerChanges && !speakerChangesActive(s.settings) && (
          <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--text-2)] hover:bg-[var(--surface-hover)]"
            onClick={() => void api().request('window.open', { window: 'settings', tab: 'transcription' })}>
            <Info size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-[var(--warning)]" />
            <span className="flex-1">{t('speakers.panelHint', { model: TURN_MODELS.map((id) => t(MODELS[id].label)).join(', ') })}</span>
          </button>
        )}
        <div className="flex items-center gap-2 px-3 h-10">
          <span className="flex-1 text-[13px]">{t('panel.size')}</span>
          <Segmented size="sm" label={t('panel.size')} value={String(SIZES.reduce((a, b) => (Math.abs(b - s.settings.fontSize) < Math.abs(a - s.settings.fontSize) ? b : a)))}
            options={SIZES.map((n, i) => ({ value: String(n), label: <span style={{ fontSize: 10 + i * 1.5 }}>A</span>, aria: `${n} pt` }))}
            onChange={(v) => void api().request('settings.update', { fontSize: Number(v) })} />
        </div>
      </div>

      {/* footer */}
      <footer className="flex items-center gap-1.5 px-1 text-[11px] text-[var(--text-2)]">
        <Lock size={12} strokeWidth={1.75} aria-hidden />
        <span className="flex-1">{t('panel.local')}</span>
        <Kbd accel={s.settings.shortcutToggle} />
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Panel />);
