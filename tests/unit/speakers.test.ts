import { describe, expect, it } from 'vitest';
import { isTurn, type Word } from '../../src/main/asr/localAgreement';
import type { TranscriptUpdate } from '../../src/main/asr/TranscriptionProvider';
import { SpeakerAttributor, SpeakerTimeline, type SpeakerSpan } from '../../src/main/speakers/SpeakerAttributor';
import { SubtitleManager } from '../../src/main/subtitles/SubtitleManager';

const SR = 16000;
const w = (text: string, s: number, e: number): Word => ({ text: ` ${text}`, start: Math.round(s * SR), end: Math.round(e * SR), p: 0.9 });
const span = (speaker: number, s: number, e: number, overlap = false): SpeakerSpan => ({ speaker, start: Math.round(s * SR), end: Math.round(e * SR), overlap });
const upd = (confirmed: Word[], provisional: Word[] = [], end = 0, utteranceEnd = false): TranscriptUpdate =>
  ({ confirmed, provisional, windowEnd: Math.round(end * SR), inferMs: 100, resultNs: 0n, utteranceEnd });
const text = (ws: Word[]) => ws.map((x) => (isTurn(x) ? '|' : x.text.trim())).join(' ');

describe('SpeakerTimeline', () => {
  it('judges a word by the voice at its start, not by its (stretched) end', () => {
    const tl = new SpeakerTimeline();
    tl.add([span(0, 0, 2.0), span(-1, 2.0, 2.8), span(1, 2.8, 4)]);
    // Whisper stretched the last word of speaker 0 into the pause and up to speaker 1's start
    expect(tl.speakerOfWord(w('Marcos', 1.7, 2.9))).toBe(0);
    expect(tl.speakerOfWord(w('Bom', 2.85, 3.1))).toBe(1);
  });

  it('lets the voice heard most inside the word decide, not the tail of the previous speaker', () => {
    const tl = new SpeakerTimeline();
    tl.add([span(1, 6.48, 7.18), span(-1, 7.18, 7.46), span(2, 7.46, 8.5)]);
    // whisper.cpp: "That" 7.12–7.61 starts where "fly." ended, inside speaker 1's last syllable
    expect(tl.speakerOfWord(w('That', 7.12, 7.61))).toBe(2);
  });

  it('uses the first voice after a word whose start was stretched back into the pause', () => {
    const tl = new SpeakerTimeline();
    tl.add([span(0, 0, 2.37), span(-1, 2.37, 3.16), span(1, 3.16, 7.5)]);
    // whisper.cpp: "Yes," 2.71–3.14, but speaker B only starts at 3.16
    expect(tl.speakerOfWord(w('Yes,', 2.71, 3.14))).toBe(1);
  });

  it('says "not yet" for audio the diarizer has not reached, and -1 for silence', () => {
    const tl = new SpeakerTimeline();
    tl.add([span(0, 0, 1), span(-1, 1, 2)]);
    expect(tl.speakerOfWord(w('late', 1.95, 2.3))).toBeNull();
    expect(tl.speakerOfWord(w('noise', 1.2, 1.4))).toBe(-1);
  });

  it('gives overlapped speech to the strongest voice', () => {
    const tl = new SpeakerTimeline();
    tl.add([span(0, 0, 1.0), span(1, 1.0, 1.05, true), span(0, 1.05, 2, true)]);
    expect(tl.speakerOfWord(w('como', 1.0, 1.3))).toBe(0);
  });

  it('keeps a bounded window', () => {
    const tl = new SpeakerTimeline(10);
    for (let i = 0; i < 100; i++) tl.add([span(i % 2, i, i + 1)]);
    expect(tl.speakerOver(5 * SR, 6 * SR)).toBe(-1); // dropped
    expect(tl.speakerOver(95 * SR, 96 * SR)).toBe(1);
  });
});

describe('SpeakerAttributor', () => {
  it('inserts a turn where the speaker changes', () => {
    const a = new SpeakerAttributor();
    a.live = true;
    a.addSpans([span(0, 0, 2.4), span(-1, 2.4, 3.2), span(1, 3.2, 4.5)]);
    const u = a.apply(upd([w('are', 0.2, 0.4), w('you', 0.4, 0.6), w('ready', 0.6, 2.9), w('yes', 3.25, 3.6)], [], 4.5));
    expect(text(u.confirmed)).toBe('are you ready | yes');
  });

  it('holds words the diarizer has not covered yet, keeping them on screen, then releases them', () => {
    const a = new SpeakerAttributor();
    a.live = true;
    a.addSpans([span(0, 0, 1.0)]);
    const u1 = a.apply(upd([w('good', 0.1, 0.4), w('morning', 1.1, 1.5)], [w('everyone', 1.6, 2.0)], 2.0));
    expect(text(u1.confirmed)).toBe('good');
    expect(text(u1.provisional)).toBe('morning everyone'); // still visible
    expect(a.holding).toBe(true);
    const u2 = a.addSpans([span(1, 1.0, 2.0)])!;
    expect(text(u2.confirmed)).toBe('| morning');
    expect(a.holding).toBe(false);
  });

  it('releases unjudged words after the hold limit, and passes through when the diarizer is down', () => {
    const a = new SpeakerAttributor({ maxHoldS: 1 });
    a.live = true;
    a.addSpans([span(0, 0, 0.5)]);
    expect(text(a.apply(upd([w('one', 1.0, 1.2)], [], 1.5)).confirmed)).toBe('');
    expect(text(a.apply(upd([w('two', 1.3, 1.5)], [], 2.2)).confirmed)).toBe('one'); // 'one' waited > 1 s
    expect(text(a.flush()!.confirmed)).toBe('two');
    const b = new SpeakerAttributor();
    expect(text(b.apply(upd([w('hi', 0, 0.2)], [], 0.3)).confirmed)).toBe('hi'); // not live
  });

  it('carries the end of an utterance over to the update that releases its last word', () => {
    const a = new SpeakerAttributor();
    a.live = true;
    a.addSpans([span(0, 0, 0.5)]);
    const u1 = a.apply(upd([w('a', 0.1, 0.3), w('b', 0.6, 0.8)], [], 1.0, true));
    expect(u1.utteranceEnd).toBe(false);
    expect(a.addSpans([span(0, 0.5, 1.2)])!.utteranceEnd).toBe(true);
  });

  it('drops the recognizer\'s own turn guesses (the diarizer decides)', () => {
    const a = new SpeakerAttributor();
    a.live = true;
    a.addSpans([span(0, 0, 3)]);
    const turn: Word = { text: ' ⟪SPEAKERTURN⟫', start: 16000, end: 16000, p: 1 };
    expect(text(a.apply(upd([w('x', 0.1, 0.3), turn, w('y', 1.1, 1.3)], [], 3)).confirmed)).toBe('x y');
  });

  it('does not split a sentence right before its last word (live: "tight." timed inside the next voice)', () => {
    const a = new SpeakerAttributor();
    a.live = true;
    a.addSpans([span(1, 24.48, 25.92), span(-1, 25.92, 26.17), span(0, 26.17, 28)]);
    const u = a.apply(upd([w('budget', 24.95, 25.29), w('is', 25.36, 25.36), w('tight.', 26.15, 26.55), w('Sounds', 26.31, 26.61), w('good.', 26.78, 27.15)], [], 28));
    expect(text(u.confirmed)).toBe('budget is tight. | Sounds good.');
  });

  it('gives a voiceless word after a sentence end to the next voice (live: "I" timed in the pause)', () => {
    const a = new SpeakerAttributor();
    a.live = true;
    a.addSpans([span(0, 7.2, 8.08), span(-1, 8.08, 8.35), span(1, 8.35, 9.4)]);
    const u = a.apply(upd([w('this', 7.6, 7.76), w('year.', 7.76, 8.08), w('I', 8.08, 8.15), w('would', 8.49, 8.53)], [], 9.4));
    expect(text(u.confirmed)).toBe('this year. | I would');
  });

  it('without a pause, a near tie goes to the voice that starts later (live: "of" 60 vs 40 ms)', () => {
    const a = new SpeakerAttributor();
    a.live = true;
    a.addSpans([span(0, 12.96, 13.6), span(1, 13.6, 14.23)]);
    const u = a.apply(upd([w('table,', 13.23, 13.54), w('of', 13.54, 13.64), w('course.', 13.64, 14.05)], [], 14.23));
    expect(text(u.confirmed)).toBe('table, | of course.');
  });

  it('keeps a zero-length, sentence-ending word with the previous speaker (its time is not usable)', () => {
    const a = new SpeakerAttributor();
    a.live = true;
    a.addSpans([span(0, 5.3, 7.92), span(-1, 7.92, 8.18), span(1, 8.18, 9.4)]);
    const u = a.apply(upd([w('this', 7.79, 7.87), w('year.', 8.15, 8.15), w('I', 8.16, 8.19), w('would', 8.19, 8.38)], [], 9.4));
    expect(text(u.confirmed)).toBe('this year. | I would');
  });

  it('previews turns in the provisional tail when the timeline already knows', () => {
    const a = new SpeakerAttributor();
    a.live = true;
    a.addSpans([span(0, 0, 1), span(1, 1, 2)]);
    const u = a.apply(upd([w('hello', 0.1, 0.5)], [w('hi', 1.1, 1.3), w('there', 1.3, 1.6)], 2));
    expect(text(u.provisional)).toBe('| hi there');
  });

  it('gives the expected caption lines for the example dialogue', () => {
    // "Bom dia pessoal, me chamo Marcos, como vocês estão hoje?" with two interjections, then replies
    const a = new SpeakerAttributor();
    a.live = true;
    a.addSpans([span(0, 0, 4.0), span(1, 4.3, 4.6), span(2, 4.8, 5.2), span(1, 5.4, 5.8), span(2, 6.0, 7.0), span(0, 7.3, 7.8)]);
    const words = [w('Bom', 0.1, 0.3), w('dia', 0.3, 0.5), w('pessoal,', 0.5, 1.0), w('me', 1.1, 1.2), w('chamo', 1.2, 1.5), w('Marcos,', 1.5, 2.0),
      w('como', 2.1, 2.3), w('vocês', 2.3, 2.6), w('estão', 2.6, 2.9), w('hoje?', 2.9, 3.6), w('Bom', 4.35, 4.45), w('dia.', 4.45, 4.6),
      w('Bom', 4.85, 5.0), w('dia.', 5.0, 5.2), w('Bem.', 5.45, 5.8), w('Estou', 6.05, 6.3), w('bem,', 6.3, 6.5), w('Marcos.', 6.5, 7.0),
      w('Que', 7.35, 7.5), w('bom.', 7.5, 7.8)];
    const sub = new SubtitleManager({ maxLines: 8, maxCharsPerLine: 80 });
    sub.apply(a.apply(upd(words, [], 8, true)));
    expect(sub.view().lines.map((l) => l.committed)).toEqual([
      'Bom dia pessoal, me chamo Marcos, como vocês estão hoje?', '– Bom dia.', '– Bom dia.', '– Bem.', '– Estou bem, Marcos.', '– Que bom.',
    ]);
  });
});
