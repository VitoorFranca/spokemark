import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveTranslator } from '../../src/main/translate/LiveTranslator';

afterEach(() => vi.useRealTimers());

/** fake translator with controllable completion */
function fake() {
  const calls: { text: string; target: string; resolve: (v: string) => void }[] = [];
  const fn = (text: string, target: string) => new Promise<string>((resolve) => calls.push({ text, target, resolve }));
  return { calls, fn };
}
const flush = () => new Promise((r) => setImmediate(r));

describe('LiveTranslator', () => {
  it('keeps one request in flight and translates only the newest text (latest wins)', async () => {
    vi.useFakeTimers();
    const f = fake();
    const shown: string[] = [];
    const lt = new LiveTranslator(f.fn, 'es', 300);
    lt.on('translation', (t) => shown.push(t.text));
    lt.update('Hello');
    vi.advanceTimersByTime(0);
    expect(f.calls.map((c) => c.text)).toEqual(['Hello']);
    lt.update('Hello there');
    lt.update('Hello there my');
    lt.update('Hello there my friend'); // only this one should be sent next
    vi.advanceTimersByTime(1000);
    expect(f.calls).toHaveLength(1); // still waiting on the first
    f.calls[0]!.resolve('Hola');
    await vi.runAllTimersAsync();
    expect(shown).toEqual([]); // stale result is not shown while newer text is pending
    expect(f.calls.map((c) => c.text)).toEqual(['Hello', 'Hello there my friend']);
    f.calls[1]!.resolve('Hola amigo');
    await vi.runAllTimersAsync();
    expect(shown).toEqual(['Hola amigo']);
    expect(lt.stats.dropped).toBe(2);
  });

  it('throttles requests and serves repeated text from the cache', async () => {
    vi.useFakeTimers();
    const f = fake();
    const shown: string[] = [];
    const lt = new LiveTranslator(f.fn, 'pt-BR', 300);
    lt.on('translation', (t) => shown.push(t.text));
    lt.update('Good morning');
    vi.advanceTimersByTime(0);
    f.calls[0]!.resolve('Bom dia');
    await vi.advanceTimersByTimeAsync(0);
    lt.update('Good morning everyone');
    await vi.advanceTimersByTimeAsync(100);
    expect(f.calls).toHaveLength(1); // throttled (300 ms since the last request)
    await vi.advanceTimersByTimeAsync(250);
    expect(f.calls).toHaveLength(2);
    f.calls[1]!.resolve('Bom dia a todos');
    await vi.advanceTimersByTimeAsync(0);
    lt.update('Good morning'); // back to an earlier text -> cache, no request
    expect(f.calls).toHaveLength(2);
    expect(lt.stats.cacheHits).toBe(1);
    expect(shown).toEqual(['Bom dia', 'Bom dia a todos', 'Bom dia']);
  });

  it('clears on empty text and drops the cache when the target language changes', async () => {
    vi.useFakeTimers();
    const f = fake();
    const shown: string[] = [];
    const lt = new LiveTranslator(f.fn, 'es', 0);
    lt.on('translation', (t) => shown.push(t.text));
    lt.update('Yes');
    await vi.advanceTimersByTimeAsync(0);
    f.calls[0]!.resolve('Sí');
    await vi.advanceTimersByTimeAsync(0);
    lt.update('');
    lt.setTarget('fr');
    lt.update('Yes');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.map((c) => `${c.target}:${c.text}`)).toEqual(['es:Yes', 'fr:Yes']);
    expect(shown).toEqual(['Sí', '']);
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

import { viewSegments } from '../../src/main/translate/LiveTranslator';
import { speakerChangesActive, translationLineCount } from '../../src/shared/models';

describe('speaker changes and translation', () => {
  it('splits the caption view into one segment per speaker; wrapped lines stay with their speaker', () => {
    const segs = viewSegments([
      { committed: 'so the plan is to ship', provisional: '' },
      { committed: 'on friday', provisional: '' },
      { committed: '– sounds good', provisional: 'to me' },
      { committed: '', provisional: '– wait' },
    ]);
    expect(segs).toEqual([
      { text: 'so the plan is to ship on friday', turn: false },
      { text: 'sounds good to me', turn: true },
      { text: 'wait', turn: true },
    ]);
    expect(viewSegments([{ committed: '–', provisional: '' }])).toEqual([]); // a fresh turn with no words yet
  });

  it('translates each speaker on its own and keeps one line per speaker with the dash', async () => {
    vi.useFakeTimers();
    const f = fake();
    const shown: string[] = [];
    const lt = new LiveTranslator(f.fn, 'es', 0);
    lt.on('translation', (t) => shown.push(t.text));
    lt.updateSegments([{ text: 'Hello', turn: false }, { text: 'Good morning', turn: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.map((c) => c.text)).toEqual(['Hello']);
    f.calls[0]!.resolve('Hola');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.map((c) => c.text)).toEqual(['Hello', 'Good morning']);
    f.calls[1]!.resolve('Buenos días');
    await vi.runAllTimersAsync();
    expect(shown).toEqual(['Hola\n– Buenos días']);
    // the first speaker is cached: a new third turn only translates the new text
    lt.updateSegments([{ text: 'Hello', turn: false }, { text: 'Good morning', turn: true }, { text: 'Bye', turn: true }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls.map((c) => c.text)).toEqual(['Hello', 'Good morning', 'Bye']);
    f.calls[2]!.resolve('Adiós');
    await vi.runAllTimersAsync();
    expect(shown.at(-1)).toBe('Hola\n– Buenos días\n– Adiós');
  });

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
