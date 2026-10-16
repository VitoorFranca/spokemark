// LocalAgreement-2 (Macháček et al., "Turning Whisper into Real-Time
// Transcription System", 2023): a word is confirmed once two consecutive
// hypotheses over a growing window agree on it as part of the common prefix.

export interface Word {
  text: string; // including leading space if any, as produced by the tokenizer
  start: number; // absolute sample index
  end: number;
  p: number; // mean token probability
}

/** Pseudo-word emitted after a segment when tinydiarize predicts a speaker turn. */
export const TURN_TEXT = ' ⟪SPEAKERTURN⟫';
export const isTurn = (w: { text: string }): boolean => w.text === TURN_TEXT;

/** A "word" that is only punctuation (some engines send a late "." on its own): it joins the word before it. */
export const isPunctuation = (t: string): boolean => /^[\p{P}]+$/u.test(t.trim());

export function normalizeWord(t: string): string {
  return t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

export class HypothesisBuffer {
  /** Committed words still inside the current audio window (for n-gram dedup). */
  private committedInBuffer: Word[] = [];
  private previous: Word[] = [];
  private current: Word[] = [];
  lastCommittedEnd = 0;

  /** Insert a new hypothesis (absolute times). */
  insert(words: Word[]): void {
    // The window still contains the audio of `committedInBuffer`, so the new
    // hypothesis normally starts by repeating those words. Align by *text*
    // first (whisper.cpp token timestamps are too coarse to rely on), and fall
    // back to timestamps only when the committed tail cannot be found.
    const aligned = this.alignAfterCommitted(words);
    if (aligned !== null) {
      this.current = aligned;
      return;
    }
    let w = words.filter((x) => x.start >= this.lastCommittedEnd - 0.1 * 16000);
    // Remove a 1..5-word n-gram that repeats the committed tail at the start.
    const cn = this.committedInBuffer.length;
    for (let n = Math.min(cn, w.length, 5); n >= 1; n--) {
      const tail = this.committedInBuffer.slice(cn - n).map((x) => normalizeWord(x.text)).join(' ');
      const head = w.slice(0, n).map((x) => normalizeWord(x.text)).join(' ');
      if (tail === head) { w = w.slice(n); break; }
    }
    this.current = w;
  }

  /** Index just after the committed tail inside `words`, or null if not found. */
  private alignAfterCommitted(words: Word[]): Word[] | null {
    // Speaker-turn markers are ignored for alignment (a later hypothesis may drop them).
    const c = this.committedInBuffer.filter((x) => !isTurn(x)).map((x) => normalizeWord(x.text)).filter(Boolean);
    if (c.length === 0) return null;
    const idx: number[] = []; // positions in `words` of real (non-marker) words
    words.forEach((w, i) => { if (!isTurn(w)) idx.push(i); });
    const h = idx.map((i) => normalizeWord(words[i]!.text));
    // Search only where the committed words can plausibly be (window start).
    const limit = Math.min(h.length, c.length + 4);
    for (let k = Math.min(c.length, 4); k >= Math.min(2, c.length); k--) {
      const tail = c.slice(c.length - k);
      for (let j = limit - k; j >= 0; j--) {
        let ok = true;
        for (let i = 0; i < k && ok; i++) ok = h[j + i] === tail[i];
        if (ok) {
          let rest = words.slice(idx[j + k - 1]! + 1);
          // a marker right after the committed tail was already committed with it
          if (rest.length > 0 && isTurn(rest[0]!) && this.committedInBuffer.length > 0 && isTurn(this.committedInBuffer[this.committedInBuffer.length - 1]!)) rest = rest.slice(1);
          return rest;
        }
      }
    }
    return null;
  }

  /** Commit the longest common prefix of the previous and current hypotheses. */
  flush(): Word[] {
    const commit: Word[] = [];
    while (this.current.length > 0 && this.previous.length > 0) {
      const a = this.current[0]!;
      const b = this.previous[0]!;
      const na = normalizeWord(a.text);
      // Pure punctuation tokens normalize to '' and agree only if identical.
      const agree = na === normalizeWord(b.text) && (na !== '' || a.text.trim() === b.text.trim());
      if (!agree) break;
      commit.push(a);
      this.lastCommittedEnd = a.end;
      this.current.shift();
      this.previous.shift();
    }
    this.previous = this.current;
    this.committedInBuffer.push(...commit);
    return commit;
  }

  /** Words that are not confirmed yet (provisional tail). */
  get tentative(): Word[] {
    return this.previous;
  }

  /** Commit everything still pending (end of utterance). */
  commitAll(): Word[] {
    const rest = this.previous;
    if (rest.length > 0) this.lastCommittedEnd = rest[rest.length - 1]!.end;
    this.committedInBuffer.push(...rest);
    this.previous = [];
    this.current = [];
    return rest;
  }

  /** Forget committed words that ended before `index` (buffer was trimmed). */
  popCommittedBefore(index: number, keepTail = 3): void {
    // Keep a short tail even if its (coarse) timestamps say it is outside the
    // window: the audio may still contain it, and text alignment needs it to
    // avoid re-committing those words.
    while (this.committedInBuffer.length > keepTail && this.committedInBuffer[0]!.end <= index) this.committedInBuffer.shift();
  }

  /** New utterance: nothing from the previous one can reappear. */
  resetCommitted(): void {
    this.committedInBuffer = [];
  }

  /** Drop pending hypotheses (e.g. the window moved past them). */
  clearPending(): void {
    this.previous = [];
    this.current = [];
  }

  get committedWords(): readonly Word[] {
    return this.committedInBuffer;
  }
}
