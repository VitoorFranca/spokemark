import { EventEmitter } from 'node:events';

export type TranslateFn = (text: string, target: string) => Promise<string>;

/** A run of on-screen text; `turn` = it starts a new speaker (shown with a leading dash). */
export interface Segment { text: string; turn: boolean }

/**
 * Keeps a translation of the text currently on screen.
 * - at most one request in flight; while busy only the newest text is kept (latest wins)
 * - throttled, so a growing provisional tail doesn't trigger a request per word
 * - results are cached (bounded) so confirmed text is never translated twice
 * - with speaker changes, each speaker's text is translated on its own and shown on its own
 *   line with a leading dash, so the translation keeps the same turns as the original
 * Events: 'translation'({ text, source })
 */
export class LiveTranslator extends EventEmitter {
  private inflight = false;
  private pending: Segment[] | null = null;
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
    this.updateSegments([{ text, turn: false }]);
  }

  /** New on-screen text split by speaker. */
  updateSegments(segments: Segment[]): void {
    const segs = segments.map((g) => ({ text: g.text.trim(), turn: g.turn })).filter((g) => g.text);
    if (!segs.length) { this.pending = null; this.show('', ''); return; }
    const hits = segs.map((g) => this.cache.get(this.key(g.text)));
    if (hits.every((h) => h !== undefined)) { this.stats.cacheHits++; this.pending = null; this.show(compose(segs, hits as string[]), source(segs)); return; }
    if (this.pending !== null) this.stats.dropped++;
    this.pending = segs;
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
    const segs = this.pending;
    if (segs === null || this.inflight) return;
    this.pending = null;
    this.inflight = true;
    this.lastSent = Date.now();
    const target = this.target;
    try {
      const outs: string[] = [];
      for (const g of segs) {
        const hit = this.cache.get(this.key(g.text));
        if (hit !== undefined) { outs.push(hit); continue; }
        this.stats.requests++;
        const out = await this.translate(g.text, target);
        if (target !== this.target) return;
        this.cache.set(`${target}\u0000${g.text}`, out);
        if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
        outs.push(out);
      }
      // only show it if nothing newer replaced it in the meantime
      if (this.pending === null) this.show(compose(segs, outs), source(segs));
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

const compose = (segs: Segment[], outs: string[]) => segs.map((g, i) => (g.turn ? `– ${outs[i]}` : outs[i])).join('\n');
const source = (segs: Segment[]) => segs.map((g) => (g.turn ? `– ${g.text}` : g.text)).join('\n');

/**
 * Split the caption view into speaker segments. A line that starts with "–" begins a new
 * speaker; wrapped lines of the same speaker are joined.
 */
export function viewSegments(lines: { committed: string; provisional: string }[]): Segment[] {
  const segs: Segment[] = [];
  for (const l of lines) {
    const text = [l.committed, l.provisional].filter(Boolean).join(' ').trim();
    if (!text) continue;
    const turn = /^–(\s|$)/.test(text);
    const body = turn ? text.replace(/^–\s*/, '') : text;
    if (turn || !segs.length) segs.push({ text: body, turn });
    else segs[segs.length - 1]!.text += ` ${body}`;
  }
  return segs.filter((g) => g.text.trim());
}
