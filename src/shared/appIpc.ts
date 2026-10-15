// Typed IPC for the app surfaces (panel, main window, settings, onboarding).
// main -> renderer messages are validated in the preload; renderer -> main
// requests are validated in main before anything runs.
import { z } from 'zod';
import { ModelIdSchema, SettingsPatchSchema, SettingsSchema } from './settings';

export const SegmentSchema = z.object({ startMs: z.number(), endMs: z.number(), text: z.string().max(4000) });
export type SegmentMsg = z.infer<typeof SegmentSchema>;

export const ModelStatusSchema = z.object({
  id: ModelIdSchema,
  installed: z.boolean(),
  bytes: z.number(),
  download: z.object({ id: ModelIdSchema, received: z.number(), total: z.number(), bytesPerSec: z.number(), phase: z.enum(['downloading', 'verifying']) }).nullable(),
  error: z.string().nullable(),
});
export type ModelStatusMsg = z.infer<typeof ModelStatusSchema>;

export const StatusSchema = z.enum(['idle', 'paused', 'loading', 'listening', 'processing', 'silent', 'stopping', 'permission', 'error', 'modelMissing']);
export type Status = z.infer<typeof StatusSchema>;

export const AppStateSchema = z.object({
  lang: z.enum(['en', 'pt-BR']),
  dark: z.boolean(), // nativeTheme.shouldUseDarkColors (renderers apply it as data-theme)
  systemLang: z.enum(['en', 'pt-BR']),
  status: StatusSchema,
  running: z.boolean(), // starting or capturing
  paused: z.boolean(), // not listening, session kept and captions frozen on screen
  errorMessage: z.string().nullable(), // technical detail (logs/tooltip only)
  errorKind: z.enum(['model', 'capture', 'unknown']).nullable(), // drives the user-facing message
  vadInstalled: z.boolean(),
  permission: z.enum(['granted', 'denied', 'unknown']),
  settings: SettingsSchema,
  models: z.array(ModelStatusSchema),
  overlay: z.object({ visible: z.boolean(), editMode: z.boolean() }),
  displays: z.array(z.object({ id: z.string(), label: z.string() })),
  shortcutErrors: z.array(z.enum(['shortcutToggle', 'shortcutOverlay', 'shortcutEdit'])),
  historyRevision: z.number().int(),
  sources: z.array(z.string()),
  translation: z.object({
    available: z.boolean().nullable(), // null = not checked yet (helper not started)
    languages: z.array(z.object({ id: z.string(), status: z.enum(['installed', 'supported', 'unsupported']) })),
  }),
  app: z.object({ version: z.string(), dataDir: z.string() }),
});
export type AppStateMsg = z.infer<typeof AppStateSchema>;

/** Live transcript stream: reset on (re)subscribe or new session, then appends + tail. */
export const LiveEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reset'), startedAt: z.number().nullable(), segments: z.array(SegmentSchema) }),
  z.object({ type: z.literal('append'), segment: SegmentSchema }),
  z.object({ type: z.literal('tail'), open: z.string().max(4000), provisional: z.string().max(4000) }),
]);
export type LiveEvent = z.infer<typeof LiveEventSchema>;

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('focus-search') }),
  z.object({ type: z.literal('show-tab'), tab: z.string().max(20) }),
  z.object({ type: z.literal('panel-shown') }),
]);
export type Command = z.infer<typeof CommandSchema>;

export const SessionRowSchema = z.object({
  id: z.number(), startedAt: z.number(), endedAt: z.number().nullable(), sourceApp: z.string().nullable(),
  model: z.string(), wordCount: z.number(), preview: z.string(), snippet: z.string().nullable().optional(),
});
export type SessionRowMsg = z.infer<typeof SessionRowSchema>;

export const RANGES = ['today', 'week', 'month', 'all'] as const;
export const WINDOWS = ['main', 'settings', 'onboarding'] as const;
export const SETTINGS_TABS = ['general', 'captions', 'translation', 'transcription', 'privacy', 'about'] as const;

/** Every renderer -> main request: name -> payload schema. */
export const Requests = {
  'state.get': z.undefined(),
  'live.subscribe': z.undefined(),
  'captions.toggle': z.undefined(),
  'captions.stop': z.undefined(),
  'captions.pause': z.undefined(), // pause while listening, resume while paused
  'overlay.setVisible': z.boolean(),
  'overlay.setEdit': z.boolean(),
  'settings.update': SettingsPatchSchema,
  'settings.applyPreset': z.enum(['default', 'contrast', 'cinema']),
  'model.download': ModelIdSchema,
  'model.cancel': ModelIdSchema,
  'model.remove': ModelIdSchema,
  'model.use': ModelIdSchema,
  'permission.request': z.undefined(),
  'permission.openSettings': z.undefined(),
  'window.open': z.object({ window: z.enum(WINDOWS), tab: z.enum(SETTINGS_TABS).optional() }),
  'history.list': z.object({ query: z.string().max(200).optional(), limit: z.number().int().max(500).optional(), offset: z.number().int().min(0).optional() }),
  'history.get': z.number().int(),
  'history.export': z.object({ id: z.number().int(), format: z.enum(['txt', 'srt', 'md']) }),
  'history.delete': z.number().int(),
  'history.deleteRange': z.enum(RANGES),
  'copy.text': z.string().max(2_000_000),
  'app.quit': z.undefined(),
  'app.revealData': z.undefined(),
  'onboarding.complete': z.undefined(),
  'panel.hide': z.undefined(),
  'panel.rendered': z.undefined(),
  'translation.languages': z.undefined(),
  'translation.preview': z.object({ text: z.string().max(500), target: z.string().max(20) }),
  'translation.openLanguageSettings': z.undefined(),
} as const;
export type RequestName = keyof typeof Requests;
export type RequestPayload<K extends RequestName> = z.infer<(typeof Requests)[K]>;

export const CH = { request: 'app:request', state: 'app:state', live: 'app:live', level: 'app:level', command: 'app:command', themeSync: 'app:theme-sync' } as const;

export interface SpokemarkApi {
  initialDark?: boolean;
  request<K extends RequestName>(name: K, payload?: RequestPayload<K>): Promise<unknown>;
  onState(cb: (s: AppStateMsg) => void): () => void;
  onLive(cb: (e: LiveEvent) => void): () => void;
  onLevel(cb: (dbfs: number) => void): () => void;
  onCommand(cb: (c: Command) => void): () => void;
}
