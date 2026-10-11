import { useCallback, useEffect, useReducer, useState } from 'react';
import type { AppStateMsg, Command, EarlineApi } from '../../shared/appIpc';
import { translate, type StringKey } from '../../shared/i18n';
import { emptyLive, liveReducer } from './liveReducer';

declare global { interface Window { earline: EarlineApi } }
export const api = () => window.earline;

const applyTheme = (dark: boolean) => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; };
applyTheme(window.earline?.initialDark === true); // before React renders anything

/** Main-process state (source of truth), kept in sync over IPC. */
export function useAppState(): AppStateMsg | null {
  const [s, set] = useState<AppStateMsg | null>(null);
  useEffect(() => {
    const off = api().onState(set);
    void api().request('state.get').then((v) => set((cur) => cur ?? (v as AppStateMsg)));
    return off;
  }, []);
  // reflect language on <html lang> for VoiceOver pronunciation
  useEffect(() => { if (s) document.documentElement.lang = s.lang; }, [s?.lang]);
  useEffect(() => { if (s) applyTheme(s.dark); }, [s?.dark]);
  return s;
}

export function useT(s: AppStateMsg | null) {
  const lang = s?.lang ?? 'en';
  return useCallback((k: StringKey, v?: Record<string, string | number>) => translate(lang, k, v), [lang]);
}

export function useLive() {
  const [live, dispatch] = useReducer(liveReducer, emptyLive);
  useEffect(() => {
    const off = api().onLive(dispatch);
    void api().request('live.subscribe').then((e) => dispatch(e as Parameters<typeof dispatch>[0]));
    return off;
  }, []);
  return live;
}

export function useLevel(): number {
  const [db, set] = useState(-90);
  useEffect(() => api().onLevel(set), []);
  return db;
}

export function useCommand(cb: (c: Command) => void) {
  useEffect(() => api().onCommand(cb), [cb]);
}
