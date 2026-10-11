import { describe, expect, it } from 'vitest';
import { emptyLive, lastLines, liveReducer } from '../../src/renderer/shared/liveReducer';
import { resolveLang, translate } from '../../src/shared/i18n';

const seg = (startMs: number, text: string) => ({ startMs, endMs: startMs + 1000, text });

describe('liveReducer (renderer live transcript state)', () => {
  it('reset replaces everything; append adds segments and clears the open text; tail updates only the tail', () => {
    let s = liveReducer(emptyLive, { type: 'reset', startedAt: 1, segments: [seg(0, 'hello there')] });
    s = liveReducer(s, { type: 'tail', open: 'how are', provisional: 'you' });
    expect(lastLines(s, 3)).toEqual({ confirmed: 'hello there how are', provisional: 'you' });
    s = liveReducer(s, { type: 'append', segment: seg(2000, 'how are you') });
    expect(s.segments.map((g) => g.text)).toEqual(['hello there', 'how are you']);
    expect(s.open).toBe('');
    expect(s.provisional).toBe('you'); // provisional stays until the next tail
  });
  it('ignores duplicate deliveries and identical tails (no re-render)', () => {
    const s1 = liveReducer(emptyLive, { type: 'append', segment: seg(0, 'a') });
    expect(liveReducer(s1, { type: 'append', segment: seg(0, 'a') })).toBe(s1);
    const s2 = liveReducer(s1, { type: 'tail', open: 'x', provisional: 'y' });
    expect(liveReducer(s2, { type: 'tail', open: 'x', provisional: 'y' })).toBe(s2);
  });
  it('keeps memory bounded', () => {
    let s = emptyLive;
    for (let i = 0; i < 2100; i++) s = liveReducer(s, { type: 'append', segment: seg(i * 1000, `w${i}`) });
    expect(s.segments.length).toBe(2000);
    expect(s.segments[0]!.text).toBe('w100');
  });
});

describe('i18n', () => {
  it('follows the system language unless overridden and fills placeholders', () => {
    expect(resolveLang('system', ['pt-BR', 'en-US'])).toBe('pt-BR');
    expect(resolveLang('system', ['de-DE'])).toBe('en');
    expect(resolveLang('en', ['pt-BR'])).toBe('en');
    expect(translate('pt-BR', 'history.words', { n: 12 })).toBe('12 palavras');
    expect(translate('en', 'action.quit')).toBe('Quit Earline');
  });
});
