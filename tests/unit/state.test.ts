import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { AppStateMachine, InvalidTransition } from '../../src/main/AppStateMachine';
import { RingBuffer } from '../../src/main/audio/dsp';
import { VoiceActivityDetector } from '../../src/main/asr/VoiceActivityDetector';
import { WhisperProvider, DEFAULT_WHISPER_OPTIONS } from '../../src/main/asr/WhisperProvider';
import type { WhisperWorkerClient } from '../../src/main/asr/WhisperWorkerClient';

describe('AppStateMachine', () => {
  it('follows idle -> starting -> capturing -> stopping -> idle', () => {
    const m = new AppStateMachine();
    const seen: string[] = [];
    m.on('change', (s) => seen.push(s));
    m.to('starting'); m.to('capturing'); m.to('stopping'); m.to('idle');
    expect(seen).toEqual(['starting', 'capturing', 'stopping', 'idle']);
  });
  it('rejects invalid transitions and records errors', () => {
    const m = new AppStateMachine();
    expect(() => m.to('capturing')).toThrow(InvalidTransition);
    m.to('starting');
    m.to('error', 'permission-denied');
    expect(m.error).toBe('permission-denied');
    expect(m.can('starting')).toBe(true);
    m.to('idle');
    expect(m.error).toBeNull();
  });
});

class FakeWorker extends EventEmitter {
  ready = false; metalInitialized = false; pid = undefined;
  vadSent: number[] = []; transcribeCalls: number[] = []; next = 1; lastTranscribeId = 0;
  start() { this.ready = true; setImmediate(() => this.emit('ready', {})); }
  async stop() { this.ready = false; }
  sendVad(s: Float32Array) { this.vadSent.push(s.length); return this.next++; }
  resetVad() {}
  transcribe(s: Float32Array) { const id = this.next++; this.lastTranscribeId = id; this.transcribeCalls.push(s.length); return id; }
}

describe('VoiceActivityDetector', () => {
  it('chunks audio into Silero frames and tracks speech with hysteresis', () => {
    const w = new FakeWorker();
    const vad = new VoiceActivityDetector(w, { chunkFrames: 4, minSilenceMs: 100 });
    const ev: string[] = [];
    vad.on('speech-start', () => ev.push('start'));
    vad.on('speech-end', () => ev.push('end'));
    vad.reset(0);
    vad.push(new Float32Array(1000));
    vad.push(new Float32Array(3000)); // 4000 samples -> one chunk of 2048, rest pending
    expect(w.vadSent).toEqual([2048]);
    vad.onProbs(1, [0.1, 0.9, 0.8, 0.4]);
    expect(ev).toEqual(['start']);
    expect(vad.speechFramesIn(0, 2048)).toBe(3);
    vad.push(new Float32Array(100));
    vad.onProbs(2, [0.1, 0.1, 0.1, 0.1]);
    expect(ev).toEqual(['start', 'end']);
  });
});

describe('WhisperProvider backpressure', () => {
  it('keeps at most one inference in flight and bounds the window', async () => {
    const ring = new RingBuffer(16000 * 60);
    const w = new FakeWorker();
    const p = new WhisperProvider(ring, { ...DEFAULT_WHISPER_OPTIONS, stepMs: 1e9, binPath: '', modelPath: '', vadModelPath: '' }, w as unknown as WhisperWorkerClient);
    await p.start();
    // 20 s of "speech" while the worker never answers
    for (let i = 0; i < 40; i++) {
      const s = new Float32Array(8000).fill(0.1);
      ring.write(s);
      p.pushAudio(s, ring.end - s.length);
      // answer VAD requests: everything is speech
      for (const id of [...(p.vad as unknown as { inflight: Map<number, number> }).inflight.keys()]) p.vad.onProbs(id, Array(8).fill(0.95));
      p.tick();
    }
    expect(w.transcribeCalls.length).toBe(1); // still waiting on the first one
    expect(p.stats.skippedBusy).toBeGreaterThan(30);
    expect(p.vad.pendingRequests).toBe(0);
    // answer it -> next tick sends again, window capped at maxWindowS
    w.emit('result', { type: 'result', id: w.lastTranscribeId, samples: 0, inferMs: 10, segments: [] });
    p.tick();
    expect(w.transcribeCalls.length).toBe(2);
    expect(w.transcribeCalls[1]!).toBeLessThanOrEqual(DEFAULT_WHISPER_OPTIONS.maxWindowS * 16000);
    await p.stop();
  });
});

describe('WhisperProvider turn context (tinydiarize)', () => {
  it('re-sends the last seconds of the previous utterance with the next window', async () => {
    const ring = new RingBuffer(16000 * 60);
    const w = new FakeWorker();
    const p = new WhisperProvider(ring, { ...DEFAULT_WHISPER_OPTIONS, stepMs: 1e9, turnContextS: 3, binPath: '', modelPath: '', vadModelPath: '' }, w as unknown as WhisperWorkerClient);
    await p.start();
    const vadIds = () => [...(p.vad as unknown as { inflight: Map<number, number> }).inflight.keys()];
    const feed = (seconds: number, speech: boolean) => {
      for (let i = 0; i < seconds * 4; i++) {
        const s = new Float32Array(4000).fill(speech ? 0.1 : 0);
        ring.write(s); p.pushAudio(s, ring.end - s.length);
        for (const id of vadIds()) p.vad.onProbs(id, Array(8).fill(speech ? 0.95 : 0.01));
      }
    };
    const answer = () => { if (p.busy) w.emit('result', { type: 'result', id: w.lastTranscribeId, samples: 0, inferMs: 1, segments: [] }); };
    feed(4, true); // utterance 1
    for (let i = 0; i < 4; i++) { feed(0.5, false); p.tick(); answer(); } // pause: windows until the utterance is closed
    const sentBefore = w.transcribeCalls.length;
    feed(2, false);
    p.tick(); // only silence since the utterance ended: nothing sent
    expect(w.transcribeCalls.length).toBe(sentBefore);
    feed(1.5, true); // utterance 2
    p.tick();
    expect(w.transcribeCalls.length).toBe(sentBefore + 1);
    // window = 3 s of context from utterance 1 + the pause + 1.5 s of utterance 2
    expect(w.transcribeCalls.at(-1)!).toBeGreaterThan(16000 * 4.5);
    await p.stop();
  });
});
