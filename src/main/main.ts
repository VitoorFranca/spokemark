import { app, globalShortcut, Menu, nativeImage, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { CaptionsController, type Indicator } from './CaptionsController';
import { Metrics, percentile } from './metrics';
import { killAllChildren } from './native/ChildSupervisor';
import { OverlayManager } from './overlay/OverlayManager';
import { availableModels, MODELS, type ModelId } from './paths';
import { SettingsService } from './settings/SettingsService';
import type { Word } from './asr/localAgreement';
import type { SubtitleView } from './subtitles/SubtitleManager';
import type { TranscriptUpdate } from './asr/TranscriptionProvider';

// Optional instrumentation for automated end-to-end runs (no effect otherwise).
const E2E = {
  autostart: process.env.LC_E2E_AUTOSTART === '1',
  metricsFile: process.env.LC_METRICS_FILE ?? null,
  transcriptFile: process.env.LC_TRANSCRIPT_FILE ?? null,
  metricsIntervalMs: Number(process.env.LC_METRICS_INTERVAL_MS ?? 60_000),
};

const SHORTCUT_TOGGLE = 'CommandOrControl+Alt+C';
const SHORTCUT_EDIT = 'CommandOrControl+Alt+E';
const PRIVACY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

if (!app.requestSingleInstanceLock()) app.quit();

let tray: Tray | null = null;
let overlay: OverlayManager;
let captions: CaptionsController;
let settings: SettingsService;
let metrics: Metrics;
let quitting = false;

const log = (l: string) => { if (process.env.LC_VERBOSE || /error|fail|started|format|permission|device|exit/i.test(l)) console.log(l); };

function indicatorTitle(i: Indicator): string {
  switch (i) {
    case 'capturing': return 'CC ●';
    case 'processing': return 'CC ◐';
    case 'starting': return 'CC …';
    case 'silent': return 'CC ○';
    case 'permission': return 'CC ⚠︎';
    case 'error': return 'CC ✕';
    default: return 'CC';
  }
}

function indicatorLabel(i: Indicator): string {
  return {
    idle: 'Idle',
    starting: 'Starting…',
    capturing: 'Capturing system audio',
    processing: 'Capturing · transcribing',
    silent: 'Capturing · no audio playing',
    permission: 'Permission needed: System Audio Recording',
    error: `Error: ${captions.state.error ?? ''}`,
  }[i];
}

async function toggleCaptions(): Promise<void> {
  const s = captions.state.state;
  if (s === 'capturing' || s === 'starting') await captions.stop();
  else if (s === 'idle' || s === 'error') {
    if (settings.get().overlayVisible) overlay.show();
    await captions.start();
  }
}

function setEditMode(on: boolean): void {
  overlay.setEditMode(on);
  if (on && !overlay.visible) overlay.show();
  rebuildMenu();
}

function rebuildMenu(): void {
  if (!tray) return;
  const s = settings.get();
  const st = captions.state.state;
  const running = st === 'capturing' || st === 'starting';
  const models = availableModels();
  const sizes = [20, 24, 28, 32, 40, 48];
  const opacities = [0.3, 0.45, 0.6, 0.75, 0.9];
  const tpl: MenuItemConstructorOptions[] = [
    { label: indicatorLabel(captions.indicator), enabled: false },
    ...(captions.indicator === 'permission' || captions.indicator === 'error'
      ? [{ label: 'Open Privacy Settings…', click: () => void shell.openExternal(PRIVACY_URL) }]
      : []),
    { type: 'separator' },
    { label: running ? 'Stop Captions' : 'Start Captions', accelerator: SHORTCUT_TOGGLE, click: () => void toggleCaptions() },
    { label: overlay.visible ? 'Hide Overlay' : 'Show Overlay', click: () => {
      if (overlay.visible) { overlay.hide(); settings.update({ overlayVisible: false }); }
      else { overlay.show(); settings.update({ overlayVisible: true }); }
      rebuildMenu();
    } },
    { type: 'separator' },
    { label: 'Click-through (locked)', type: 'radio', checked: !overlay.isEditMode, click: () => setEditMode(false) },
    { label: 'Edit (move / resize)', type: 'radio', checked: overlay.isEditMode, accelerator: SHORTCUT_EDIT, click: () => setEditMode(true) },
    { type: 'separator' },
    {
      label: 'Model',
      submenu: (Object.keys(MODELS) as ModelId[]).map((m) => ({
        label: (m === 'small.en-tdrz' ? 'small.en + speaker changes' : m) + (models.includes(m) ? '' : ' (not downloaded)'),
        type: 'radio' as const,
        enabled: models.includes(m),
        checked: s.model === m,
        click: () => { settings.update({ model: m }); void captions.setModel(m); },
      })),
    },
    { label: 'Font Size', submenu: sizes.map((f) => ({ label: `${f} pt`, type: 'radio' as const, checked: s.fontSize === f, click: () => settings.update({ fontSize: f }) })) },
    { label: 'Background Opacity', submenu: opacities.map((o) => ({ label: `${Math.round(o * 100)}%`, type: 'radio' as const, checked: Math.abs(s.opacity - o) < 0.01, click: () => settings.update({ opacity: o }) })) },
    { label: 'Lines', submenu: [1, 2, 3].map((n) => ({ label: String(n), type: 'radio' as const, checked: s.maxLines === n, click: () => settings.update({ maxLines: n }) })) },
    { label: 'Hide Overlay From Screen Sharing', type: 'checkbox', checked: s.contentProtection, click: (i) => settings.update({ contentProtection: i.checked }) },
    { type: 'separator' },
    { label: 'Quit Live Captions', accelerator: 'Command+Q', click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(tpl));
  tray.setTitle(indicatorTitle(captions.indicator));
  tray.setToolTip(`Live Captions — ${indicatorLabel(captions.indicator)}`);
}

async function shutdown(): Promise<void> {
  globalShortcut.unregisterAll();
  try { await captions.stop(); } catch { /* ignore */ }
  killAllChildren('SIGKILL'); // belt and braces: nothing may outlive us
  settings.flush();
}

app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  void shutdown().finally(() => app.exit(0));
});
process.on('uncaughtException', (err) => { console.error('[main] uncaught', err); killAllChildren('SIGKILL'); process.exit(1); });
process.on('SIGTERM', () => app.quit());
process.on('SIGINT', () => app.quit());
// E2E control: SIGUSR1 toggles Start/Stop (used by the stop/start cycle test).
process.on('SIGUSR1', () => void toggleCaptions());
// E2E control: SIGUSR2 switches to the next downloaded model (same path as the tray menu).
process.on('SIGUSR2', () => {
  const ms = availableModels();
  const next = ms[(ms.indexOf(settings.get().model) + 1) % ms.length]!;
  console.log(`[main] switching model -> ${next}`);
  settings.update({ model: next });
  void captions.setModel(next);
});

app.whenReady().then(() => {
  app.dock?.hide(); // menu bar app (LSUIElement in the packaged Info.plist)
  settings = new SettingsService(path.join(app.getPath('userData'), 'settings.json'));
  metrics = new Metrics(E2E.metricsFile);
  const s = settings.get();
  captions = new CaptionsController(s.model, { maxLines: s.maxLines, maxCharsPerLine: 64 });
  overlay = new OverlayManager(settings, process.env.VITE_DEV_SERVER_URL ?? null);
  overlay.create();

  captions.on('view', (v: SubtitleView, newWords: Word[]) => {
    const cap = captions.captureTimeOf;
    if (cap) metrics.trackVersion(v.version, newWords.map((w) => cap(w.end)).filter((x): x is bigint => x !== null));
    overlay.sendView(v);
  });
  overlay.on('rendered', (version: number, ns: bigint) => metrics.onRendered(version, ns));
  captions.on('indicator', (i: Indicator, text: string) => {
    overlay.setAppearance({ status: captions.state.state, statusText: text || indicatorLabel(i) });
    rebuildMenu();
  });
  captions.on('log', log);
  if (E2E.transcriptFile) {
    const f = E2E.transcriptFile;
    captions.on('update', (u: TranscriptUpdate) => {
      if (u.confirmed.length) appendFileSync(f, JSON.stringify({ t: Date.now(), words: u.confirmed.map((w) => w.text.trim()), end: u.utteranceEnd }) + '\n');
    });
  }

  settings.on('change', (n: typeof s, keys: string[]) => {
    if (keys.includes('fontSize') || keys.includes('opacity') || keys.includes('maxLines')) overlay.setAppearance({ fontSize: n.fontSize, opacity: n.opacity, maxLines: n.maxLines });
    if (keys.includes('maxLines')) captions.setLayout({ maxLines: n.maxLines });
    if (keys.includes('contentProtection')) overlay.setContentProtection(n.contentProtection);
    if (!keys.every((k) => k === 'boundsByDisplay')) rebuildMenu();
  });

  tray = new Tray(nativeImage.createEmpty());
  rebuildMenu();
  globalShortcut.register(SHORTCUT_TOGGLE, () => void toggleCaptions());
  globalShortcut.register(SHORTCUT_EDIT, () => setEditMode(!overlay.isEditMode));

  if (s.overlayVisible) overlay.show();
  if (E2E.metricsFile) {
    setInterval(() => {
      const st = captions.providerStats;
      void metrics.sample(captions.pids, {
        state: captions.state.state,
        inferences: st?.inferences ?? 0,
        skippedBusy: st?.skippedBusy ?? 0,
        inferP50: st ? percentile(st.inferMs, 50) : null,
      });
    }, E2E.metricsIntervalMs);
  }
  if (E2E.autostart) void toggleCaptions();
});

app.on('window-all-closed', () => { /* tray app: keep running */ });

