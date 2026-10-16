import { isTurn, TURN_TEXT, type Word } from '../asr/localAgreement';
import type { TranscriptUpdate } from '../asr/TranscriptionProvider';

const SR = 16000;

/** Who was speaking over [start, end) (absolute 16 kHz samples). speaker -1 = nobody. */
export interface SpeakerSpan { start: number; end: number; speaker: number; overlap: boolean }

/**
 * Recent speaker activity from the diarizer, in absolute samples. Bounded: spans older
 * than `keepS` behind the newest one are dropped.
 */
export class SpeakerTimeline {
  private spans: SpeakerSpan[] = [];
  /** Everything before this sample has been diarized. */
  coveredUntil = 0;

  constructor(private readonly keepS = 60) {}

  add(spans: SpeakerSpan[]): void {
    for (const s of spans) {
      if (s.end <= s.start) continue;
      this.spans.push(s);
      this.coveredUntil = Math.max(this.coveredUntil, s.end);
    }
    const cut = this.coveredUntil - this.keepS * SR;
    let i = 0;
    while (i < this.spans.length && this.spans[i]!.end < cut) i++;
    if (i > 0) this.spans.splice(0, i);
  }

  /**
   * The speaker heard most over [from, to): null if that audio is not diarized yet,
   * -1 if nobody was speaking there.
   */
  speakerOver(from: number, to: number): number | null {
    if (to > this.coveredUntil) return null;
    const votes = new Map<number, { n: number; first: number }>();
    for (const s of this.spans) {
      if (s.end <= from || s.speaker < 0) continue;
      if (s.start >= to) break;
      const n = Math.min(s.end, to) - Math.max(s.start, from);
      if (n <= 0) continue;
      const v = votes.get(s.speaker);
      if (v) v.n += n; else votes.set(s.speaker, { n, first: s.start });
    }
    // Near tie (< 50 ms apart): the voice that starts later wins, because whisper.cpp word
    // starts lean early (a word starts where the previous one ended).
    let best = -1, bestV: { n: number; first: number } | null = null;
    for (const [spk, v] of votes) {
      if (!bestV || v.n > bestV.n + 0.05 * SR || (Math.abs(v.n - bestV.n) <= 0.05 * SR && v.first > bestV.first)) { best = spk; bestV = v; }
    }
    return best;
  }

  /** Silence right before the run of `speaker` that covers or follows sample `at` (0 if it follows another voice directly). */
  pauseBefore(speaker: number, at: number): number {
    let i = this.spans.findIndex((s) => s.speaker === speaker && s.end > at);
    if (i < 0) return 0;
    while (i > 0 && this.spans[i - 1]!.speaker === speaker) i--;
    let j = i - 1;
    let silenceFrom = this.spans[i]!.start;
    while (j >= 0 && this.spans[j]!.speaker < 0) { silenceFrom = this.spans[j]!.start; j--; }
    return this.spans[i]!.start - silenceFrom;
  }

  /**
   * The speaker of a word: the voice heard most over the word, from its start and for at
   * most 0.6 s. Whisper's word edges stretch into the silence around a word (whisper.cpp
   * words are contiguous: a word starts where the previous one ended, and the last word
   * before a pause can end far into it), and silence does not vote. When the word holds
   * no voice at all, the first voice right after it decides.
   */
  speakerOfWord(w: Word): number | null {
    const len = Math.min(0.6 * SR, Math.max(0.1 * SR, w.end - w.start));
    const atStart = this.speakerOver(w.start, w.start + len);
    if (atStart !== -1) return atStart;
    return this.firstVoice(w.start, Math.max(w.end, w.start + len) + 0.1 * SR);
  }

  /** The first voice heard in [from, to): null if not diarized yet, -1 if none. */
  firstVoice(from: number, to: number): number | null {
    if (to > this.coveredUntil) return null;
    for (const s of this.spans) {
      if (s.end <= from || s.speaker < 0) continue;
      if (s.start >= to) break;
      return s.speaker;
    }
    return -1;
  }
}

/**
 * Inserts speaker-change markers (TURN_TEXT) into the transcript using the diarizer's
 * timeline. Recognition and diarization stay separate: Whisper decides *what* was said,
 * the diarizer *who* said it, and words are matched to speakers by time.
 *
 * A confirmed word whose audio is not diarized yet is held back (it stays on screen as
 * provisional) until the timeline covers it or `maxHoldS` passes, then it is released
 * without a judgement. Overlapping speech goes to the strongest voice.
 * Speakers are numbers in order of arrival, forgotten when the session ends.
 */
export class SpeakerAttributor {
  readonly timeline = new SpeakerTimeline();
  /** The diarizer is running; when false, words pass straight through. */
  live = false;
  private current: number | null = null; // speaker of the last released word
  private prev: Word | null = null; // the last released word
  private held: Word[] = [];
  private heldUtteranceEnd = false;
  private last: TranscriptUpdate | null = null;

  constructor(private readonly opts: { maxHoldS: number } = { maxHoldS: 1.5 }) {}

  get holding(): boolean {
    return this.held.length > 0;
  }

  /** A transcript update from the recognizer -> the update to show and store. */
  apply(u: TranscriptUpdate): TranscriptUpdate {
    // the recognizer's own speaker-turn guesses are replaced by the diarizer's
    this.held.push(...u.confirmed.filter((w) => !isTurn(w)));
    if (u.utteranceEnd) this.heldUtteranceEnd = true;
    this.last = u;
    return this.release(u.windowEnd, !this.live);
  }

  /** New diarizer output -> an update releasing held words, or null if none can go yet. */
  addSpans(spans: SpeakerSpan[]): TranscriptUpdate | null {
    this.timeline.add(spans);
    if (!this.held.length || !this.last) return null;
    const u = this.release(this.timeline.coveredUntil, false);
    return u.confirmed.length ? u : null;
  }

  /** Release everything held (diarizer down, session stopping, or the hold timer fired). */
  flush(): TranscriptUpdate | null {
    if (!this.held.length || !this.last) return null;
    return this.release(Number.MAX_SAFE_INTEGER, true);
  }

  private release(now: number, force: boolean): TranscriptUpdate {
    const out: Word[] = [];
    const state: State = { current: this.current, prev: this.prev };
    let n = 0;
    for (; n < this.held.length; n++) {
      const w = this.held[n]!;
      const spk = this.judge(w, state);
      if (spk === null && !force && now - w.start < this.opts.maxHoldS * SR) break;
      place(w, spk, out, state);
    }
    this.current = state.current;
    this.prev = state.prev;
    this.held.splice(0, n);
    const ended = this.heldUtteranceEnd && this.held.length === 0;
    if (ended) this.heldUtteranceEnd = false;
    const u = this.last!;
    return { ...u, confirmed: out, provisional: this.preview(u.provisional), utteranceEnd: ended };
  }

  /**
   * A word's speaker (-1 = keep the current one; null = not diarized yet). Live, Whisper's
   * word times can be off by up to ~0.5 s around a pause, so punctuation, which Whisper
   * places well at speaker changes, settles the two ambiguous cases measured:
   * - across a pause (>= 0.15 s, where word times slide), a turn is not put right before
   *   the word that ends a sentence: it would split the sentence ("the budget is | tight."
   *   with "tight." timed inside the next voice);
   * - a voiceless word right after the end of a sentence goes to the first voice within
   *   0.5 s ("year. I | would" with "I" timed in the pause before the new voice).
   */
  private judge(w: Word, state: State): number | null {
    let spk = this.timeline.speakerOfWord(w);
    const prevEnds = !state.prev || endsSentence(state.prev);
    if (spk === -1 && prevEnds) spk = this.timeline.firstVoice(w.start, w.end + 0.5 * SR);
    if (spk === null) return null;
    if (spk >= 0 && state.current !== null && spk !== state.current && endsSentence(w) && !prevEnds
      && this.timeline.pauseBefore(spk, w.start - 0.6 * SR) >= 0.15 * SR) return -1;
    return spk;
  }

  /** Held words + the provisional tail, with markers wherever the timeline already knows. */
  private preview(provisional: Word[]): Word[] {
    const state: State = { current: this.current, prev: this.prev };
    const out: Word[] = [];
    for (const w of [...this.held, ...provisional.filter((x) => !isTurn(x))]) place(w, this.judge(w, state), out, state);
    return out;
  }
}

interface State { current: number | null; prev: Word | null }

const endsSentence = (w: Word): boolean => /[.?!]["')\]]*$/.test(w.text.trim());

/** Append `w` to `out`, preceded by a marker when its speaker differs from the previous one. */
function place(w: Word, spk: number | null, out: Word[], state: State): void {
  if (spk !== null && spk >= 0) {
    if (state.current !== null && spk !== state.current) out.push({ text: TURN_TEXT, start: w.start, end: w.start, p: 1 });
    state.current = spk;
  }
  state.prev = w;
  out.push(w);
}
