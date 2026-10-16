import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SettingsSchema, type Settings } from '../../shared/settings';

export { SettingsSchema, type Settings };

/** JSON settings in userData, validated on load. Events: 'change'(settings, keys) */
export class SettingsService extends EventEmitter {
  private data: Settings;
  private saveTimer: NodeJS.Timeout | null = null;
  readonly firstRun: boolean;

  constructor(private readonly file: string) {
    super();
    const loaded = this.load();
    this.firstRun = loaded === null;
    this.data = loaded ?? SettingsSchema.parse({});
  }

  private load(): Settings | null {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      // Up to 0.2.0 speaker changes came with the model: keep them on for people who chose it.
      if (!('speakerChanges' in raw) && raw.model === 'small.en-tdrz') raw.speakerChanges = true;
      // Up to 0.3.0 Whisper was the only engine: keep it (and its downloaded model) for existing installs.
      if (!('engine' in raw)) raw.engine = 'whisper';
      const parsed = SettingsSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      // Keep whatever is still valid (e.g. after a schema change) instead of resetting everything.
      const partial: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        const one = SettingsSchema.safeParse({ [k]: v });
        if (one.success) partial[k] = v;
      }
      return SettingsSchema.parse(partial);
    } catch {
      return null; // first run (or unreadable file)
    }
  }

  get(): Readonly<Settings> {
    return this.data;
  }

  update(patch: Partial<Settings>): void {
    const next = SettingsSchema.parse({ ...this.data, ...patch });
    const keys = (Object.keys(patch) as (keyof Settings)[]).filter((k) => JSON.stringify(this.data[k]) !== JSON.stringify(next[k]));
    this.data = next;
    if (keys.length === 0) return;
    this.emit('change', next, keys);
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
