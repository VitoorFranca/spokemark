// Minimal, validated bridge for the overlay renderer (sandboxed, context-isolated).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { z } from 'zod';
import { AppearanceSchema, IPC, OverlayExtraSchema, ResizeSchema, SubtitleViewSchema, type OverlayApi } from '../shared/ipc';

const api: OverlayApi = {
  onView(cb) {
    const h = (_e: IpcRendererEvent, raw: unknown) => {
      const p = SubtitleViewSchema.safeParse(raw);
      if (p.success) cb(p.data);
    };
    ipcRenderer.on(IPC.view, h);
    return () => ipcRenderer.off(IPC.view, h);
  },
  onAppearance(cb) {
    const h = (_e: IpcRendererEvent, raw: unknown) => {
      const p = AppearanceSchema.safeParse(raw);
      if (p.success) cb(p.data);
    };
    ipcRenderer.on(IPC.appearance, h);
    return () => ipcRenderer.off(IPC.appearance, h);
  },
  rendered(version) {
    if (Number.isInteger(version) && version >= 0) ipcRenderer.send(IPC.rendered, { version });
  },
  ready() {
    ipcRenderer.send(IPC.ready);
  },
  onExtra(cb) {
    const h = (_e: IpcRendererEvent, raw: unknown) => { const p = OverlayExtraSchema.safeParse(raw); if (p.success) cb(p.data); };
    ipcRenderer.on(IPC.extra, h);
    return () => ipcRenderer.off(IPC.extra, h);
  },
  onLevel(cb) {
    const h = (_e: IpcRendererEvent, raw: unknown) => { const p = z.number().min(-120).max(10).safeParse(raw); if (p.success) cb(p.data); };
    ipcRenderer.on(IPC.level, h);
    return () => ipcRenderer.off(IPC.level, h);
  },
  exitEdit() {
    ipcRenderer.send(IPC.exitEdit);
  },
  resize(width, height) {
    const p = ResizeSchema.safeParse({ width: Math.round(width), height: Math.round(height) });
    if (p.success) ipcRenderer.send(IPC.resize, p.data);
  },
};

contextBridge.exposeInMainWorld('captions', api);
