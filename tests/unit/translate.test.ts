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
  it('prefers the frontmost app, else the one that started playing last', () => {
    const t = new SourceAppTracker();
    expect(t.pick([], 0)).toBeNull();
    expect(t.pick([s('Google Chrome')], 1)!.name).toBe('Google Chrome');
    expect(t.pick([s('Google Chrome'), s('zoom.us')], 2)!.name).toBe('zoom.us'); // newest
    expect(t.pick([s('Google Chrome', true), s('zoom.us')], 3)!.name).toBe('Google Chrome'); // frontmost wins
    expect(t.pick([s('zoom.us')], 4)!.name).toBe('zoom.us');
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
