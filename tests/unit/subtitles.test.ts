import { describe, expect, it } from 'vitest';
import { HypothesisBuffer, TURN_TEXT, type Word } from '../../src/main/asr/localAgreement';
import { collapseRepeats, filterSegments, newStats } from '../../src/main/asr/filters';
import type { TranscriptUpdate } from '../../src/main/asr/TranscriptionProvider';
import { SubtitleManager } from '../../src/main/subtitles/SubtitleManager';

const SR = 16000;
/** words from "a b c" with 0.3 s per word starting at `t0` seconds */
const W = (s: string, t0 = 0): Word[] => s.split(' ').map((t, i) => ({ text: ` ${t}`, start: Math.round((t0 + i * 0.3) * SR), end: Math.round((t0 + i * 0.3 + 0.28) * SR), p: 0.9 }));
const upd = (confirmed: Word[], provisional: Word[] = [], utteranceEnd = false): TranscriptUpdate => ({ confirmed, provisional, windowEnd: 0, inferMs: 0, resultNs: 0n, utteranceEnd });
const text = (ws: Word[]) => ws.map((w) => w.text.trim()).join(' ');

describe('LocalAgreement-2 (HypothesisBuffer)', () => {
  it('confirms only the common prefix of two consecutive hypotheses', () => {
    const h = new HypothesisBuffer();
    h.insert(W('the quick brown'));
    expect(h.flush()).toEqual([]); // first hypothesis: nothing confirmed
    h.insert(W('the quick brown fox jumps'));
    expect(text(h.flush())).toBe('the quick brown');
    expect(text(h.tentative)).toBe('fox jumps');
    h.insert(W('the quick brown fox jumped over'));
    expect(text(h.flush())).toBe('fox');
    expect(text(h.tentative)).toBe('jumped over');
  });

  it('does not re-confirm words repeated by an overlapping window (text alignment)', () => {
    const h = new HypothesisBuffer();
    h.insert(W('we should address that'));
    h.flush();
    h.insert(W('we should address that before'));
    expect(text(h.flush())).toBe('we should address that');
    // window trimmed, but timestamps are coarse: the new hypothesis repeats committed words
    h.popCommittedBefore(Number.MAX_SAFE_INTEGER);
    h.insert(W('address that before the public', 0.6));
    // "before" was the previous tentative word and agrees -> confirmed; "address that" is not repeated
    expect(text(h.flush())).toBe('before');
    h.insert(W('address that before the public release', 0.6));
    expect(text(h.flush())).toBe('the public');
  });

  it('commitAll flushes the provisional tail at the end of an utterance', () => {
    const h = new HypothesisBuffer();
    h.insert(W('hello there'));
    h.flush();
    expect(text(h.commitAll())).toBe('hello there');
    expect(h.tentative).toEqual([]);
  });
});

describe('SubtitleManager', () => {
  it('confirmed text is immutable; only the provisional tail changes', () => {
    const m = new SubtitleManager({ maxCharsPerLine: 80, maxLines: 2 });
    m.apply(upd(W('good morning'), W('every one', 0.6)));
    let v = m.view();
    expect(v.lines).toEqual([{ id: expect.any(Number), committed: 'good morning', provisional: 'every one' }]);
    m.apply(upd([], W('everyone and', 0.6)));
    v = m.view();
    expect(v.lines[0]!.committed).toBe('good morning');
    expect(v.lines[0]!.provisional).toBe('everyone and');
    const id = v.lines[0]!.id;
    m.apply(upd(W('everyone', 0.6), W('and thank', 0.9)));
    v = m.view();
    expect(v.lines[0]!.id).toBe(id); // same line object -> renderer patches in place
    expect(v.lines[0]!.committed).toBe('good morning everyone');
    expect(v.lines[0]!.provisional).toBe('and thank');
  });

  it('deduplicates the same word confirmed twice by overlapping windows', () => {
    const m = new SubtitleManager({ maxCharsPerLine: 80, maxLines: 2 });
    m.apply(upd(W('reset their password', 1)));
    m.apply(upd(W('password we should', 1.6))); // "password" overlaps in time with the committed one
    expect(m.committedText).toBe('reset their password we should');
  });

  it('keeps at most maxLines lines and wraps by character count', () => {
    const m = new SubtitleManager({ maxCharsPerLine: 20, maxLines: 2 });
    for (let i = 0; i < 20; i++) m.apply(upd(W(`word${i} next${i}`, i * 0.6)));
    const v = m.view();
    expect(v.lines.length).toBeLessThanOrEqual(2);
    for (const l of v.lines) expect((l.committed + ' ' + l.provisional).trim().length).toBeLessThanOrEqual(20);
    expect(v.lines.at(-1)!.committed).toContain('next19');
  });

  it('reports newly visible words once (for latency metrics)', () => {
    const m = new SubtitleManager({ maxCharsPerLine: 80, maxLines: 2 });
    const seen: string[][] = [];
    m.on('change', (_v, nw: Word[]) => seen.push(nw.map((w) => w.text.trim())));
    m.apply(upd([], W('hello world')));
    m.apply(upd(W('hello'), W('world again', 0.3)));
    expect(seen).toEqual([['hello', 'world'], ['again']]);
  });
});

describe('anti-hallucination filters', () => {
  const seg = (text: string, o: Partial<{ noSpeechProb: number; avgLogprob: number }> = {}) => ({
    t0: 0, t1: 1000, noSpeechProb: o.noSpeechProb ?? 0.01, avgLogprob: o.avgLogprob ?? -0.2, text,
    tokens: text.split(' ').map((t, i) => ({ t0: i * 100, t1: i * 100 + 90, p: 0.9, text: ` ${t}` })),
  });
  const ctx = (ratio: number) => ({ speechRatio: () => ratio, windowStart: 0 });

  it('drops segments without VAD speech, typical silence phrases and low-confidence output', () => {
    const st = newStats();
    expect(filterSegments([seg('hello there')], ctx(0), st)).toEqual([]);
    expect(filterSegments([seg('Thank you.')], ctx(0.2), st)).toEqual([]);
    expect(filterSegments([seg('anything', { noSpeechProb: 0.9, avgLogprob: -1.2 })], ctx(1), st)).toEqual([]);
    expect(filterSegments([seg('[BLANK_AUDIO]')], ctx(1), st)).toEqual([]);
    expect(st.droppedNoVad).toBe(1);
    expect(st.droppedSilencePhrase).toBe(1);
    expect(st.droppedNoSpeech).toBe(1);
    expect(text(filterSegments([seg('Thank you.')], ctx(0.9), st))).toBe('Thank you.'); // real speech is kept
  });

  it('drops a lone low-confidence word (noise) but keeps a confident one', () => {
    const st = newStats();
    const one = (p: number) => ({ ...seg('Great.'), tokens: [{ t0: 0, t1: 300, p, text: ' Great.' }] });
    expect(filterSegments([one(0.55)], ctx(1), st)).toEqual([]);
    expect(st.droppedLowConfidenceShort).toBe(1);
    expect(text(filterSegments([one(0.9)], ctx(1), st))).toBe('Great.');
  });

  it('collapses repetition loops', () => {
    expect(text(collapseRepeats(W('I mean I mean I mean I mean okay')))).toBe('I mean okay');
    expect(text(collapseRepeats(W('the the the the end')))).toBe('the end');
    expect(text(collapseRepeats(W('very very good')))).toBe('very very good');
  });
});

describe('speaker turns (tinydiarize)', () => {
  const turnAfter = (ws: Word[]): Word[] => [...ws, { text: TURN_TEXT, start: ws.at(-1)!.end, end: ws.at(-1)!.end, p: 1 }];

  it('a turn is confirmed only when two hypotheses agree, and starts a new dashed line', () => {
    const h = new HypothesisBuffer();
    const m = new SubtitleManager({ maxCharsPerLine: 80, maxLines: 3 });
    h.insert([...turnAfter(W('are you ready')), ...W('yes', 1)]);
    m.apply(upd(h.flush(), h.tentative));
    const v0 = m.view().lines;
    expect(v0.every((l) => l.committed === '')).toBe(true); // nothing confirmed yet
    expect(v0.map((l) => l.provisional)).toEqual(['are you ready', '– yes']); // provisional preview of the break
    h.insert([...turnAfter(W('are you ready')), ...W('yes let us go', 1)]);
    m.apply(upd(h.flush(), h.tentative));
    const lines = m.view().lines;
    expect(lines.map((l) => l.committed)).toEqual(['are you ready', '– yes']);
  });

  it('alignment ignores markers missing from a later hypothesis and duplicate markers do not add lines', () => {
    const h = new HypothesisBuffer();
    h.insert(turnAfter(W('are you ready')));
    h.flush();
    h.insert([...turnAfter(W('are you ready')), ...W('yes', 1)]);
    expect(h.flush().map((w) => w.text.trim())).toEqual(['are', 'you', 'ready', TURN_TEXT.trim()]);
    h.popCommittedBefore(Number.MAX_SAFE_INTEGER);
    h.insert([...W('you ready', 0.3), ...W('yes I am', 1)]); // marker dropped by the new window
    expect(h.flush().map((w) => w.text.trim())).toEqual(['yes']);
    const m = new SubtitleManager({ maxCharsPerLine: 80, maxLines: 3 });
    const t = turnAfter(W('a b'));
    m.apply(upd([...t, t.at(-1)!, ...W('c', 1)]));
    expect(m.view().lines.map((l) => l.committed)).toEqual(['a b', '– c']);
    expect(m.committedText).toBe('a b c');
  });
});
