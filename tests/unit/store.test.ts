import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_TEXT, type Word } from '../../src/main/asr/localAgreement';
import { TranscriptStore } from '../../src/main/store/TranscriptStore';
import { formatTimestamp, toMd, toSrt, toTxt, type ExportSession } from '../../src/shared/exporters';

/** words "a b c" with 0.4 s per word starting at t0 seconds (16 kHz sample indices) */
const W = (s: string, t0 = 0): Word[] => s.split(' ').map((t, i) => ({ text: ` ${t}`, start: Math.round((t0 + i * 0.4) * 16000), end: Math.round((t0 + i * 0.4 + 0.35) * 16000), p: 0.9 }));

let dir: string;
let store: TranscriptStore;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'earline-store-'));
  store = new TranscriptStore(path.join(dir, 'history.sqlite'));
  store.init();
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); vi.useRealTimers(); });

describe('TranscriptStore', () => {
  it('groups confirmed words into segments (pause / turn / size) with ms timestamps', () => {
    store.startSession('base.en', 1_000);
    store.addConfirmed(W('good morning everyone'), false);
    store.addConfirmed(W('thank you', 1.2), true); // utterance end closes the segment
    store.addConfirmed([...W('are you ready', 3), { text: TURN_TEXT, start: 0, end: 0, p: 1 }, ...W('yes', 5)], true);
    const live = store.liveSegments.map((s) => [s.startMs, s.text]);
    expect(live).toEqual([[0, 'good morning everyone thank you'], [3000, 'are you ready'], [5000, 'yes']]);
    expect(store.liveSegments[0]!.endMs).toBe(Math.round((1.2 + 0.4 + 0.35) * 1000));
  });

  it('writes in batches (not per segment) and persists the session on end', () => {
    vi.useFakeTimers();
    store.startSession('base.en', 1_000);
    const sid = store.listSessions()[0]!.id;
    store.addConfirmed(W('first segment here'), true);
    store.addConfirmed(W('second one', 2), true);
    expect(store.getSession(sid)!.segments).toHaveLength(0); // nothing written yet
    vi.advanceTimersByTime(2100);
    expect(store.getSession(sid)!.segments.map((s) => s.text)).toEqual(['first segment here', 'second one']);
    store.addConfirmed(W('third', 4), false); // still open
    store.endSession(9_000);
    const s = store.getSession(sid)!;
    expect(s.segments).toHaveLength(3);
    expect(s.endedAt).toBe(9_000);
    expect(s.wordCount).toBe(6);
    expect(s.preview).toContain('first segment here');
  });

  it('full-text search across sessions, safe against FTS syntax and prefix matching', () => {
    store.startSession('base.en', 1_000);
    store.addConfirmed(W('the database index is missing'), true);
    store.endSession(2_000);
    store.startSession('base.en', 3_000);
    store.addConfirmed(W('reset the password before release'), true);
    store.endSession(4_000);
    expect(store.listSessions({ query: 'datab' }).map((s) => s.startedAt)).toEqual([1_000]);
    expect(store.listSessions({ query: 'PASSWORD' })[0]!.snippet).toContain('«password»');
    expect(store.listSessions({ query: 'the' })).toHaveLength(2);
    expect(store.listSessions({ query: '"AND (* NEAR' })).toEqual([]); // no FTS syntax error
    expect(store.listSessions({ query: '"' })).toEqual([]);
  });

  it('does not keep empty sessions and does not persist when history is off', () => {
    store.startSession('base.en', 1_000);
    store.endSession(2_000);
    expect(store.sessionCount).toBe(0);
    store.persist = false;
    store.startSession('base.en', 3_000);
    store.addConfirmed(W('not stored anywhere'), true);
    expect(store.liveSegments).toHaveLength(1); // live view still works
    store.endSession(4_000);
    expect(store.sessionCount).toBe(0);
  });

  it('retention and deletion (single, range, all)', () => {
    const day = 86_400_000, now = 100 * day;
    for (const t of [now - 40 * day, now - 10 * day, now - 1 * day]) {
      store.startSession('base.en', t);
      store.addConfirmed(W('hello there'), true);
      store.endSession(t + 1000);
    }
    expect(store.applyRetention(30, now)).toBe(1);
    expect(store.sessionCount).toBe(2);
    expect(store.applyRetention(0, now)).toBe(0); // 0 = keep forever
    const [newest] = store.listSessions();
    store.deleteSession(newest!.id);
    expect(store.sessionCount).toBe(1);
    expect(store.listSessions({ query: 'hello' })).toHaveLength(1); // FTS index follows deletes
    expect(store.deleteAll()).toBe(1);
    expect(store.listSessions({ query: 'hello' })).toEqual([]);
  });
});

describe('exporters', () => {
  const s: ExportSession = {
    startedAt: Date.UTC(2026, 9, 11, 15, 0), endedAt: Date.UTC(2026, 9, 11, 16, 2, 3), sourceApp: 'Zoom',
    segments: [
      { startMs: 0, endMs: 2_500, text: 'Hello everyone.' },
      { startMs: 2_400, endMs: 2_600, text: 'Overlapping cue.' },
      { startMs: 3_723_004, endMs: 3_723_100, text: 'Late.' },
    ],
  };
  it('formats timestamps', () => {
    expect(formatTimestamp(3_723_004)).toBe('01:02:03');
    expect(formatTimestamp(3_723_004, true)).toBe('01:02:03,004');
    expect(formatTimestamp(-5, true)).toBe('00:00:00,000');
  });
  it('SRT: numbered cues, comma milliseconds, no overlaps, minimum duration', () => {
    expect(toSrt(s)).toBe(
      '1\n00:00:00,000 --> 00:00:02,400\nHello everyone.\n\n' +
      '2\n00:00:02,400 --> 00:00:02,900\nOverlapping cue.\n\n' +
      '3\n01:02:03,004 --> 01:02:03,504\nLate.\n');
  });
  it('TXT and MD', () => {
    expect(toTxt(s)).toBe('[00:00:00] Hello everyone.\n[00:00:02] Overlapping cue.\n[01:02:03] Late.\n');
    const md = toMd(s, 'Session', 'en-US');
    expect(md.startsWith('# Session\n\n_')).toBe(true);
    expect(md).toContain('01:02:03 · Zoom_');
    expect(md).toContain('**00:00:02** Overlapping cue.');
  });
});
