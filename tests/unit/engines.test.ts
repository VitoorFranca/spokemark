import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { StreamingEngineProvider } from '../../src/main/asr/StreamingEngineProvider';
import type { TranscriptUpdate } from '../../src/main/asr/TranscriptionProvider';

describe('StreamingEngineProvider (engines that stream by themselves)', () => {
  it('maps final words to confirmed and the volatile tail to provisional, on the absolute timeline', async () => {
    const p = new StreamingEngineProvider({ name: 'fake', binPath: process.execPath, args: [path.join(__dirname, 'fixtures/fake-engine.cjs')] });
    const updates: TranscriptUpdate[] = [];
    p.on('update', (u: TranscriptUpdate) => updates.push(u));
    await p.start();
    const base = 48_000; // the session's audio started 3 s before this engine
    for (let i = 0; i < 8; i++) p.pushAudio(new Float32Array(1600), base + i * 1600);
    await new Promise((r) => setTimeout(r, 300));
    await p.stop();
    expect(updates.map((u) => [u.confirmed.map((w) => w.text.trim()), u.provisional.map((w) => w.text.trim()), u.utteranceEnd])).toEqual([
      [['Hello'], ['wor'], false],
      [['world.'], [], true], // a sentence end with nothing pending closes the utterance
    ]);
    expect(updates[0]!.confirmed[0]).toMatchObject({ start: base + 800, end: base + 4800 });
  });
});
