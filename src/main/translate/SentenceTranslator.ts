import { EventEmitter } from 'node:events';
import { isPunctuation, isTurn, type Word } from '../asr/localAgreement';
import type { TranscriptUpdate } from '../asr/TranscriptionProvider';

export type TranslateFn = (text: string, target: string) => Promise<string>;

/** One speaker turn's text and its translation, as the overlay shows them (oldest first). */
export interface TranslationPair { source: string; text: string }

interface Sentence { src: string; tr: string | null }
interface Turn { dash: boolean; sentences: Sentence[] }

const endsSentence = (t: string) => /[.?!…]["')\]]*$/.test(t);

/**
 * Live translation by sentence, fed by the transcript (not by the lines on screen).
 * - A finished sentence (its last word confirmed: sentence punctuation, the end of an
 *   utterance, a speaker change or `maxWords`) is translated once, before anything else,
 *   and that translation never changes.
 * - Only the sentence in progress (confirmed + provisional words) is re-translated while
 *   it grows, throttled; meanwhile its latest translation stays on screen.
 * - Scrolling never changes what is translated, so nothing is re-translated when lines
 *   leave the screen (the previous approach chased the visible text and fell behind).
 * - Turns follow the speaker changes: each turn's translation goes under its lines.
 *
 * Events: 'translation'({ text, pairs }) — `text`: one line per turn ("– " for a new
 * speaker), `pairs`: per turn, oldest first, for the overlay to put under each speaker.
 */
export class SentenceTranslator extends EventEmitter {
  private turns: Turn[] = [{ dash: false, sentences: [] }];
  private words: string[] = []; // confirmed words of the sentence in progress
  private provisional: Word[] = [];
  private cache = new Map<string, string>();
  private partial: { src: string; tr: string } | null = null; // latest translation of a sentence in progress
  private inflight = false;
  private timer: NodeJS.Timeout | null = null;
  private lastPartialAt = 0;
  private lastShown = '';
  private gen = 0; // bumps on clear / target change: late results are dropped
  stats = { requests: 0, cacheHits: 0, errors: 0 };

  constructor(
    private readonly translate: TranslateFn,
    public target: string,
    private readonly opts: { throttleMs: number; maxWords: number; keepTurns: number; sentencesPerTurn: number } = { throttleMs: 350, maxWords: 30, keepTurns: 6, sentencesPerTurn: 2 },
  ) {
    super();
  }

  setTarget(t: string): void {
    if (t === this.target) return;
    this.target = t;
    this.cache.clear();
    this.partial = null;
    for (const turn of this.turns) for (const s of turn.sentences) s.tr = null;
    this.gen++;
    this.schedule();
  }

  /** New session (or Stop): forget everything on screen. */
  clear(): void {
    this.turns = [{ dash: false, sentences: [] }];
    this.words = [];
    this.provisional = [];
    this.partial = null;
    this.gen++;
    this.show();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clear();
  }

  apply(u: TranscriptUpdate): void {
    for (const w of u.confirmed) {
      if (isTurn(w)) { this.close(); this.turns.push({ dash: true, sentences: [] }); continue; }
      const t = w.text.trim();
      if (!t) continue;
      if (isPunctuation(t)) {
        // a late "." for a sentence already closed (or still open): it belongs to the word before
        const last = this.turns[this.turns.length - 1]!.sentences.at(-1);
        if (this.words.length) this.words[this.words.length - 1] += t;
        else if (last && !endsSentence(last.src)) { last.src += t; last.tr = this.cache.get(this.key(last.src)) ?? null; }
        if (this.words.length && endsSentence(t)) this.close();
        continue;
      }
      this.words.push(t);
      if (endsSentence(t) || this.words.length >= this.opts.maxWords) this.close();
    }
    if (u.utteranceEnd) this.close();
    this.provisional = u.provisional;
    while (this.turns.length > this.opts.keepTurns) this.turns.shift();
    this.show();
    this.schedule();
  }

  private close(): void {
    if (!this.words.length) return;
    const src = this.words.join(' ');
    this.words = [];
    const tr = this.cache.get(this.key(src)) ?? null;
    if (tr !== null) this.stats.cacheHits++;
    this.turns[this.turns.length - 1]!.sentences.push({ src, tr });
  }

  /** The sentence in progress, split where the provisional words preview a speaker change. */
  private pending(): { dash: boolean; src: string }[] {
    const out = [{ dash: false, src: this.words.join(' ') }];
    for (const w of this.provisional) {
      if (isTurn(w)) { out.push({ dash: true, src: '' }); continue; }
      const t = w.text.trim();
      if (t) out[out.length - 1]!.src = [out[out.length - 1]!.src, t].filter(Boolean).join(' ');
    }
    return out;
  }

  private key(src: string): string {
    return `${this.target}\u0000${src}`;
  }

  private schedule(): void {
    if (this.inflight || this.timer) return;
    const job = this.nextJob();
    if (!job) return;
    // finished sentences go at once; the sentence in progress at most every throttleMs
    const wait = job.partial ? Math.max(0, this.lastPartialAt + this.opts.throttleMs - Date.now()) : 0;
    this.timer = setTimeout(() => { this.timer = null; void this.run(); }, wait);
  }

  private nextJob(): { src: string; partial: boolean } | null {
    for (const turn of this.turns) for (const s of turn.sentences) if (s.tr === null) return { src: s.src, partial: false };
    const p = this.pending().map((x) => x.src).filter(Boolean).pop();
    if (!p || p === this.partial?.src) return null;
    const hit = this.cache.get(this.key(p));
    if (hit !== undefined) { this.partial = { src: p, tr: hit }; this.stats.cacheHits++; this.show(); return null; }
    return { src: p, partial: true };
  }

  private async run(): Promise<void> {
    const job = this.nextJob();
    if (!job || this.inflight) return;
    this.inflight = true;
    if (job.partial) this.lastPartialAt = Date.now();
    const gen = this.gen, target = this.target;
    try {
      this.stats.requests++;
      const tr = await this.translate(job.src, target);
      if (gen !== this.gen) return;
      this.cache.set(this.key(job.src), tr);
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
      for (const turn of this.turns) for (const s of turn.sentences) if (s.src === job.src && s.tr === null) s.tr = tr;
      if (job.partial) this.partial = { src: job.src, tr };
      this.show();
    } catch {
      this.stats.errors++;
      // don't retry a failing finished sentence forever: show it untranslated
      for (const turn of this.turns) for (const s of turn.sentences) if (s.src === job.src && s.tr === null) s.tr = '';
    } finally {
      this.inflight = false;
      this.schedule();
    }
  }

  /** A sentence's translation, or (while it is on its way) the latest one of an earlier version of it. */
  private trOf(src: string, tr: string | null): string {
    if (tr !== null) return tr;
    return this.partial && src.startsWith(this.partial.src) ? this.partial.tr : '';
  }

  private show(): void {
    const turns = this.turns.map((t) => ({ dash: t.dash, sentences: t.sentences.map((s) => ({ src: s.src, tr: this.trOf(s.src, s.tr) })) }));
    // the sentence in progress joins the last turn; a previewed speaker change opens a new one
    this.pending().forEach((p, i) => {
      if (i > 0) turns.push({ dash: p.dash, sentences: [] });
      if (p.src) turns[turns.length - 1]!.sentences.push({ src: p.src, tr: this.trOf(p.src, this.cache.get(this.key(p.src)) ?? null) });
    });
    const shown = turns.filter((t) => t.sentences.length).slice(-this.opts.keepTurns);
    // only the last sentences of a turn: the older ones have usually scrolled off the screen
    const pairs: TranslationPair[] = shown.map((t) => {
      const last = t.sentences.slice(-this.opts.sentencesPerTurn);
      return { source: last.map((s) => s.src).join(' '), text: last.map((s) => s.tr).filter(Boolean).join(' ') };
    });
    const text = shown.map((t, i) => (t.dash && pairs[i]!.text ? `– ${pairs[i]!.text}` : pairs[i]!.text)).filter(Boolean).join('\n');
    const key = text + '\u0001' + pairs.map((p) => p.source).join('\u0001');
    if (key === this.lastShown) return;
    this.lastShown = key;
    this.emit('translation', { text, pairs });
  }
}
