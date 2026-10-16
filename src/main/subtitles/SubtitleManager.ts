import { EventEmitter } from 'node:events';
import { isPunctuation, isTurn, normalizeWord, type Word } from '../asr/localAgreement';
import type { TranscriptUpdate } from '../asr/TranscriptionProvider';

export interface SubtitleLine {
  id: number;
  committed: string; // immutable once the line is closed
  provisional: string; // only ever non-empty on the last line(s)
}

export interface SubtitleView {
  version: number;
  lines: SubtitleLine[];
}

export interface SubtitleOptions {
  maxCharsPerLine: number;
  maxLines: number;
}

/**
 * Turns confirmed/provisional word streams into a small set of caption lines.
 * - Confirmed text is append-only (never rewritten).
 * - The provisional tail is replaced wholesale on each update.
 * - Duplicates across overlapping windows are dropped by time + text.
 * - At most `maxLines` lines are exposed; older lines scroll out.
 *
 * Events: 'change'(SubtitleView, newWords: Word[])
 */
export class SubtitleManager extends EventEmitter {
  private closed: SubtitleLine[] = [];
  private openCommitted: string[] = [];
  private provisional: Word[] = [];
  private nextId = 1;
  private openId = 0;
  private version = 0;
  private lastCommitted: Word[] = []; // recent committed words, for dedup
  private shownProvisionalKeys = new Set<string>();

  constructor(private opts: SubtitleOptions) {
    super();
    this.openId = this.nextId++;
  }

  setOptions(o: Partial<SubtitleOptions>): void {
    this.opts = { ...this.opts, ...o };
    this.emitChange([]);
  }

  clear(): void {
    this.closed = [];
    this.openCommitted = [];
    this.provisional = [];
    this.lastCommitted = [];
    this.shownProvisionalKeys.clear();
    this.openId = this.nextId++;
    this.emitChange([]);
  }

  private isDuplicate(w: Word): boolean {
    const n = normalizeWord(w.text);
    const last = this.lastCommitted[this.lastCommitted.length - 1];
    if (!last) return false;
    // Same word again, overlapping in time with the last committed words.
    return this.lastCommitted.some((c) => normalizeWord(c.text) === n && w.start < c.end - 160 && w.end > c.start);
  }

  apply(u: TranscriptUpdate): void {
    const newWords: Word[] = [];
    for (const w of u.confirmed) {
      if (isTurn(w)) { this.speakerTurn(); continue; }
      if (this.isDuplicate(w)) continue;
      this.appendCommitted(w.text.trim());
      this.lastCommitted.push(w);
      if (this.lastCommitted.length > 8) this.lastCommitted.shift();
      const key = wordKey(w);
      if (!this.shownProvisionalKeys.has(key)) newWords.push(w);
    }
    this.provisional = u.provisional.filter((w) => isTurn(w) || !this.isDuplicate(w));
    const keys = new Set<string>();
    for (const w of this.provisional) {
      if (isTurn(w)) continue;
      const k = wordKey(w);
      keys.add(k);
      if (!this.shownProvisionalKeys.has(k)) newWords.push(w);
    }
    this.shownProvisionalKeys = keys;
    this.emitChange(newWords);
  }

  /** Speaker change: close the current line; the next one starts with a dash. */
  private speakerTurn(): void {
    if (this.openCommitted.length === 1 && this.openCommitted[0] === '–') return; // already at a fresh turn
    const cur = this.openCommitted.join(' ');
    if (cur.length > 0) {
      this.closed.push({ id: this.openId, committed: cur, provisional: '' });
      this.openId = this.nextId++;
      while (this.closed.length > this.opts.maxLines) this.closed.shift();
    }
    this.openCommitted = ['–'];
  }

  private appendCommitted(word: string): void {
    if (!word) return;
    if (isPunctuation(word) && this.openCommitted.length && this.openCommitted[this.openCommitted.length - 1] !== '–') {
      this.openCommitted[this.openCommitted.length - 1] += word;
      return;
    }
    const cur = this.openCommitted.join(' ');
    if (cur.length > 0 && cur.length + 1 + word.length > this.opts.maxCharsPerLine) {
      this.closed.push({ id: this.openId, committed: cur, provisional: '' });
      this.openId = this.nextId++;
      this.openCommitted = [];
      // Bounded history: only what may still be on screen (+1 for scroll animation).
      while (this.closed.length > this.opts.maxLines) this.closed.shift();
    }
    this.openCommitted.push(word);
  }

  view(): SubtitleView {
    const lines: SubtitleLine[] = [...this.closed];
    const committed = this.openCommitted.join(' ');
    // Lay out the provisional words after the open line, overflowing into virtual lines.
    let curCommitted = committed;
    let curProv = '';
    let curId = this.openId;
    let extra = 0;
    for (const w of this.provisional) {
      if (isTurn(w)) {
        // provisional speaker change: preview the break (only if the line has text)
        if (curCommitted || curProv) {
          lines.push({ id: curId, committed: curCommitted, provisional: curProv });
          curCommitted = '';
          curId = -(++extra);
          curProv = '–';
        }
        continue;
      }
      const t = w.text.trim();
      if (!t) continue;
      const len = curCommitted.length + (curCommitted && curProv ? 1 : 0) + curProv.length;
      if (len > 0 && len + 1 + t.length > this.opts.maxCharsPerLine) {
        lines.push({ id: curId, committed: curCommitted, provisional: curProv });
        curCommitted = '';
        curProv = '';
        curId = -(++extra); // provisional-only overflow lines get negative ids
      }
      curProv = curProv ? `${curProv} ${t}` : t;
    }
    lines.push({ id: curId, committed: curCommitted, provisional: curProv });
    const visible = lines.filter((l, i) => i < lines.length - 1 || l.committed || l.provisional || lines.length === 1);
    return { version: this.version, lines: visible.slice(-this.opts.maxLines) };
  }

  private emitChange(newWords: Word[]): void {
    this.version++;
    this.emit('change', this.view(), newWords);
  }

  /** Full committed transcript currently held (for tests / debugging). */
  get committedText(): string {
    return [...this.closed.map((l) => l.committed), this.openCommitted.join(' ')].filter(Boolean).join(' ').replace(/(^|\s)–(\s|$)/g, ' ').trim();
  }
}

function wordKey(w: Word): string {
  return `${normalizeWord(w.text)}@${Math.round(w.start / 1600)}`;
}
