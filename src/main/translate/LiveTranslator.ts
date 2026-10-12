import { EventEmitter } from 'node:events';

export type TranslateFn = (text: string, target: string) => Promise<string>;

/**
 * Keeps a translation of the text currently on screen.
 * - at most one request in flight; while busy only the newest text is kept (latest wins)
 * - throttled, so a growing provisional tail doesn't trigger a request per word
 * - results are cached (bounded) so confirmed text is never translated twice
 * Events: 'translation'({ text, source })
 */
export class LiveTranslator extends EventEmitter {
  private inflight = false;
  private pending: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastSent = 0;
  private cache = new Map<string, string>();
  private lastShown = '';
  stats = { requests: 0, cacheHits: 0, dropped: 0, errors: 0 };

  constructor(private translate: TranslateFn, public target: string, private readonly throttleMs = 350, private readonly cacheSize = 300) {
    super();
  }

  setTarget(t: string): void {
    if (t === this.target) return;
    this.target = t;
    this.cache.clear();
    this.lastShown = '';
  }

  /** New on-screen text (original). Empty text clears the translation. */
  update(text: string): void {
    const t = text.trim();
    if (!t) { this.pending = null; this.show('', ''); return; }
    const hit = this.cache.get(this.key(t));
    if (hit !== undefined) { this.stats.cacheHits++; this.pending = null; this.show(hit, t); return; }
    if (this.pending !== null) this.stats.dropped++;
    this.pending = t;
    this.schedule();
  }

  private key(t: string): string {
    return `${this.target}\u0000${t}`;
  }

  private schedule(): void {
    if (this.inflight || this.timer || this.pending === null) return;
    const wait = Math.max(0, this.lastSent + this.throttleMs - Date.now());
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, wait);
  }

  private async run(): Promise<void> {
    const text = this.pending;
    if (text === null || this.inflight) return;
    this.pending = null;
    this.inflight = true;
    this.lastSent = Date.now();
    this.stats.requests++;
    const target = this.target;
    try {
      const out = await this.translate(text, target);
      if (target === this.target) {
        this.cache.set(`${target}\u0000${text}`, out);
        if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
        // only show it if nothing newer replaced it in the meantime
        if (this.pending === null) this.show(out, text);
      }
    } catch {
      this.stats.errors++;
    } finally {
      this.inflight = false;
      this.schedule();
    }
  }

  private show(text: string, source: string): void {
    if (text === this.lastShown) return;
    this.lastShown = text;
    this.emit('translation', { text, source });
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}
