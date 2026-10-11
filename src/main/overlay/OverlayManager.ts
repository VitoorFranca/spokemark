import { BrowserWindow, ipcMain, screen, type Display, type Rectangle } from 'electron';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { AppearanceSchema, IPC, RenderedAckSchema, ResizeSchema, SubtitleViewSchema, type Appearance, type SubtitleViewMsg } from '../../shared/ipc';
import type { SettingsService } from '../settings/SettingsService';

const DEFAULT_WIDTH_RATIO = 0.6;
const BOTTOM_MARGIN = 80;

/**
 * Transparent, frameless, always-on-top caption window.
 * - click-through mode (default): ignores the mouse entirely
 * - edit mode: draggable/resizable; bounds are remembered per display
 * Events: 'rendered'(version, ns)
 */
export class OverlayManager extends EventEmitter {
  win: BrowserWindow | null = null;
  private editMode = false;
  private appearance: Omit<Appearance, 'editMode'>;
  private lastView: SubtitleViewMsg = { version: 0, lines: [] };
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly settings: SettingsService, private readonly rendererUrl: string | null) {
    super();
    const s = settings.get();
    this.appearance = { fontSize: s.fontSize, opacity: s.opacity, maxLines: s.maxLines, status: 'idle', statusText: '' };
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
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveBounds(), 400);
    });
    ipcMain.on(IPC.ready, (e) => {
      if (e.sender !== this.win?.webContents) return;
      this.pushAppearance();
      this.sendView(this.lastView);
    });
  }

  private targetDisplay(): Display {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  private defaultBounds(d: Display): Rectangle {
    const wa = d.workArea;
    const s = this.settings.get();
    const height = Math.round(s.fontSize * 1.45 * s.maxLines + 40);
    const width = Math.round(wa.width * DEFAULT_WIDTH_RATIO);
    return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + wa.height - height - BOTTOM_MARGIN, width, height };
  }

  private boundsFor(d: Display): Rectangle {
    const saved = this.settings.get().boundsByDisplay[String(d.id)];
    if (saved) {
      const wa = d.workArea;
      const inside = saved.x >= wa.x - 50 && saved.y >= wa.y - 50 && saved.x + saved.width <= wa.x + wa.width + 50 && saved.y + saved.height <= wa.y + wa.height + 50;
      if (inside) return saved;
    }
    return this.defaultBounds(d);
  }

  create(): BrowserWindow {
    if (this.win) return this.win;
    const d = this.targetDisplay();
    const win = new BrowserWindow({
      ...this.boundsFor(d),
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
    const persist = () => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveBounds(), 400);
    };
    win.on('moved', persist);
    win.on('resized', persist);
    win.on('closed', () => { this.win = null; });
    if (this.rendererUrl) void win.loadURL(this.rendererUrl);
    else void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    this.win = win;
    return win;
  }

  private saveBounds(): void {
    if (!this.win) return;
    const b = this.win.getBounds();
    const d = screen.getDisplayMatching(b);
    this.settings.update({ boundsByDisplay: { ...this.settings.get().boundsByDisplay, [String(d.id)]: b } });
  }

  show(): void {
    const win = this.create();
    // Re-open on the display under the cursor, at its remembered position.
    win.setBounds(this.boundsFor(this.targetDisplay()));
    win.showInactive();
  }

  hide(): void {
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
      if (!on) this.saveBounds();
    }
    this.pushAppearance();
  }

  get isEditMode(): boolean {
    return this.editMode;
  }

  setContentProtection(on: boolean): void {
    this.win?.setContentProtection(on);
  }

  setAppearance(p: Partial<Omit<Appearance, 'editMode'>>): void {
    this.appearance = { ...this.appearance, ...p };
    if (p.fontSize !== undefined || p.maxLines !== undefined) {
      // keep the window tall enough for the configured lines
      const w = this.win;
      if (w) {
        const b = w.getBounds();
        const s = this.appearance;
        const h = Math.round(s.fontSize * 1.45 * s.maxLines + 40);
        w.setBounds({ ...b, y: b.y + b.height - h, height: h });
      }
    }
    this.pushAppearance();
  }

  private pushAppearance(): void {
    const a = AppearanceSchema.parse({ ...this.appearance, editMode: this.editMode });
    this.win?.webContents.send(IPC.appearance, a);
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
