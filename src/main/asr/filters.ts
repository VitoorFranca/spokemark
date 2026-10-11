// Anti-hallucination filters applied to whisper output before LocalAgreement.
import type { WorkerSegment } from './WhisperWorkerClient';
import { normalizeWord, TURN_TEXT, type Word } from './localAgreement';

/** Typical outputs Whisper produces on silence / noise / music. */
const SILENCE_PHRASES = new Set(
  [
    'thank you', 'thank you.', 'thanks for watching', 'thanks for watching!', 'thank you for watching',
    'you', 'bye', 'bye.', 'okay', 'so', 'please subscribe', 'subtitles by the amaraorg community',
  ].map((s) => s.replace(/[^\p{L}\p{N}' ]/gu, '').trim()),
);

export interface FilterContext {
  /** fraction (0..1) of VAD speech frames inside [from,to) absolute samples */
  speechRatio(from: number, to: number): number;
  windowStart: number; // absolute sample index of window start
}

export interface FilterStats {
  droppedNoSpeech: number;
  droppedLowLogprob: number;
  droppedSilencePhrase: number;
  droppedNoVad: number;
  collapsedRepeats: number;
  droppedLowConfidenceShort: number;
}

export function newStats(): FilterStats {
  return { droppedNoSpeech: 0, droppedLowLogprob: 0, droppedSilencePhrase: 0, droppedNoVad: 0, collapsedRepeats: 0, droppedLowConfidenceShort: 0 };
}

const BRACKETED = /^\s*[[(].*[\])]\s*$/; // [BLANK_AUDIO], (music), [Applause] …

export function segmentToWords(seg: WorkerSegment, windowStart: number): Word[] {
  const words: Word[] = [];
  let cur: { text: string; start: number; end: number; ps: number[] } | null = null;
  for (const t of seg.tokens) {
    if (t.text.length === 0) continue;
    const startsWord = /^\s/.test(t.text) || cur === null;
    const s = windowStart + Math.round(t.t0 * 16);
    const e = windowStart + Math.round(t.t1 * 16);
    if (startsWord) {
      if (cur) words.push({ text: cur.text, start: cur.start, end: cur.end, p: avg(cur.ps) });
      cur = { text: t.text, start: s, end: e, ps: [t.p] };
    } else {
      cur!.text += t.text;
      cur!.end = Math.max(cur!.end, e);
      cur!.ps.push(t.p);
    }
  }
  if (cur) words.push({ text: cur.text, start: cur.start, end: cur.end, p: avg(cur.ps) });
  return words.filter((w) => !BRACKETED.test(w.text) && w.text.trim().length > 0);
}

function avg(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

/** Collapse loops like "the the the the" or "I mean, I mean, I mean". */
export function collapseRepeats(words: Word[], stats?: FilterStats): Word[] {
  const out = words.slice();
  for (let n = 1; n <= 4; n++) {
    let i = 0;
    while (i + 2 * n <= out.length) {
      const key = (k: number) => out.slice(k, k + n).map((w) => normalizeWord(w.text)).join(' ');
      const base = key(i);
      let reps = 1;
      while (i + (reps + 1) * n <= out.length && key(i + reps * n) === base) reps++;
      if (reps >= 3 && base !== '') {
        out.splice(i + n, (reps - 1) * n);
        if (stats) stats.collapsedRepeats++;
      }
      i++;
    }
  }
  return out;
}

export function filterSegments(segs: WorkerSegment[], ctx: FilterContext, stats: FilterStats): Word[] {
  const words: Word[] = [];
  for (const seg of segs) {
    const from = ctx.windowStart + seg.t0 * 16;
    const to = ctx.windowStart + Math.max(seg.t1, seg.t0 + 10) * 16;
    if (seg.noSpeechProb > 0.6 && seg.avgLogprob < -1.0) { stats.droppedNoSpeech++; continue; }
    if (seg.avgLogprob < -1.5) { stats.droppedLowLogprob++; continue; }
    const ratio = ctx.speechRatio(from, to);
    if (ratio === 0) { stats.droppedNoVad++; continue; }
    const norm = seg.text.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').trim();
    if (SILENCE_PHRASES.has(norm) && ratio < 0.5) { stats.droppedSilencePhrase++; continue; }
    if (BRACKETED.test(seg.text)) continue;
    const sw = segmentToWords(seg, ctx.windowStart);
    // A lone low-confidence word is the typical output on noise/applause ("Great.", "free.").
    if (sw.length === 1 && sw[0]!.p < 0.6) { stats.droppedLowConfidenceShort++; continue; }
    words.push(...sw);
    if (seg.speakerTurnNext && sw.length > 0) {
      const last = sw[sw.length - 1]!;
      words.push({ text: TURN_TEXT, start: last.end, end: last.end, p: 1 });
    }
  }
  return collapseRepeats(words, stats);
}
