// Settings schema shared by main (source of truth) and renderers (forms).
import { z } from 'zod';

export const MODEL_IDS = ['base.en', 'base.en-q5_1', 'small.en', 'small.en-q5_1', 'small.en-tdrz'] as const;
export const ModelIdSchema = z.enum(MODEL_IDS);
export type ModelIdT = z.infer<typeof ModelIdSchema>;

export const CAPTION_FONTS = ['system', 'rounded', 'serif', 'mono'] as const;
export const CAPTION_PRESETS = ['default', 'contrast', 'cinema'] as const;

const BoundsSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

/** Electron accelerator, e.g. "CommandOrControl+Alt+C" (validated again in main when registering). */
const Accelerator = z.string().min(1).max(60).regex(/^[A-Za-z0-9+]+$/);

export const SettingsSchema = z.object({
  // general
  language: z.enum(['system', 'pt-BR', 'en']).default('system'),
  appearance: z.enum(['dark', 'light', 'system']).default('dark'), // dark matches the brand (site and app)
  launchAtLogin: z.boolean().default(false),
  dockAlways: z.boolean().default(false),
  shortcutToggle: Accelerator.default('CommandOrControl+Alt+C'),
  shortcutOverlay: Accelerator.default('CommandOrControl+Alt+O'),
  shortcutEdit: Accelerator.default('CommandOrControl+Alt+E'),
  onboardingDone: z.boolean().default(false),
  // captions
  model: ModelIdSchema.default('base.en'),
  captionPreset: z.enum(CAPTION_PRESETS).default('default'),
  captionFont: z.enum(CAPTION_FONTS).default('system'),
  fontSize: z.number().min(16).max(64).default(28),
  opacity: z.number().min(0).max(1).default(0.6),
  maxLines: z.number().int().min(2).max(3).default(2),
  captionPosition: z.enum(['bottom', 'top']).default('bottom'),
  captionDisplay: z.string().max(40).default('cursor'), // 'cursor' or a display id
  overlayVisible: z.boolean().default(true),
  showSourceApp: z.boolean().default(true), // app icon + name above the captions
  captionWaves: z.boolean().default(true), // audio-reactive waves behind the captions
  // translation (on-device, Apple Translation framework; macOS 26+)
  translationEnabled: z.boolean().default(false),
  translationTarget: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).default('pt-BR'),
  translationMode: z.enum(['both', 'translation']).default('both'),
  contentProtection: z.boolean().default(false),
  /** Overlay bounds per display id (remembered per monitor). */
  boundsByDisplay: z.record(z.string(), BoundsSchema).default({}),
  // privacy / history
  historyEnabled: z.boolean().default(true),
  retentionDays: z.number().int().min(0).max(3650).default(30), // 0 = keep forever
});
export type Settings = z.infer<typeof SettingsSchema>;

/** Values a preset applies when chosen (the user can still tweak each one). */
export const PRESET_VALUES: Record<(typeof CAPTION_PRESETS)[number], Pick<Settings, 'captionFont' | 'fontSize' | 'opacity'>> = {
  default: { captionFont: 'system', fontSize: 28, opacity: 0.6 },
  contrast: { captionFont: 'system', fontSize: 32, opacity: 0.92 },
  cinema: { captionFont: 'system', fontSize: 34, opacity: 0 },
};
