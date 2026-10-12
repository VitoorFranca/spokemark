import { BrowserWindow, ipcMain, screen, type Display, type Rectangle } from 'electron';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { AppearanceSchema, IPC, OverlayExtraSchema, RenderedAckSchema, ResizeSchema, SubtitleViewSchema, type Appearance, type OverlayExtra, type SubtitleViewMsg } from '../../shared/ipc';
import type { SettingsService } from '../settings/SettingsService';

const DEFAULT_WIDTH_RATIO = 0.6;
const EDGE_MARGIN = 80;

type Look = Omit<Appearance, 'editMode' | 'status' | 'statusText' | 'editHint'>;
const LINE_H = 1.35;

/**
 * Transparent, frameless, always-on-top caption window.
 * - click-through mode (default): ignores the mouse entirely
 * - edit mode: draggable/resizable (renderer handle); Esc finishes; bounds are remembered per display
 * Events: 'rendered'(version, ns) 'edit-exit'()
 */
export class OverlayManager extends EventEmitter {
  win: BrowserWindow | null = null;
  private editMode = false;
  private status: Pick<Appearance, 'status' | 'statusText'> = { status: 'idle', statusText: '' };
  editHint = '';
  private lastView: SubtitleViewMsg = { version: 0, lines: [] };
  private extra: OverlayExtra = { source: null, translation: '' };
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly settings: SettingsService, private readonly rendererUrl: string | null) {
    super();
    ipcMain.on(IPC.rendered, (e, raw: unknown) => {
      if (e.sender !== this.win?.webContents) return;
      const p = RenderedAckSchema.safeParse(raw);
      if (p.success) this.emit('rendered', p.data.version, process.hrtime.bigint());
    });
    ipcMain.on(IPC.resize, (e, raw: unknown) => {
      if (e.sender !== this.win?.webContents || !this.editMode) return;
      const p = ResizeSchema.safeParse(raw);
      if (!p.success) return;
      const b = this.win.getBounds();
      const wa = screen.getDisplayMatching(b).workArea;
      this.win.setBounds({ ...b, width: Math.min(p.data.width, wa.width), height: Math.min(p.data.height, wa.height) });
      this.persistSoon();
    });
    ipcMain.on(IPC.exitEdit, (e) => {
      if (e.sender !== this.win?.webContents || !this.editMode) return;
      this.emit('edit-exit');
    });
    ipcMain.on(IPC.ready, (e) => {
      if (e.sender !== this.win?.webContents) return;
      this.pushAppearance();
      this.sendView(this.lastView);
      this.win?.webContents.send(IPC.extra, this.extra);
    });
  }

  private look(): Look {
    const s = this.settings.get();
    return {
      captionPreset: s.captionPreset, captionFont: s.captionFont, fontSize: s.fontSize, opacity: s.opacity, maxLines: s.maxLines,
      showSourceApp: s.showSourceApp, captionWaves: s.captionWaves, translationEnabled: s.translationEnabled, translationMode: s.translationMode,
    };
  }

  /** Display chosen in Settings, or the one under the pointer. */
  targetDisplay(): Display {
    const want = this.settings.get().captionDisplay;
    if (want !== 'cursor') {
      const d = screen.getAllDisplays().find((x) => String(x.id) === want);
      if (d) return d;
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  /** Caption lines + optional source-app header + optional translation lines. */
  private height(): number {
    const s = this.settings.get();
    const translationLines = s.translationEnabled && s.translationMode === 'both' ? (s.maxLines === 3 ? 2 : 1) : 0;
    const header = s.showSourceApp ? 34 : 0;
    return Math.round(s.fontSize * LINE_H * s.maxLines + s.fontSize * 0.86 * LINE_H * translationLines + header + 36);
  }

  private defaultBounds(d: Display): Rectangle {
    const wa = d.workArea;
    const height = this.height();
    const width = Math.round(wa.width * DEFAULT_WIDTH_RATIO);
    const top = this.settings.get().captionPosition === 'top';
    return { x: wa.x + Math.round((wa.width - width) / 2), y: top ? wa.y + EDGE_MARGIN / 2 : wa.y + wa.height - height - EDGE_MARGIN, width, height };
  }

  private boundsFor(d: Display): Rectangle {
    const saved = this.settings.get().boundsByDisplay[String(d.id)];
    if (saved) {
      const wa = d.workArea;
      const inside = saved.x >= wa.x - 50 && saved.y >= wa.y - 50 && saved.x + saved.width <= wa.x + wa.width + 50 && saved.y + saved.height <= wa.y + wa.height + 50;
      if (inside) return { ...saved, height: Math.max(saved.height, this.height()) };
    }
    return this.defaultBounds(d);
  }

  create(): BrowserWindow {
    if (this.win) return this.win;
    const win = new BrowserWindow({
      ...this.boundsFor(this.targetDisplay()),
      type: 'panel', // floats above full-screen apps, on all Spaces
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'overlay.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.setIgnoreMouseEvents(true);
    win.setContentProtection(this.settings.get().contentProtection);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('moved', () => this.persistSoon());
    win.on('closed', () => { this.win = null; });
    if (this.rendererUrl) void win.loadURL(`${this.rendererUrl.replace(/\/$/, '')}/overlay.html`);
    else void win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
    this.win = win;
    return win;
  }

  private persistSoon(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveBounds(), 400);
  }

  private saveBounds(): void {
    if (!this.win) return;
    const b = this.win.getBounds();
    const d = screen.getDisplayMatching(b);
    this.settings.update({ boundsByDisplay: { ...this.settings.get().boundsByDisplay, [String(d.id)]: b } });
  }

  show(): void {
    const win = this.create();
    win.setBounds(this.boundsFor(this.targetDisplay()));
    win.showInactive();
  }

  hide(): void {
    if (this.editMode) this.setEditMode(false);
    this.win?.hide();
  }

  get visible(): boolean {
    return !!this.win?.isVisible();
  }

  setEditMode(on: boolean): void {
    this.editMode = on;
    const w = this.win;
    if (w) {
      w.setIgnoreMouseEvents(!on);
      w.setMovable(on); // resizing goes through the renderer's handle (transparent windows aren't natively resizable)
      w.setFocusable(on);
      if (on) { w.show(); w.focus(); } // focus so Esc reaches the overlay
      else this.saveBounds();
    }
    this.pushAppearance();
  }

  get isEditMode(): boolean {
    return this.editMode;
  }

  setContentProtection(on: boolean): void {
    this.win?.setContentProtection(on);
  }

  setStatus(p: Partial<Pick<Appearance, 'status' | 'statusText'>>): void {
    this.status = { ...this.status, ...p };
    this.pushAppearance();
  }

  /** Caption look or placement changed in settings. */
  relayout(opts: { resetPlacement?: boolean } = {}): void {
    if (opts.resetPlacement) this.settings.update({ boundsByDisplay: {} });
    const w = this.win;
    if (w) {
      if (opts.resetPlacement) w.setBounds(this.defaultBounds(this.targetDisplay()));
      else {
        // keep the bottom edge (or top edge when placed on top) while the height follows size/lines
        const b = w.getBounds();
        const h = this.height();
        const top = this.settings.get().captionPosition === 'top';
        w.setBounds({ ...b, y: top ? b.y : b.y + b.height - h, height: h });
      }
    }
    this.pushAppearance();
  }

  private pushAppearance(): void {
    const a = AppearanceSchema.parse({ ...this.look(), ...this.status, editMode: this.editMode, editHint: this.editHint });
    this.win?.webContents.send(IPC.appearance, a);
  }

  setExtra(e: Partial<OverlayExtra>): void {
    const next = OverlayExtraSchema.parse({ ...this.extra, ...e });
    if (JSON.stringify(next) === JSON.stringify(this.extra)) return;
    this.extra = next;
    this.win?.webContents.send(IPC.extra, next);
  }

  sendLevel(db: number): void {
    if (this.win?.isVisible()) this.win.webContents.send(IPC.level, db);
  }

  sendView(v: SubtitleViewMsg): void {
    this.lastView = SubtitleViewSchema.parse(v);
    this.win?.webContents.send(IPC.view, this.lastView);
  }

  destroy(): void {
    this.win?.destroy();
    this.win = null;
  }
}
