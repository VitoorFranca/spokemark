import { EventEmitter } from 'node:events';
import path from 'node:path';
import { ChildSupervisor } from '../native/ChildSupervisor';
import { LineParser } from '../native/protocol';
import { binDir } from '../paths';

export interface TargetLanguage { id: string; status: 'installed' | 'supported' | 'unsupported' }

/**
 * Runs the `translator` helper (Apple Translation framework, on-device) on demand.
 * Events: 'available'(boolean) 'log'(line)
 */
export class TranslatorService extends EventEmitter {
  private sup: ChildSupervisor | null = null;
  private lines = new LineParser();
  private nextId = 1;
  private waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private ready: Promise<boolean> | null = null;
  available: boolean | null = null;

  /** Starts the helper if needed; resolves with whether translation is available on this macOS. */
  start(): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = new Promise<boolean>((resolve) => {
      const sup = new ChildSupervisor({ name: 'translator', command: path.join(binDir(), 'translator'), args: [], maxRestarts: 3 });
      this.sup = sup;
      sup.on('spawn', () => { this.lines = new LineParser(); });
      sup.on('stdout', (d: Buffer) => {
        for (const l of this.lines.push(d)) {
          let m: { ready?: boolean; available?: boolean; id?: number; ok?: boolean; error?: string };
          try { m = JSON.parse(l); } catch { continue; }
          if (m.ready) { this.available = !!m.available; this.emit('available', this.available); resolve(this.available); continue; }
          const w = m.id !== undefined ? this.waiting.get(m.id) : undefined;
          if (!w) continue;
          this.waiting.delete(m.id!);
          if (m.ok) w.resolve(m); else w.reject(new Error(m.error ?? 'translation failed'));
        }
      });
      sup.on('stderr', (s: string) => this.emit('log', s.trimEnd()));
      sup.on('exit', () => { for (const w of this.waiting.values()) w.reject(new Error('translator exited')); this.waiting.clear(); });
      sup.on('gave-up', () => { this.available = false; resolve(false); });
      sup.start();
    });
    return this.ready;
  }

  private request<T>(payload: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.sup?.write(Buffer.from(JSON.stringify({ id, ...payload }) + '\n'));
      setTimeout(() => { if (this.waiting.delete(id)) reject(new Error('translation timed out')); }, 10_000);
    });
  }

  async translate(text: string, target: string, source = 'en'): Promise<string> {
    if (!(await this.start())) throw new Error('unavailable');
    const r = await this.request<{ text: string }>({ op: 'translate', source, target, text });
    return r.text;
  }

  async languages(source = 'en'): Promise<TargetLanguage[]> {
    if (!(await this.start())) return [];
    const r = await this.request<{ languages: TargetLanguage[] }>({ op: 'languages', source });
    return r.languages;
  }

  get pid(): number | undefined {
    return this.sup?.pid;
  }

  async stop(): Promise<void> {
    const s = this.sup;
    this.sup = null;
    this.ready = null;
    if (s) await s.stop();
  }
}
