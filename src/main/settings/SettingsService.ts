import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const BoundsSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

export const SettingsSchema = z.object({
  model: z.enum(['base.en', 'base.en-q5_1', 'small.en', 'small.en-q5_1', 'small.en-tdrz']).default('base.en'),
  fontSize: z.number().min(12).max(72).default(28),
  opacity: z.number().min(0.1).max(1).default(0.6),
  maxLines: z.number().int().min(1).max(5).default(2),
  overlayVisible: z.boolean().default(true),
  contentProtection: z.boolean().default(false),
  /** Overlay bounds per display id (remembered per monitor). */
  boundsByDisplay: z.record(z.string(), BoundsSchema).default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

/** JSON settings in userData, validated on load. Events: 'change'(settings, keys) */
export class SettingsService extends EventEmitter {
  private data: Settings;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    super();
    this.data = this.load();
  }

  private load(): Settings {
    try {
      const parsed = SettingsSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      if (parsed.success) return parsed.data;
    } catch { /* first run or corrupt file */ }
    return SettingsSchema.parse({});
  }

  get(): Readonly<Settings> {
    return this.data;
  }

  update(patch: Partial<Settings>): void {
    const next = SettingsSchema.parse({ ...this.data, ...patch });
    this.data = next;
    this.emit('change', next, Object.keys(patch));
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  flush(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }
}
