// Typed IPC contract between main and the overlay renderer (validated with zod
// on both ends: main validates renderer -> main, preload validates main -> renderer).
import { z } from 'zod';

export const IPC = {
  view: 'overlay:view', // main -> renderer
  appearance: 'overlay:appearance', // main -> renderer
  rendered: 'overlay:rendered', // renderer -> main (ack for latency metrics)
  ready: 'overlay:ready', // renderer -> main
  resize: 'overlay:resize', // renderer -> main (edit mode only; transparent windows can't use native resize)
  exitEdit: 'overlay:exit-edit', // renderer -> main (Esc in edit mode)
  extra: 'overlay:extra', // main -> renderer: source app + translation
  level: 'overlay:level', // main -> renderer: audio level for the waves (~15 Hz, only while capturing)
} as const;

export const SubtitleLineSchema = z.object({
  id: z.number().int(),
  committed: z.string().max(2000),
  provisional: z.string().max(2000),
});

export const SubtitleViewSchema = z.object({
  version: z.number().int().nonnegative(),
  lines: z.array(SubtitleLineSchema).max(10),
});
export type SubtitleViewMsg = z.infer<typeof SubtitleViewSchema>;

export const AppearanceSchema = z.object({
  captionPreset: z.enum(['default', 'contrast', 'cinema']),
  captionFont: z.enum(['system', 'rounded', 'serif', 'mono']),
  fontSize: z.number().min(12).max(72),
  opacity: z.number().min(0).max(1),
  maxLines: z.number().int().min(1).max(5),
  editMode: z.boolean(),
  editHint: z.string().max(120),
  showSourceApp: z.boolean(),
  captionWaves: z.boolean(),
  translationEnabled: z.boolean(),
  translationMode: z.enum(['both', 'translation']),
  status: z.enum(['idle', 'starting', 'capturing', 'stopping', 'error']),
  statusText: z.string().max(300),
});
export type Appearance = z.infer<typeof AppearanceSchema>;

export const OverlayExtraSchema = z.object({
  source: z.object({ name: z.string().max(120), icon: z.string().max(400_000).nullable() }).nullable(),
  translation: z.string().max(4000),
});
export type OverlayExtra = z.infer<typeof OverlayExtraSchema>;

export const ResizeSchema = z.object({ width: z.number().int().min(240).max(6000), height: z.number().int().min(60).max(2000) });

export const RenderedAckSchema = z.object({ version: z.number().int().nonnegative() });

export interface OverlayApi {
  onView(cb: (v: SubtitleViewMsg) => void): () => void;
  onAppearance(cb: (a: Appearance) => void): () => void;
  rendered(version: number): void;
  ready(): void;
  resize(width: number, height: number): void;
  exitEdit(): void;
  onExtra(cb: (e: OverlayExtra) => void): () => void;
  onLevel(cb: (dbfs: number) => void): () => void;
}
