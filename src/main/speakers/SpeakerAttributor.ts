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
    const votes = new Map<number, number>();
    for (const s of this.spans) {
      if (s.end <= from || s.speaker < 0) continue;
      if (s.start >= to) break;
      const n = Math.min(s.end, to) - Math.max(s.start, from);
      if (n > 0) votes.set(s.speaker, (votes.get(s.speaker) ?? 0) + n);
    }
    let best = -1, bestN = 0;
    for (const [spk, n] of votes) if (n > bestN) { best = spk; bestN = n; }
    return best;
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
    const end = Math.max(w.end, w.start + len) + 0.1 * SR;
    if (end > this.coveredUntil) return null;
    for (const s of this.spans) {
      if (s.end <= w.start || s.speaker < 0) continue;
      if (s.start >= end) break;
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
    const state = { current: this.current };
    let n = 0;
    for (; n < this.held.length; n++) {
      const w = this.held[n]!;
      const spk = this.timeline.speakerOfWord(w);
      if (spk === null && !force && now - w.start < this.opts.maxHoldS * SR) break;
      place(w, spk, out, state);
    }
    this.current = state.current;
    this.held.splice(0, n);
    const ended = this.heldUtteranceEnd && this.held.length === 0;
    if (ended) this.heldUtteranceEnd = false;
    const u = this.last!;
    return { ...u, confirmed: out, provisional: this.preview(u.provisional), utteranceEnd: ended };
  }

  /** Held words + the provisional tail, with markers wherever the timeline already knows. */
  private preview(provisional: Word[]): Word[] {
    const state = { current: this.current };
    const out: Word[] = [];
    for (const w of [...this.held, ...provisional.filter((x) => !isTurn(x))]) place(w, this.timeline.speakerOfWord(w), out, state);
    return out;
  }
}

/** Append `w` to `out`, preceded by a marker when its speaker differs from the previous one. */
function place(w: Word, spk: number | null, out: Word[], state: { current: number | null }): void {
  if (spk !== null && spk >= 0) {
    if (state.current !== null && spk !== state.current) out.push({ text: TURN_TEXT, start: w.start, end: w.start, p: 1 });
    state.current = spk;
  }
  out.push(w);
}
