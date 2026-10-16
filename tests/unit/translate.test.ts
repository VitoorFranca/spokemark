import { afterEach, describe, expect, it, vi } from 'vitest';
import { TURN_TEXT, type Word } from '../../src/main/asr/localAgreement';
import type { TranscriptUpdate } from '../../src/main/asr/TranscriptionProvider';
import { SentenceTranslator } from '../../src/main/translate/SentenceTranslator';

afterEach(() => vi.useRealTimers());

/** fake translator with controllable completion */
function fake() {
  const calls: { text: string; target: string; resolve: (v: string) => void }[] = [];
  const fn = (text: string, target: string) => new Promise<string>((resolve) => calls.push({ text, target, resolve }));
  return { calls, fn };
}
const W = (text: string): Word => ({ text: ` ${text}`, start: 0, end: 0, p: 1 });
const words = (t: string) => t.split(' ').map(W);
const turn: Word = { text: TURN_TEXT, start: 0, end: 0, p: 1 };
const U = (confirmed: Word[], provisional: Word[] = [], utteranceEnd = false): TranscriptUpdate => ({ confirmed, provisional, windowEnd: 0, inferMs: 0, resultNs: 0n, utteranceEnd });
const opts = { throttleMs: 300, maxWords: 30, keepTurns: 6, sentencesPerTurn: 2 };

describe('SentenceTranslator (translation by sentence, fed by the transcript)', () => {
  it('translates a finished sentence once, first, and never again', async () => {
    vi.useFakeTimers();
    const f = fake();
    const shown: string[] = [];
    const st = new SentenceTranslator(f.fn, 'pt-BR', opts);
    st.on('translation', (t) => shown.push(t.text));
    st.apply(U(words('Good morning everyone.')));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.map((c) => c.text)).toEqual(['Good morning everyone.']);
    f.calls[0]!.resolve('Bom dia a todos.');
    await vi.advanceTimersByTimeAsync(0);
    st.apply(U(words('How'), words('are')));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.calls.map((c) => c.text)).toEqual(['Good morning everyone.', 'How are']); // only the new sentence in progress
    expect(shown.at(-1)).toBe('Bom dia a todos.');
  });

  it('throttles the sentence in progress and keeps its last translation on screen meanwhile', async () => {
    vi.useFakeTimers();
    const f = fake();
    const shown: string[] = [];
    const st = new SentenceTranslator(f.fn, 'pt-BR', opts);
    st.on('translation', (t) => shown.push(t.text));
    st.apply(U([], words('Only one')));
    await vi.advanceTimersByTimeAsync(0);
    f.calls[0]!.resolve('Apenas um');
    await vi.advanceTimersByTimeAsync(0);
    st.apply(U(words('Only'), words('one, the date')));
    await vi.advanceTimersByTimeAsync(100);
    expect(f.calls).toHaveLength(1); // throttled
    expect(shown.at(-1)).toBe('Apenas um'); // the earlier version stays
    await vi.advanceTimersByTimeAsync(300);
    expect(f.calls.map((c) => c.text)).toEqual(['Only one', 'Only one, the date']);
  });

  it('a finished sentence jumps ahead of the sentence in progress', async () => {
    vi.useFakeTimers();
    const f = fake();
    const st = new SentenceTranslator(f.fn, 'es', opts);
    st.apply(U([], words('Hello there')));
    await vi.advanceTimersByTimeAsync(0);
    st.apply(U(words('Hello there.'), words('Next')));
    f.calls[0]!.resolve('Hola');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.map((c) => c.text)).toEqual(['Hello there', 'Hello there.']);
  });

  it('gives each speaker turn its own translation, oldest first, with the dash', async () => {
    const tr: Record<string, string> = { 'hi': 'oi', 'how are you': 'como está você?' };
    const st = new SentenceTranslator(async (t) => tr[t] ?? t, 'pt-BR', { ...opts, throttleMs: 0 });
    const got: { text: string; pairs: { source: string; text: string }[] }[] = [];
    st.on('translation', (t) => got.push(t));
    st.apply(U([...words('hi'), turn, ...words('how are you')], [], true));
    await new Promise((r) => setTimeout(r, 20));
    expect(got.at(-1)!.pairs).toEqual([{ source: 'hi', text: 'oi' }, { source: 'how are you', text: 'como está você?' }]);
    expect(got.at(-1)!.text).toBe('oi\n– como está você?');
  });

  it('keeps only the last sentences of a long turn (the older ones have scrolled away)', async () => {
    const st = new SentenceTranslator(async (t) => t.toUpperCase(), 'x', { ...opts, throttleMs: 0 });
    const got: string[] = [];
    st.on('translation', (t) => got.push(t.text));
    st.apply(U(words('One. Two. Three.')));
    await new Promise((r) => setTimeout(r, 20));
    expect(got.at(-1)).toBe('TWO. THREE.');
  });

  it('drops late results after clear() or a change of language', async () => {
    vi.useFakeTimers();
    const f = fake();
    const shown: string[] = [];
    const st = new SentenceTranslator(f.fn, 'es', opts);
    st.on('translation', (t) => shown.push(t.text));
    st.apply(U(words('Yes.')));
    await vi.advanceTimersByTimeAsync(0);
    st.setTarget('fr');
    f.calls[0]!.resolve('Sí');
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).not.toContain('Sí');
    expect(f.calls.map((c) => `${c.target}:${c.text}`)).toEqual(['es:Yes.', 'fr:Yes.']);
  });
});

import { SourceAppTracker } from '../../src/main/SourceApp';

describe('SourceAppTracker', () => {
  const s = (name: string, frontmost = false) => ({ name, path: `/Applications/${name}.app`, frontmost });
  it('picks the app that started playing last; frontmost only breaks ties', () => {
    const t = new SourceAppTracker();
    expect(t.pick([], 0)).toBeNull();
    expect(t.pick([s('Google Chrome', true)], 1)!.name).toBe('Google Chrome');
    // a silent browser in front keeps its stream open; the newly playing app wins
    expect(t.pick([s('Google Chrome', true), s('iTerm2')], 2)!.name).toBe('iTerm2');
    expect(t.pick([s('Google Chrome', true), s('iTerm2')], 3)!.name).toBe('iTerm2');
    expect(t.pick([s('zoom.us', true), s('Spotify')], 4)!.name).toBe('zoom.us'); // both new at once: frontmost
  });
});

import { matchLanguage } from '../../src/shared/lang';

describe('matchLanguage', () => {
  it('matches exact ids, then the base language', () => {
    const ids = ['de', 'es', 'es-MX', 'pt', 'zh-Hant'];
    expect(matchLanguage('es-MX', ids)).toBe('es-MX');
    expect(matchLanguage('pt-BR', ids)).toBe('pt');
    expect(matchLanguage('es-ES', ids)).toBe('es');
    expect(matchLanguage('zh-Hant-TW', ids)).toBe('zh-Hant');
    expect(matchLanguage('ja', ids)).toBeNull();
  });
});

import { speakerChangesActive, translationLineCount } from '../../src/shared/models';

describe('speaker changes and translation', () => {
  it('speaker changes are a setting of their own: any model with the speaker model, else only tinydiarize', () => {
    expect(speakerChangesActive({ speakerChanges: true, model: 'base.en' }, true)).toBe(true);
    expect(speakerChangesActive({ speakerChanges: true, model: 'base.en' }, false)).toBe(false);
    expect(speakerChangesActive({ speakerChanges: true, model: 'small.en-tdrz' }, false)).toBe(true);
    expect(speakerChangesActive({ speakerChanges: false, model: 'small.en-tdrz' }, true)).toBe(false);
    expect(translationLineCount(2, false)).toBe(1);
    expect(translationLineCount(2, true)).toBe(2);
    expect(translationLineCount(3, true)).toBe(3);
  });
});

import { speakerGroups, translationFor } from '../../src/renderer/shared/CaptionBox';

describe('translation under each speaker', () => {
  const L = (id: number, committed: string, provisional = '') => ({ id, committed, provisional });

  it('groups caption lines by speaker, joining wrapped lines', () => {
    const g = speakerGroups([L(1, 'hi'), L(2, '– how are'), L(3, 'you', 'today')]);
    expect(g.map((x) => [x.text, x.turn, x.lines.length])).toEqual([['hi', false, 1], ['how are you today', true, 2]]);
  });

  it('puts translations under speaker groups counted from the newest (scrolling never shifts them)', () => {
    const pairs = [{ source: 'a', text: 'A' }, { source: 'b', text: 'B' }, { source: 'c', text: 'C' }];
    expect([0, 1].map((i) => translationFor(i, 2, pairs))).toEqual(['B', 'C']); // the oldest turn scrolled away
    expect(translationFor(0, 4, pairs)).toBeNull(); // more groups than translations yet
  });
});
