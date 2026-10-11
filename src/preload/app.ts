// Bridge for the app surfaces (sandboxed, context-isolated). Exposes one request
// function (names whitelisted) and validated subscriptions.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { z } from 'zod';
import { AppStateSchema, CH, CommandSchema, LiveEventSchema, Requests, type EarlineApi, type RequestName } from '../shared/appIpc';

function subscribe<T>(channel: string, schema: z.ZodType<T>, cb: (v: T) => void): () => void {
  const h = (_e: IpcRendererEvent, raw: unknown) => {
    const p = schema.safeParse(raw);
    if (p.success) cb(p.data);
  };
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.off(channel, h);
}

const api: EarlineApi = {
  request(name, payload) {
    if (!Object.prototype.hasOwnProperty.call(Requests, name)) return Promise.reject(new Error(`unknown request ${String(name)}`));
    const p = Requests[name as RequestName].safeParse(payload);
    if (!p.success) return Promise.reject(new Error(`invalid payload for ${String(name)}`));
    return ipcRenderer.invoke(CH.request, name, p.data);
  },
  onState: (cb) => subscribe(CH.state, AppStateSchema, cb),
  onLive: (cb) => subscribe(CH.live, LiveEventSchema, cb),
  onLevel: (cb) => subscribe(CH.level, z.number().min(-120).max(10), cb),
  onCommand: (cb) => subscribe(CH.command, CommandSchema, cb),
};

// Theme for the first paint (Chromium's prefers-color-scheme doesn't follow
// nativeTheme.themeSource here), read once synchronously; later changes come with the state.
api.initialDark = ipcRenderer.sendSync(CH.themeSync) === true;

contextBridge.exposeInMainWorld('earline', api);
