import { app, BrowserWindow, screen, type BrowserWindowConstructorOptions, type Rectangle } from 'electron';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { APP_NAME } from '../../shared/brand';

export type SurfaceName = 'panel' | 'main' | 'settings' | 'onboarding';

const PANEL_W = 360;
const PANEL_H = 520;

/**
 * Creates the app windows. The panel is created once and kept hidden so it
 * opens instantly; every other window is created on demand and destroyed when
 * closed (no hidden windows holding memory). Dock icon only while the main
 * window is open, unless "always show in Dock" is on.
 *
 * Events: 'opened'(name, win) 'closed'(name)
 */
export class WindowManager extends EventEmitter {
  readonly wins = new Map<SurfaceName, BrowserWindow>();
  dockAlways = false;
  panelShownAt = 0;

  constructor(private readonly devUrl: string | null) {
    super();
  }

  private load(win: BrowserWindow, entry: SurfaceName, query: Record<string, string> = {}): void {
    const q = new URLSearchParams(query).toString();
    if (this.devUrl) void win.loadURL(`${this.devUrl.replace(/\/$/, '')}/${entry}.html${q ? `?${q}` : ''}`);
    else void win.loadFile(path.join(__dirname, '..', 'renderer', `${entry}.html`), { query });
  }

  private base(extra: BrowserWindowConstructorOptions): BrowserWindowConstructorOptions {
    return {
      show: false,
      title: APP_NAME,
      backgroundColor: '#00000000',
      ...extra,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'app.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        ...extra.webPreferences,
      },
    };
  }

  private track(name: SurfaceName, win: BrowserWindow): BrowserWindow {
    this.wins.set(name, win);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.on('closed', () => {
      if (this.wins.get(name) === win) this.wins.delete(name);
      this.updateDock();
      this.emit('closed', name);
    });
    this.emit('opened', name, win);
    return win;
  }

  get(name: SurfaceName): BrowserWindow | undefined {
    const w = this.wins.get(name);
    return w && !w.isDestroyed() ? w : undefined;
  }

  // ---- panel (menu bar popover) -------------------------------------------

  createPanel(): BrowserWindow {
    const win = new BrowserWindow(this.base({
      width: PANEL_W,
      height: PANEL_H,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      vibrancy: 'popover',
      visualEffectState: 'active',
      roundedCorners: true,
      webPreferences: { backgroundThrottling: false },
    }));
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    win.on('blur', () => { if (!win.webContents.isDevToolsOpened()) win.hide(); });
    this.load(win, 'panel');
    return this.track('panel', win);
  }

  togglePanel(anchor: Rectangle | null): void {
    const win = this.get('panel') ?? this.createPanel();
    if (win.isVisible()) { win.hide(); return; }
    this.panelShownAt = performance.now();
    const b = this.panelBounds(anchor);
    win.setBounds(b);
    win.show();
    win.focus();
  }

  private panelBounds(anchor: Rectangle | null): Rectangle {
    const pt = anchor ? { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height } : screen.getCursorScreenPoint();
    const wa = screen.getDisplayNearestPoint(pt).workArea;
    const x = Math.round(Math.min(Math.max(pt.x - PANEL_W / 2, wa.x + 8), wa.x + wa.width - PANEL_W - 8));
    const y = anchor ? Math.round(anchor.y + anchor.height + 4) : wa.y + 4;
    return { x, y, width: PANEL_W, height: PANEL_H };
  }

  hidePanel(): void {
    this.get('panel')?.hide();
  }

  // ---- regular windows ------------------------------------------------------

  open(name: Exclude<SurfaceName, 'panel'>, query: Record<string, string> = {}): BrowserWindow {
    const existing = this.get(name);
    if (existing) {
      if (Object.keys(query).length) existing.webContents.send('app:command', { type: 'show-tab', tab: query.tab ?? '' });
      existing.show();
      existing.focus();
      return existing;
    }
    let win: BrowserWindow;
    if (name === 'main') {
      win = new BrowserWindow(this.base({
        width: 980, height: 660, minWidth: 760, minHeight: 480,
        titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
        vibrancy: 'sidebar', visualEffectState: 'followWindow',
      }));
    } else if (name === 'settings') {
      win = new BrowserWindow(this.base({
        width: 680, height: 560, resizable: false, minimizable: true, maximizable: false, fullscreenable: false,
        titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 },
        vibrancy: 'titlebar', visualEffectState: 'followWindow',
      }));
    } else {
      win = new BrowserWindow(this.base({
        width: 620, height: 560, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 },
        vibrancy: 'under-window', visualEffectState: 'followWindow',
      }));
    }
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    this.load(win, name, query);
    this.track(name, win);
    this.updateDock();
    return win;
  }

  /** Dock icon: always, or only while the main window exists. */
  updateDock(): void {
    const want = this.dockAlways || !!this.get('main');
    if (!app.dock) return;
    if (want && !app.dock.isVisible()) void app.dock.show();
    else if (!want && app.dock.isVisible()) app.dock.hide();
  }

  /** Windows that should receive state broadcasts (visible or about to be). */
  get subscribers(): BrowserWindow[] {
    return [...this.wins.values()].filter((w) => !w.isDestroyed());
  }
}
