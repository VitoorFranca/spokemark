import { Captions, Check, Cpu, FolderOpen, Info, Keyboard, Lock, Settings2, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SETTINGS_TABS, type AppStateMsg, type Command } from '../../shared/appIpc';
import { APP_NAME } from '../../shared/brand';
import { LANG_NAMES } from '../../shared/i18n';
import { MODELS } from '../../shared/models';
import { CAPTION_FONTS, CAPTION_PRESETS, MODEL_IDS, type Settings } from '../../shared/settings';
import '../shared/base.css';
import { CaptionBox, type CaptionLine } from '../shared/CaptionBox';
import { formatMB } from '../shared/format';
import { api, useAppState, useCommand, useT } from '../shared/hooks';
import { ModelDownload } from '../shared/StatusBits';
import { Button, cx, Kbd, ListRow, Section, Segmented, Select, Slider, Toggle, ToolbarTab } from '../shared/ui';

type Tab = (typeof SETTINGS_TABS)[number];
type T = ReturnType<typeof useT>;
const set = (patch: Partial<Settings>) => void api().request('settings.update', patch);

// ---- shortcut recorder ----------------------------------------------------------------------
const KEYMAP: Record<string, string> = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Return', Backspace: 'Backspace', Tab: 'Tab' };
function toAccelerator(e: React.KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;
  const key = KEYMAP[e.key] ?? (/^F\d{1,2}$/.test(e.key) ? e.key : e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : null);
  if (!key) return null;
  const mods = [e.metaKey && 'CommandOrControl', e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[];
  if (!mods.some((m) => m !== 'Shift')) return null; // needs ⌘, ⌃ or ⌥
  return [...mods, key].join('+');
}
function ShortcutField({ value, onChange, label, t, error }: { value: string; onChange: (v: string) => void; label: string; t: T; error: boolean }) {
  const [rec, setRec] = useState(false);
  return (
    <div className="flex flex-col items-end">
      <button type="button" aria-label={`${label}: ${value}`} onClick={() => setRec(true)} onBlur={() => setRec(false)}
        onKeyDown={(e) => {
          if (!rec) return;
          e.preventDefault();
          if (e.key === 'Escape') { setRec(false); return; }
          const acc = toAccelerator(e);
          if (acc) { onChange(acc); setRec(false); }
        }}
        className={cx('h-7 min-w-[110px] rounded-[6px] border px-2.5 text-[12px] shadow-[var(--shadow-1)]', rec ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]' : 'border-[var(--border)] bg-[var(--surface)]', error && !rec && 'border-[var(--danger)]')}>
        {rec ? t('general.shortcutRecord') : <Kbd accel={value} className="text-[var(--text)]" />}
      </button>
      {error && <span className="mt-1 text-[11px] text-[var(--danger)]">{t('general.shortcutTaken')}</span>}
    </div>
  );
}

// ---- tabs --------------------------------------------------------------------------------------
function General({ s, t }: { s: AppStateMsg; t: T }) {
  const st = s.settings;
  return (
    <>
      <Section title={t('general.startup')} footer={t('general.dockHint')}>
        <ListRow label={t('general.launchAtLogin')}><Toggle label={t('general.launchAtLogin')} checked={st.launchAtLogin} onChange={(v) => set({ launchAtLogin: v })} /></ListRow>
        <ListRow label={t('general.dockAlways')}><Toggle label={t('general.dockAlways')} checked={st.dockAlways} onChange={(v) => set({ dockAlways: v })} /></ListRow>
      </Section>
      <Section title={t('general.shortcuts')}>
        {([['shortcutToggle', 'general.shortcutToggle'], ['shortcutOverlay', 'general.shortcutOverlay'], ['shortcutEdit', 'general.shortcutEdit']] as const).map(([k, label]) => (
          <ListRow key={k} label={t(label)} icon={Keyboard}>
            <ShortcutField value={st[k]} label={t(label)} t={t} error={s.shortcutErrors.includes(k)} onChange={(v) => set({ [k]: v })} />
          </ListRow>
        ))}
      </Section>
      <Section title={t('general.language')}>
        <ListRow label={t('general.language')}>
          <Select label={t('general.language')} value={st.language} className="w-[210px]"
            options={[{ value: 'system', label: t('general.languageSystem', { lang: LANG_NAMES[s.systemLang] }) }, { value: 'pt-BR', label: LANG_NAMES['pt-BR'] }, { value: 'en', label: LANG_NAMES.en }]}
            onChange={(v) => set({ language: v })} />
        </ListRow>
      </Section>
    </>
  );
}

/** Animated sample captions: words appear like the real thing (confirmed + provisional tail). */
function usePreviewLines(t: T, replayKey: string): CaptionLine[] {
  const words = `${t('captions.previewText1')} ${t('captions.previewText2')}`.split(' ');
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [n, setN] = useState(reduce ? words.length : 3);
  // Plays once when the tab opens and again when the style changes, then stays still (no endless loop).
  useEffect(() => {
    if (reduce) return;
    setN(3);
    const id = setInterval(() => setN((x) => { if (x >= words.length + 2) { clearInterval(id); return x; } return x + 1; }), 240);
    return () => clearInterval(id);
  }, [words.length, reduce, replayKey]);
  const shown = Math.min(n, words.length);
  const confirmed = words.slice(0, Math.max(0, shown - 2));
  const prov = words.slice(Math.max(0, shown - 2), shown);
  const split = t('captions.previewText1').split(' ').length;
  const l1c = confirmed.slice(0, split).join(' '), l1p = shown - 2 < split ? prov.slice(0, Math.max(0, split - confirmed.length)).join(' ') : '';
  const l2all = [...confirmed.slice(split), ...prov.slice(Math.max(0, split - confirmed.length))];
  const l2c = confirmed.slice(split).join(' '), l2p = l2all.slice(confirmed.slice(split).length).join(' ');
  return [{ id: 1, committed: l1c, provisional: l1p }, ...(l2all.length ? [{ id: 2, committed: l2c, provisional: l2p }] : [])];
}

function CaptionsTab({ s, t }: { s: AppStateMsg; t: T }) {
  const st = s.settings;
  const lines = usePreviewLines(t, `${st.captionPreset}|${st.captionFont}|${st.maxLines}`);
  return (
    <>
      <div aria-label={t('captions.preview')} role="img" className="mb-5 overflow-hidden rounded-[12px] border border-[var(--border)]"
        style={{ background: 'linear-gradient(135deg,#3a4a5c 0%,#6b5a4e 55%,#2c3440 100%)' }}>
        <div className="flex h-[200px] items-end justify-center px-8 pb-5">
          <div className="w-full max-w-[520px]"><CaptionBox look={{ ...st, fontSize: Math.round(st.fontSize * 0.75) }} lines={lines} /></div>
        </div>
      </div>
      <Section title={t('captions.style')}>
        <ListRow label={t('captions.preset')}>
          <Segmented label={t('captions.preset')} value={st.captionPreset} options={CAPTION_PRESETS.map((p) => ({ value: p, label: t(`preset.${p}`) }))} onChange={(v) => void api().request('settings.applyPreset', v)} />
        </ListRow>
        <ListRow label={t('captions.font')}>
          <Select label={t('captions.font')} value={st.captionFont} className="w-[170px]" options={CAPTION_FONTS.map((f) => ({ value: f, label: t(`font.${f}`) }))} onChange={(v) => set({ captionFont: v })} />
        </ListRow>
        <ListRow label={t('captions.size')}><div className="w-[220px]"><Slider label={t('captions.size')} min={18} max={56} value={st.fontSize} onChange={(v) => set({ fontSize: v })} format={(v) => `${v} pt`} /></div></ListRow>
        <ListRow label={t('captions.opacity')}><div className="w-[220px]"><Slider label={t('captions.opacity')} min={0} max={100} step={5} value={Math.round(st.opacity * 100)} onChange={(v) => set({ opacity: v / 100 })} format={(v) => `${v}%`} /></div></ListRow>
        <ListRow label={t('captions.lines')}>
          <Segmented label={t('captions.lines')} value={String(st.maxLines)} options={[{ value: '2', label: '2' }, { value: '3', label: '3' }]} onChange={(v) => set({ maxLines: Number(v) })} />
        </ListRow>
      </Section>
      <Section title={t('captions.placement')}>
        <ListRow label={t('captions.position')}>
          <Segmented label={t('captions.position')} value={st.captionPosition} options={[{ value: 'bottom', label: t('position.bottom') }, { value: 'top', label: t('position.top') }]} onChange={(v) => set({ captionPosition: v })} />
        </ListRow>
        <ListRow label={t('captions.display')}>
          <Select label={t('captions.display')} value={st.captionDisplay} className="w-[210px]"
            options={[{ value: 'cursor', label: t('display.cursor') }, ...s.displays.map((d) => ({ value: d.id, label: d.label }))]} onChange={(v) => set({ captionDisplay: v })} />
        </ListRow>
        <ListRow label={t('captions.hideInShare')} description={t('captions.hideInShareHint')}>
          <Toggle label={t('captions.hideInShare')} checked={st.contentProtection} onChange={(v) => set({ contentProtection: v })} />
        </ListRow>
      </Section>
    </>
  );
}

function Rating({ label, value }: { label: string; value: string }) {
  return <span className="text-[12px] text-[var(--text-2)]">{label}: <span className="text-[var(--text)]">{value}</span></span>;
}

function TranscriptionTab({ s, t }: { s: AppStateMsg; t: T }) {
  return (
    <>
      <Section title={t('transcription.models')}>
        {MODEL_IDS.map((id) => {
          const m = s.models.find((x) => x.id === id)!;
          const meta = MODELS[id];
          const inUse = s.settings.model === id;
          return (
            <div key={id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">{inUse && m.installed && <Check size={16} strokeWidth={2.2} className="text-[var(--accent)]" aria-label={t('transcription.inUse')} />}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium">{t(meta.label)}</span>
                  <span className="text-[11px] text-[var(--text-3)]">{id} · {formatMB(meta.bytes)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3">
                  <Rating label={t('transcription.speed')} value={t(meta.speed)} />
                  <Rating label={t('transcription.accuracy')} value={t(meta.accuracy)} />
                </div>
                {meta.turns && <p className="mt-0.5 text-[12px] text-[var(--text-2)]">{t('transcription.turns')}</p>}
                {m.download && <div className="mt-2 max-w-[360px]"><ModelDownload model={m} t={t} /></div>}
                {m.error && !m.download && <p className="mt-1 text-[12px] text-[var(--danger)]" title={m.error}>{t('model.downloadFailed')}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!m.installed && !m.download && <Button size="sm" onClick={() => void api().request('model.download', id)}>{t('action.download')}</Button>}
                {m.installed && !inUse && <Button size="sm" onClick={() => void api().request('model.use', id)}>{t('action.useModel')}</Button>}
                {m.installed && !inUse && <Button size="sm" variant="ghost" aria-label={`${t('action.remove')} ${t(meta.label)}`} onClick={() => void api().request('model.remove', id)}>{t('action.remove')}</Button>}
                {inUse && <span className="text-[12px] font-medium text-[var(--accent)]">{t('transcription.inUse')}</span>}
              </div>
            </div>
          );
        })}
      </Section>
      <Section title={t('transcription.language')} footer={t('transcription.languageHint')}>
        <ListRow label={t('transcription.language')}><span className="text-[13px] text-[var(--text-2)]">{t('transcription.languageValue')}</span></ListRow>
      </Section>
    </>
  );
}

function PrivacyTab({ s, t }: { s: AppStateMsg; t: T }) {
  const st = s.settings;
  const granted = s.permission === 'granted';
  return (
    <>
      <Section title={t('privacy.whatTitle')}>
        <ListRow icon={Lock} label={t('privacy.notStored')} />
        <ListRow icon={ShieldCheck} label={t('privacy.stored')} />
      </Section>
      <Section title={t('privacy.history')}>
        <ListRow label={t('privacy.saveHistory')}><Toggle label={t('privacy.saveHistory')} checked={st.historyEnabled} onChange={(v) => set({ historyEnabled: v })} /></ListRow>
        <ListRow label={t('privacy.retention')}>
          <Select label={t('privacy.retention')} value={String(st.retentionDays)} className="w-[140px]"
            options={(['7', '30', '90', '365', '0'] as const).map((d) => ({ value: d, label: t(`retention.${d}`) }))} onChange={(v) => set({ retentionDays: Number(v) })} />
        </ListRow>
        <ListRow label={t('privacy.deleteAll')}>
          <Button variant="danger" size="sm" icon={Trash2} onClick={() => void api().request('history.deleteRange', 'all')}>{t('action.delete')}</Button>
        </ListRow>
      </Section>
      <Section title={t('privacy.permission')}>
        <ListRow icon={granted ? ShieldCheck : ShieldAlert} label={granted ? t('privacy.permissionGranted') : t('privacy.permissionMissing')}>
          <Button size="sm" variant={granted ? 'secondary' : 'primary'} onClick={() => void api().request('permission.openSettings')}>{t('action.openPrivacy')}</Button>
        </ListRow>
      </Section>
    </>
  );
}

function AboutTab({ s, t }: { s: AppStateMsg; t: T }) {
  return (
    <>
      <div className="mb-6 flex items-center gap-4">
        <img src="./icon.png" alt="" className="h-16 w-16" />
        <div>
          <h2 className="text-[20px] font-semibold">{APP_NAME}</h2>
          <p className="text-[13px] text-[var(--text-2)]">{t('about.version', { v: s.app.version })}</p>
        </div>
      </div>
      <Section title={t('about.data')}>
        <ListRow label={<span className="selectable font-mono text-[12px]">{s.app.dataDir}</span>}>
          <Button size="sm" icon={FolderOpen} onClick={() => void api().request('app.revealData')}>{t('about.reveal')}</Button>
        </ListRow>
      </Section>
      <Section title={t('about.licenses')}>
        {(['about.whisper', 'about.models', 'about.tdrz', 'about.silero', 'about.electron', 'about.lucide'] as const).map((k) => <ListRow key={k} label={t(k)} />)}
      </Section>
    </>
  );
}

// ---- window ------------------------------------------------------------------------------------
const ICONS = { general: Settings2, captions: Captions, transcription: Cpu, privacy: Lock, about: Info };

function SettingsWindow() {
  const s = useAppState();
  const t = useT(s);
  const initial = new URLSearchParams(location.search).get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(initial && SETTINGS_TABS.includes(initial) ? initial : 'general');
  useCommand(useCallback((c: Command) => { if (c.type === 'show-tab' && SETTINGS_TABS.includes(c.tab as Tab)) setTab(c.tab as Tab); }, []));
  useEffect(() => { if (s) document.title = t(`tab.${tab}`); }, [tab, s, t]);
  if (!s) return null;
  const onKey = (e: React.KeyboardEvent) => {
    const i = SETTINGS_TABS.indexOf(tab);
    if (e.key === 'ArrowRight') setTab(SETTINGS_TABS[(i + 1) % SETTINGS_TABS.length]!);
    if (e.key === 'ArrowLeft') setTab(SETTINGS_TABS[(i - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length]!);
  };
  return (
    <div className="flex h-full flex-col">
      <header className="drag shrink-0 border-b border-[var(--separator)] pt-[30px] pb-1.5">
        <div role="tablist" aria-label={t('settings.title')} onKeyDown={onKey} className="flex justify-center gap-1">
          {SETTINGS_TABS.map((k) => <ToolbarTab key={k} icon={ICONS[k]} label={t(`tab.${k}`)} active={tab === k} onClick={() => setTab(k)} />)}
        </div>
      </header>
      <main role="tabpanel" aria-label={t(`tab.${tab}`)} className="scroll flex-1 bg-[var(--bg)] px-8 pt-6 pb-4" key={tab}>
        <div className="mx-auto max-w-[560px] fade-in">
          {tab === 'general' && <General s={s} t={t} />}
          {tab === 'captions' && <CaptionsTab s={s} t={t} />}
          {tab === 'transcription' && <TranscriptionTab s={s} t={t} />}
          {tab === 'privacy' && <PrivacyTab s={s} t={t} />}
          {tab === 'about' && <AboutTab s={s} t={t} />}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<SettingsWindow />);
