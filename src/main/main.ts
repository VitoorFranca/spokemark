import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppStateSchema, CH, Requests, type AppStateMsg, type LiveEvent, type RequestName, type Status } from '../shared/appIpc';
import { APP_NAME } from '../shared/brand';
import { toMd, toSrt, toTxt } from '../shared/exporters';
import { LANG_NAMES, resolveLang, translate, type Lang, type StringKey } from '../shared/i18n';
import { PRESET_VALUES, type Settings } from '../shared/settings';
import { isTurn, type Word } from './asr/localAgreement';
import type { TranscriptUpdate } from './asr/TranscriptionProvider';
import { CaptionsController, type Indicator } from './CaptionsController';
import { Metrics, percentile } from './metrics';
import { ModelManager, SPEAKER_MODEL_DIR } from './models/ModelManager';
import { killAllChildren } from './native/ChildSupervisor';
import { OverlayManager } from './overlay/OverlayManager';
import { binDir, dataDir, migrateLegacyDataDir, modelsDir } from './paths';
import { checkPermission, PRIVACY_PANE_URL, requestPermission, type PermissionState } from './permissions';
import { SettingsService } from './settings/SettingsService';
import { TranscriptStore } from './store/TranscriptStore';
import type { SubtitleView } from './subtitles/SubtitleManager';
import { WindowManager } from './ui/WindowManager';
import { SourceAppTracker, type SourceDetail } from './SourceApp';
import { matchLanguage } from '../shared/lang';
import { LiveTranslator, viewSegments } from './translate/LiveTranslator';
import { TranslatorService, type TargetLanguage } from './translate/TranslatorService';

// ---- identity & data location (before 'ready') ------------------------------
app.setName(APP_NAME);
try { migrateLegacyDataDir(); } catch (e) { console.error('[main] data migration failed', e); }
app.setPath('userData', dataDir());

const E2E = {
  enabled: process.env.LC_E2E === '1',
  autostart: process.env.LC_E2E_AUTOSTART === '1',
  metricsFile: process.env.LC_METRICS_FILE ?? null,
  transcriptFile: process.env.LC_TRANSCRIPT_FILE ?? null,
  metricsIntervalMs: Number(process.env.LC_METRICS_INTERVAL_MS ?? 60_000),
  exportDir: process.env.LC_E2E_EXPORT_DIR ?? null,
  autoConfirm: process.env.LC_E2E_CONFIRM === '1',
};

if (!app.requestSingleInstanceLock()) app.quit();

let settings: SettingsService;
let store: TranscriptStore;
let models: ModelManager;
let captions: CaptionsController;
let overlay: OverlayManager;
let windows: WindowManager;
let metrics: Metrics;
let tray: Tray | null = null;
let permission: PermissionState = 'unknown';
let historyRevision = 0;
let shortcutErrors: AppStateMsg['shortcutErrors'] = [];
let provisionalText = '';
let translator: TranslatorService;
let liveTranslator: LiveTranslator;
let translationLanguages: TargetLanguage[] = [];
const sourceTracker = new SourceAppTracker();
let currentSource: string | null = null;
const iconCache = new Map<string, string | null>();
let quitting = false;
const trayIcons: Record<'idle' | 'listening', Electron.NativeImage> = { idle: nativeImage.createEmpty(), listening: nativeImage.createEmpty() };

const log = (l: string) => { if (process.env.LC_VERBOSE || /error|fail|started|format|permission|device|exit|panel/i.test(l)) console.log(l); };
const lang = (): Lang => resolveLang(settings.get().language, app.getPreferredSystemLanguages());
const t = (k: StringKey, v?: Record<string, string | number>) => translate(lang(), k, v);

// ---- state ------------------------------------------------------------------

function status(): Status {
  const st = captions.state.state;
  if (st === 'starting') return 'loading';
  if (st === 'stopping') return 'stopping';
  if (st === 'error') return captions.state.error === 'permission-denied' ? 'permission' : 'error';
  if (st === 'capturing') {
    const i: Indicator = captions.indicator;
    return i === 'permission' ? 'permission' : i === 'silent' ? 'silent' : i === 'processing' ? 'processing' : 'listening';
  }
  if (paused) return 'paused';
  if (!models.isReady(settings.get().model)) return 'modelMissing';
  if (permission === 'denied') return 'permission';
  return 'idle';
}

/** Map technical failures to something the UI can explain and act on. */
function errorKind(msg: string): 'model' | 'capture' | 'unknown' {
  if (/load (VAD )?model|whisper-worker|Transcription failed/i.test(msg)) return 'model';
  if (/audiotap|Audio capture|tap|aggregate/i.test(msg)) return 'capture';
  return 'unknown';
}

/** Folder of the speaker-change model when it (and its helper) can be used. */
function speakerModelDir(): string | null {
  return models.speakerModelInstalled && existsSync(path.join(binDir(), 'speaker-worker')) ? path.join(modelsDir(), SPEAKER_MODEL_DIR) : null;
}

function snapshot(): AppStateMsg {
  return AppStateSchema.parse({
    lang: lang(),
    dark: nativeTheme.shouldUseDarkColors,
    systemLang: resolveLang('system', app.getPreferredSystemLanguages()),
    status: status(),
    running: captions.state.state === 'starting' || captions.state.state === 'capturing',
    paused,
    errorMessage: captions.state.state === 'error' ? captions.state.error : null,
    errorKind: captions.state.state === 'error' ? errorKind(captions.state.error ?? '') : null,
    vadInstalled: models.isInstalled('vad'),
    permission,
    settings: settings.get(),
    models: models.status(),
    speakerModel: models.speakerStatus(),
    overlay: { visible: overlay.visible, editMode: overlay.isEditMode },
    displays: screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: d.label || `Display ${i + 1}` })),
    shortcutErrors,
    historyRevision,
    sources: captions.sources,
    translation: { available: translator?.available ?? null, languages: translationLanguages },
    app: { version: app.getVersion(), dataDir: dataDir() },
  });
}

let broadcastTimer: NodeJS.Timeout | null = null;
/** Coalesced state push to every app window (the overlay has its own channel). */
function broadcast(): void {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const s = snapshot();
    for (const w of windows.subscribers) w.webContents.send(CH.state, s);
    updateTray(s.status);
  }, 16);
}

function sendLive(e: LiveEvent): void {
  for (const w of windows.subscribers) {
    if (w === windows.get('panel') && !w.isVisible()) continue; // hidden panel resyncs on show
    w.webContents.send(CH.live, e);
  }
}

let tailTimer: NodeJS.Timeout | null = null;
function sendTailSoon(): void {
  if (tailTimer) return;
  tailTimer = setTimeout(() => { tailTimer = null; sendLive({ type: 'tail', open: store.openText, provisional: provisionalText }); }, 120);
}

function liveReset(): LiveEvent {
  return { type: 'reset', startedAt: store.liveStartedAt, segments: [...store.liveSegments] };
}

// ---- tray / menus / shortcuts ----------------------------------------------------

function loadTrayIcons(): void {
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'tray') : path.join(__dirname, '..', '..', 'assets', 'tray');
  for (const k of ['idle', 'listening'] as const) {
    const img = nativeImage.createFromPath(path.join(dir, `tray${k === 'idle' ? 'Idle' : 'Listening'}Template.png`));
    img.setTemplateImage(true);
    trayIcons[k] = img;
  }
}

let lastTrayState = '';
function updateTray(s: Status): void {
  if (!tray) return;
  const listening = s === 'listening' || s === 'processing' || s === 'silent' || s === 'loading';
  const key = `${listening}|${s}|${lang()}`;
  if (key === lastTrayState) return;
  lastTrayState = key;
  tray.setImage(listening ? trayIcons.listening : trayIcons.idle);
  tray.setToolTip(`${APP_NAME} — ${t(`state.${s === 'processing' ? 'listening' : s}` as StringKey)}`);
}

function buildAppMenu(): void {
  const tpl: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { label: t('action.about'), click: () => windows.open('settings', { tab: 'about' }) },
        { type: 'separator' },
        { label: t('action.openSettings'), accelerator: 'Command+,', click: () => windows.open('settings') },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { label: t('action.quit'), accelerator: 'Command+Q', click: () => app.quit() },
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: t('menu.find'), accelerator: 'Command+F', click: () => { const w = windows.open('main'); w.webContents.send(CH.command, { type: 'focus-search' }); } },
      ],
    },
    {
      label: t('menu.window'),
      submenu: [
        { role: 'minimize' }, { role: 'close', accelerator: 'Command+W' }, { type: 'separator' },
        { label: t('menu.showMain'), accelerator: 'Command+0', click: () => windows.open('main') },
        { type: 'separator' }, { role: 'front' },
      ],
    },
    {
      label: t('menu.help'),
      role: 'help',
      submenu: [
        { label: t('menu.privacy'), click: () => windows.open('settings', { tab: 'privacy' }) },
        { label: t('about.reveal'), click: () => void shell.openPath(dataDir()) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

type ShortcutKey = keyof Pick<Settings, 'shortcutToggle' | 'shortcutOverlay' | 'shortcutEdit'>;
function registerShortcuts(): void {
  globalShortcut.unregisterAll();
  const s = settings.get();
  const map: [ShortcutKey, () => void][] = [
    ['shortcutToggle', () => void toggleCaptions()],
    ['shortcutOverlay', () => setOverlayVisible(!overlay.visible)],
    ['shortcutEdit', () => setEditMode(!overlay.isEditMode)],
  ];
  shortcutErrors = [];
  for (const [k, fn] of map) {
    let ok = false;
    try { ok = globalShortcut.register(s[k], fn); } catch { ok = false; }
    if (!ok) shortcutErrors.push(k);
  }
}

// ---- actions --------------------------------------------------------------------

/**
 * Stop vs. pause:
 * - Stop ends the session, clears the captions and hides the caption overlay.
 * - Pause stops listening but keeps the session open and the last captions frozen on screen;
 *   resuming continues the same session.
 */
let paused = false;

async function startCaptions(): Promise<{ ok: boolean; reason?: string }> {
  if (captions.state.state === 'stopping') return { ok: false, reason: 'busy' };
  if (!models.isReady(settings.get().model)) { broadcast(); return { ok: false, reason: 'modelMissing' }; }
  if (settings.get().overlayVisible) overlay.show();
  const resume = paused;
  await captions.start({ resume });
  paused = false;
  broadcast();
  return { ok: true };
}

async function stopCaptions(): Promise<{ ok: boolean }> {
  const wasPaused = paused;
  paused = false;
  await captions.stop();
  if (wasPaused) { store.endSession(); provisionalText = ''; sendTailSoon(); sourceTracker.reset(); currentSource = null; }
  captions.clearView();
  overlay.setExtra({ source: null, translation: '', pairs: [] });
  if (!overlay.isEditMode) overlay.hide(); // only for now: the overlayVisible setting is unchanged
  broadcast();
  return { ok: true };
}

async function pauseCaptions(): Promise<{ ok: boolean }> {
  const st = captions.state.state;
  if (st !== 'capturing' && st !== 'starting') return { ok: false };
  paused = true;
  await captions.stop();
  broadcast();
  return { ok: true };
}

/** Shortcut / menu bar: start (or resume) when not listening, stop when listening. */
async function toggleCaptions(): Promise<{ ok: boolean; reason?: string }> {
  const st = captions.state.state;
  if (st === 'capturing' || st === 'starting') return stopCaptions();
  return startCaptions();
}

function setOverlayVisible(v: boolean): void {
  if (v) overlay.show(); else overlay.hide();
  settings.update({ overlayVisible: v });
  broadcast();
}

function setEditMode(on: boolean): void {
  if (on && !overlay.visible) { overlay.show(); settings.update({ overlayVisible: true }); }
  overlay.setEditMode(on);
  broadcast();
}

async function confirm(win: BrowserWindow | undefined, message: string): Promise<boolean> {
  if (E2E.autoConfirm) return true;
  const opts = { type: 'warning' as const, message, detail: t('history.confirmDetail'), buttons: [t('action.delete'), t('action.cancel')], defaultId: 1, cancelId: 1 };
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return r.response === 0;
}

const RANGE_START: Record<'today' | 'week' | 'month' | 'all', () => number> = {
  today: () => new Date(new Date().setHours(0, 0, 0, 0)).getTime(),
  week: () => Date.now() - 7 * 86_400_000,
  month: () => Date.now() - 30 * 86_400_000,
  all: () => 0,
};

async function handleRequest(win: BrowserWindow | undefined, name: RequestName, p: unknown): Promise<unknown> {
  switch (name) {
    case 'state.get': return snapshot();
    case 'live.subscribe': return liveReset();
    case 'captions.toggle': { const r = await toggleCaptions(); broadcast(); return r; }
    case 'captions.stop': return stopCaptions();
    case 'captions.pause': { const st = captions.state.state; return st === 'capturing' || st === 'starting' ? pauseCaptions() : paused ? startCaptions() : { ok: false }; }
    case 'overlay.setVisible': setOverlayVisible(p as boolean); return true;
    case 'overlay.setEdit': setEditMode(p as boolean); if (p) windows.hidePanel(); return true;
    case 'settings.update': settings.update(p as Partial<Settings>); return true;
    case 'settings.applyPreset': { const k = p as Settings['captionPreset']; settings.update({ captionPreset: k, ...PRESET_VALUES[k] }); return true; }
    case 'model.download': {
      const id = p as Settings['model'];
      // a model that failed to load is re-downloaded from scratch (size matched but content was bad)
      if (captions.state.state === 'error' && errorKind(captions.state.error ?? '') === 'model') { await captions.stop(); models.remove(id); }
      void models.download(id).then(() => broadcast());
      return true;
    }
    case 'model.cancel': models.cancel(p as Settings['model']); return true;
    case 'model.remove': if (!(p === settings.get().model && snapshot().running)) models.remove(p as Settings['model']); return true;
    case 'model.use': settings.update({ model: p as Settings['model'] }); return true;
    case 'speakerModel.download': void models.downloadSpeakerModel().then(() => broadcast()); return true;
    case 'speakerModel.cancel': models.cancelSpeakerModel(); return true;
    case 'speakerModel.remove': if (!(captions.turnsMode === 'diarizer' && snapshot().running)) models.removeSpeakerModel(); return true;
    case 'permission.request': permission = await requestPermission(); broadcast(); schedulePermissionPoll(); return permission;
    case 'permission.openSettings': await shell.openExternal(PRIVACY_PANE_URL); return true;
    case 'window.open': {
      const o = p as { window: 'main' | 'settings' | 'onboarding'; tab?: string };
      windows.hidePanel();
      windows.open(o.window, o.tab ? { tab: o.tab } : {});
      return true;
    }
    case 'history.list': return store.listSessions(p as { query?: string });
    case 'history.get': return store.getSession(p as number);
    case 'history.export': return exportSession(win, p as { id: number; format: 'txt' | 'srt' | 'md' });
    case 'history.delete': {
      if (!(await confirm(win, t('history.confirmDelete')))) return false;
      store.deleteSession(p as number);
      return true;
    }
    case 'history.deleteRange': {
      const r = p as keyof typeof RANGE_START;
      const label = t(`history.range.${r}` as StringKey);
      if (!(await confirm(win, r === 'all' ? t('privacy.deleteAllConfirm') : t('history.confirmRange', { range: label.toLowerCase() })))) return false;
      return store.deleteRange(RANGE_START[r](), Number.MAX_SAFE_INTEGER);
    }
    case 'copy.text': clipboard.writeText(p as string); return true;
    case 'app.quit': app.quit(); return true;
    case 'app.revealData': await shell.openPath(dataDir()); return true;
    case 'onboarding.complete': settings.update({ onboardingDone: true }); windows.get('onboarding')?.close(); return true;
    case 'panel.hide': windows.hidePanel(); return true;
    case 'translation.languages': {
      translationLanguages = await translator.languages('en').catch(() => []);
      // first time: default to the system language when it can be a target (else Spanish)
      const ids = translationLanguages.filter((l) => l.status === 'installed').map((l) => l.id);
      if (ids.length && !matchLanguage(settings.get().translationTarget, ids)) {
        const sys = app.getPreferredSystemLanguages().map((l) => matchLanguage(l, ids)).find(Boolean);
        settings.update({ translationTarget: sys ?? matchLanguage('es', ids) ?? ids[0]! });
      }
      broadcast();
      return translationLanguages;
    }
    case 'translation.preview': {
      const o = p as { text: string; target: string };
      return translator.translate(o.text, o.target).catch(() => null);
    }
    case 'translation.openLanguageSettings': await shell.openExternal('x-apple.systempreferences:com.apple.Localization-Settings.extension'); return true;
    case 'panel.rendered': {
      const ms = performance.now() - windows.panelShownAt;
      log(`[panel] open-to-paint ${ms.toFixed(1)} ms`);
      if (E2E.metricsFile) appendFileSync(E2E.metricsFile, JSON.stringify({ t: new Date().toISOString(), panelOpenMs: ms }) + '\n');
      return ms;
    }
  }
  return null;
}

async function exportSession(win: BrowserWindow | undefined, o: { id: number; format: 'txt' | 'srt' | 'md' }): Promise<{ ok: boolean; path?: string }> {
  const s = store.getSession(o.id);
  if (!s) return { ok: false };
  const d = new Date(s.startedAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
  const name = `${APP_NAME} ${stamp}.${o.format}`;
  const content = o.format === 'srt' ? toSrt(s) : o.format === 'md' ? toMd(s, `${APP_NAME} — ${d.toLocaleString(lang())}`, lang()) : toTxt(s);
  let file: string | undefined;
  if (E2E.exportDir) { mkdirSync(E2E.exportDir, { recursive: true }); file = path.join(E2E.exportDir, name); }
  else {
    const opts = { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: o.format.toUpperCase(), extensions: [o.format] }] };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { ok: false };
    file = r.filePath;
  }
  writeFileSync(file, content, 'utf8');
  return { ok: true, path: file };
}

// ---- lifecycle --------------------------------------------------------------------

async function shutdown(): Promise<void> {
  globalShortcut.unregisterAll();
  paused = false;
  try { await captions.stop(); } catch { /* ignore */ }
  try { store.endSession(); store.close(); } catch { /* ignore */ }
  killAllChildren('SIGKILL'); // nothing may outlive us
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
// E2E control (same code paths as the UI): SIGUSR1 toggles captions, SIGUSR2 cycles installed models.
process.on('SIGUSR1', () => void toggleCaptions());
process.on('SIGUSR2', () => {
  const installed = models.status().filter((m) => m.installed).map((m) => m.id);
  const next = installed[(installed.indexOf(settings.get().model) + 1) % installed.length]!;
  console.log(`[main] switching model -> ${next}`);
  settings.update({ model: next });
});
app.on('second-instance', () => windows?.open('main'));
app.on('activate', () => windows?.open('main')); // Dock click
app.on('window-all-closed', () => { /* menu bar app: keep running */ });

let permTimer: NodeJS.Timeout | null = null;
/** Poll permission only while someone can see it change (onboarding, settings, panel) and it isn't granted. */
function schedulePermissionPoll(): void {
  if (permTimer || permission === 'granted') return;
  permTimer = setTimeout(async () => {
    permTimer = null;
    const watching = windows.get('onboarding') || windows.get('settings') || windows.get('panel')?.isVisible();
    if (!watching) return;
    const p = await checkPermission();
    if (p !== permission) { permission = p; broadcast(); }
    schedulePermissionPoll();
  }, 1500);
}

app.whenReady().then(async () => {
  settings = new SettingsService(path.join(dataDir(), 'settings.json'));
  const s0 = settings.get();
  nativeTheme.themeSource = s0.appearance;
  store = new TranscriptStore(path.join(dataDir(), 'history.sqlite'));
  store.init();
  store.persist = s0.historyEnabled;
  store.applyRetention(s0.retentionDays);
  setInterval(() => store.applyRetention(settings.get().retentionDays), 6 * 3_600_000);
  models = new ModelManager();
  metrics = new Metrics(E2E.metricsFile);
  captions = new CaptionsController(s0.model, { maxLines: s0.maxLines, maxCharsPerLine: 64 });
  void captions.setSpeakerChanges(s0.speakerChanges);
  void captions.setSpeakerModel(speakerModelDir());
  windows = new WindowManager(process.env.VITE_DEV_SERVER_URL ?? null);
  windows.dockAlways = s0.dockAlways;
  windows.updateDock();
  overlay = new OverlayManager(settings, process.env.VITE_DEV_SERVER_URL ?? null);
  overlay.editHint = t('overlay.editHint');
  overlay.speakerModel = speakerModelDir() !== null;
  overlay.create();
  permission = await checkPermission();

  // pipeline -> UI
  captions.on('view', (v: SubtitleView, newWords: Word[]) => {
    const cap = captions.captureTimeOf;
    if (cap) metrics.trackVersion(v.version, newWords.map((w) => cap(w.end)).filter((x): x is bigint => x !== null));
    overlay.sendView(v);
  });
  overlay.on('rendered', (version: number, ns: bigint) => metrics.onRendered(version, ns));

  // ---- live translation (on-device; the helper runs only while translation is on) ----
  translator = new TranslatorService();
  translator.on('log', log);
  liveTranslator = new LiveTranslator((text, target) => translator.translate(text, target), s0.translationTarget);
  liveTranslator.on('translation', (t: { text: string; pairs: { source: string; text: string }[] }) => overlay.setExtra({ translation: t.text, pairs: t.pairs }));
  const syncTranslator = () => {
    const st = settings.get();
    if (st.translationEnabled) { void translator.start().then(() => broadcast()); liveTranslator.setTarget(st.translationTarget); }
    else { liveTranslator.stop(); overlay.setExtra({ translation: '', pairs: [] }); void translator.stop(); }
  };
  syncTranslator();
  captions.on('view', (v: SubtitleView) => {
    if (!settings.get().translationEnabled) return;
    // translate the caption currently on screen (confirmed + provisional), one segment per speaker
    liveTranslator.updateSegments(viewSegments(v.lines));
  });

  // ---- source app shown above the captions (real icon) ----
  const updateSource = async (details: SourceDetail[]) => {
    const pick = sourceTracker.pick(details);
    const name = pick?.name ?? null;
    if (name === currentSource) return;
    currentSource = name;
    if (!pick) { overlay.setExtra({ source: null }); return; }
    // the helper sends the real icon (NSWorkspace); Electron's getFileIcon returns a generic
    // placeholder for apps on macOS 26, so it is only a fallback
    let icon = pick.icon && pick.icon.startsWith('data:image/png;base64,') ? pick.icon : iconCache.get(pick.path);
    if (icon === undefined) {
      try { icon = pick.path ? (await app.getFileIcon(pick.path, { size: 'normal' })).toDataURL() : null; } catch { icon = null; }
      iconCache.set(pick.path, icon);
    }
    if (currentSource === name) overlay.setExtra({ source: { name: pick.name, icon } });
  };
  overlay.on('edit-exit', () => setEditMode(false));
  captions.on('indicator', (_i: Indicator, text: string) => {
    overlay.setStatus({ status: captions.state.state, statusText: text });
    broadcast();
  });
  captions.state.on('change', () => broadcast());
  captions.on('log', log);
  captions.on('session', (what: 'started' | 'ended') => {
    // a pause keeps the session (and the frozen captions) until resume or stop
    if (what === 'started') { if (store.liveStartedAt === null) { store.persist = settings.get().historyEnabled; store.startSession(settings.get().model); provisionalText = ''; sendLive(liveReset()); } }
    else if (!paused) { store.endSession(); provisionalText = ''; sendTailSoon(); sourceTracker.reset(); currentSource = null; overlay.setExtra({ source: null, translation: '', pairs: [] }); }
  });
  captions.on('update', (u: TranscriptUpdate) => {
    store.addConfirmed(u.confirmed, u.utteranceEnd);
    provisionalText = u.provisional.filter((w) => !isTurn(w)).map((w) => w.text.trim()).filter(Boolean).join(' ');
    sendTailSoon();
    if (E2E.transcriptFile && u.confirmed.length) appendFileSync(E2E.transcriptFile, JSON.stringify({ t: Date.now(), words: u.confirmed.map((w) => w.text.trim()), end: u.utteranceEnd }) + '\n');
  });
  captions.on('sources', (apps: string[]) => { for (const a of apps) store.noteSourceApp(a); void updateSource(captions.sourceDetails); broadcast(); });
  captions.on('level', (db: number) => {
    if (settings.get().captionWaves) overlay.sendLevel(db);
    for (const name of ['panel', 'onboarding', 'main'] as const) { // main: the waves in the empty Live view
      const w = windows.get(name);
      if (w?.isVisible()) w.webContents.send(CH.level, db);
    }
  });
  store.on('segment', (seg) => sendLive({ type: 'append', segment: seg }));
  store.on('changed', () => { historyRevision++; broadcast(); });
  models.on('change', () => {
    const dir = speakerModelDir();
    if (overlay.speakerModel !== (dir !== null)) { overlay.speakerModel = dir !== null; overlay.relayout(); }
    void captions.setSpeakerModel(dir);
    broadcast();
  });
  nativeTheme.on('updated', () => { windows.repaint(); broadcast(); });
  screen.on('display-added', () => broadcast());
  screen.on('display-removed', () => broadcast());

  settings.on('change', (n: Settings, keys: (keyof Settings)[]) => {
    const has = (...k: (keyof Settings)[]) => k.some((x) => keys.includes(x));
    if (has('appearance')) { nativeTheme.themeSource = n.appearance; windows.repaint(); }
    if (has('language')) { buildAppMenu(); overlay.editHint = t('overlay.editHint'); lastTrayState = ''; }
    if (has('captionPreset', 'captionFont', 'fontSize', 'opacity', 'maxLines', 'language', 'showSourceApp', 'captionWaves', 'translationEnabled', 'translationMode')) overlay.relayout();
    if (has('translationEnabled', 'translationTarget')) syncTranslator();
    if (has('maxLines')) captions.setLayout({ maxLines: n.maxLines });
    if (has('captionPosition', 'captionDisplay')) { overlay.relayout({ resetPlacement: true }); if (overlay.visible) overlay.show(); }
    if (has('contentProtection')) overlay.setContentProtection(n.contentProtection);
    if (has('dockAlways')) { windows.dockAlways = n.dockAlways; windows.updateDock(); }
    if (has('launchAtLogin') && app.isPackaged) app.setLoginItemSettings({ openAtLogin: n.launchAtLogin });
    if (has('shortcutToggle', 'shortcutOverlay', 'shortcutEdit')) registerShortcuts();
    if (has('historyEnabled') && !snapshot().running) store.persist = n.historyEnabled;
    if (has('retentionDays')) store.applyRetention(n.retentionDays);
    if (has('model')) void captions.setModel(n.model);
    if (has('speakerChanges')) void captions.setSpeakerChanges(n.speakerChanges);
    if (has('model', 'speakerChanges')) overlay.relayout(); // translation needs room for one line per speaker
    if (!keys.every((k) => k === 'boundsByDisplay')) broadcast();
  });

  // First paint uses the right theme: the preload asks synchronously once.
  ipcMain.on(CH.themeSync, (e) => { e.returnValue = nativeTheme.shouldUseDarkColors; });
  // IPC: one validated entry point for every app-surface request
  ipcMain.handle(CH.request, async (e, name: unknown, payload: unknown) => {
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(Requests, name)) throw new Error('unknown request');
    const p = Requests[name as RequestName].safeParse(payload);
    if (!p.success) throw new Error(`invalid payload for ${name}`);
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    if (!win || !windows.subscribers.includes(win)) throw new Error('unknown sender');
    return handleRequest(win, name as RequestName, p.data);
  });
  // Closing onboarding once the required steps are done (permission + model) counts as
  // finishing it; before that it shows again on the next launch.
  windows.on('closed', (name: string) => {
    if (name === 'onboarding' && !settings.get().onboardingDone && permission === 'granted' && models.isReady(settings.get().model)) {
      settings.update({ onboardingDone: true });
    }
  });
  windows.on('opened', (name: string, w: BrowserWindow) => {
    w.webContents.on('did-finish-load', () => { w.webContents.send(CH.state, snapshot()); });
    if (name === 'panel') w.on('show', () => { w.webContents.send(CH.command, { type: 'panel-shown' }); w.webContents.send(CH.state, snapshot()); w.webContents.send(CH.live, liveReset()); schedulePermissionPoll(); });
    else schedulePermissionPoll();
  });

  buildAppMenu();
  loadTrayIcons();
  tray = new Tray(trayIcons.idle);
  tray.on('click', () => windows.togglePanel(tray!.getBounds()));
  tray.on('right-click', () => windows.togglePanel(tray!.getBounds()));
  tray.on('mouse-enter', () => windows.warmPanel());
  registerShortcuts();
  updateTray(status());

  if (settings.get().overlayVisible) overlay.show();
  if (!settings.get().onboardingDone && !E2E.autostart && process.env.LC_SKIP_ONBOARDING !== '1') windows.open('onboarding');

  if (E2E.metricsFile) {
    setInterval(() => {
      const st = captions.providerStats;
      void metrics.sample(captions.pids, { state: captions.state.state, inferences: st?.inferences ?? 0, skippedBusy: st?.skippedBusy ?? 0, inferP50: st ? percentile(st.inferMs, 50) : null });
    }, E2E.metricsIntervalMs);
  }
  if (E2E.enabled) {
    // Test hooks for Playwright (main-process evaluate). They call the same functions as the UI.
    (globalThis as Record<string, unknown>).__spokemark = {
      showPanel: () => windows.togglePanel(tray?.getBounds() ?? null),
      warmPanel: () => windows.warmPanel(),
      openWindow: (n: 'main' | 'settings' | 'onboarding', tab?: string) => windows.open(n, tab ? { tab } : {}),
      setTheme: (src: 'light' | 'dark' | 'system') => { nativeTheme.themeSource = src; },
      windowIds: () => Object.fromEntries([...windows.wins.entries()].map(([k, w]) => [k, w.getMediaSourceId()])),
      overlayId: () => overlay.win?.getMediaSourceId() ?? null,
      state: () => snapshot(),
      pids: () => captions.pids,
      translatorPid: () => translator.pid ?? null,
      overlayPid: () => overlay.win?.webContents.getOSProcessId() ?? null,
      // same path as a detected source (real icon via getFileIcon), without playing audio
      setSourceForTest: (name: string, appPath: string) => updateSource([{ name, path: appPath, frontmost: true }]),
      setTranslationForTest: (text: string, pairs: { source: string; text: string }[] = []) => overlay.setExtra({ translation: text, pairs }),
      // caption lines on the overlay without audio (same path as the pipeline's views)
      setViewForTest: (lines: { committed: string; provisional?: string }[]) => overlay.sendView({ version: Date.now(), lines: lines.map((l, i) => ({ id: i + 1, committed: l.committed, provisional: l.provisional ?? '' })) }),
      translationStats: () => ({ ...liveTranslator.stats, source: currentSource }),
      toggleCaptions: () => toggleCaptions(),
      setOverlayEdit: (on: boolean) => setEditMode(on),
      langName: (l: Lang) => LANG_NAMES[l],
    };
  }
  if (E2E.autostart) void toggleCaptions();
});
