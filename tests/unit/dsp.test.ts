import { describe, expect, it } from 'vitest';
import { AudioProcessingPipeline } from '../../src/main/audio/AudioProcessingPipeline';
import { downmixToMono, RingBuffer, rms, StreamingResampler } from '../../src/main/audio/dsp';

const sine = (freq: number, rate: number, n: number, amp = 0.5) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));

function dominantAmplitude(x: Float32Array, freq: number, rate: number): number {
  let re = 0, im = 0;
  for (let i = 0; i < x.length; i++) { re += x[i]! * Math.cos((2 * Math.PI * freq * i) / rate); im += x[i]! * Math.sin((2 * Math.PI * freq * i) / rate); }
  return (2 * Math.hypot(re, im)) / x.length;
}

describe('downmixToMono', () => {
  it('averages interleaved channels', () => {
    expect(Array.from(downmixToMono(Float32Array.from([1, 0, 0.5, 0.5, -1, 1]), 2))).toEqual([0.5, 0.5, 0]);
    expect(Array.from(downmixToMono(Float32Array.from([0.1, 0.2]), 1))).toEqual([Math.fround(0.1), Math.fround(0.2)]);
  });
});

describe('StreamingResampler', () => {
  it('48k -> 16k keeps length ratio and passband amplitude across chunks', () => {
    const r = new StreamingResampler(48000, 16000);
    const input = sine(440, 48000, 48000);
    const out: number[] = [];
    for (let i = 0; i < input.length; i += 480) out.push(...r.process(input.subarray(i, i + 480))); // 10 ms chunks
    expect(Math.abs(out.length - 16000)).toBeLessThan(40);
    const o = Float32Array.from(out.slice(200)); // skip filter warm-up
    expect(dominantAmplitude(o, 440, 16000)).toBeGreaterThan(0.45);
  });

  it('attenuates content above the new Nyquist (anti-aliasing)', () => {
    const r = new StreamingResampler(48000, 16000);
    const out = r.process(sine(12000, 48000, 48000));
    // 12 kHz would alias to 4 kHz without filtering
    expect(rms(out.subarray(200))).toBeLessThan(0.02);
  });

  it('handles 44.1k -> 16k (non-integer ratio)', () => {
    const r = new StreamingResampler(44100, 16000);
    let n = 0;
    const input = sine(1000, 44100, 44100);
    for (let i = 0; i < input.length; i += 441) n += r.process(input.subarray(i, i + 441)).length;
    expect(Math.abs(n - 16000)).toBeLessThan(40);
  });
});

describe('RingBuffer', () => {
  it('reads by absolute index and wraps around', () => {
    const rb = new RingBuffer(10);
    rb.write(Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7]));
    rb.write(Float32Array.from([8, 9, 10, 11]));
    expect(rb.end).toBe(12);
    expect(rb.start).toBe(2);
    expect(Array.from(rb.read(0, 12))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(Array.from(rb.read(9, 11))).toEqual([9, 10]);
  });

  it('never grows: oversized writes keep only the newest samples', () => {
    const rb = new RingBuffer(4);
    rb.write(Float32Array.from([1, 2, 3, 4, 5, 6]));
    expect(rb.end).toBe(6);
    expect(Array.from(rb.read(0, 100))).toEqual([3, 4, 5, 6]);
  });
});

describe('AudioProcessingPipeline', () => {
  it('converts stereo 48k to mono 16k, bounded memory, with capture timestamps', () => {
    const p = new AudioProcessingPipeline(2); // 2 s ring
    p.setFormat(48000, 2);
    let emitted = 0;
    p.on('samples', (s: Float32Array) => { emitted += s.length; });
    const chunk = new Float32Array(480 * 2).fill(0.1);
    for (let i = 0; i < 1000; i++) p.push(chunk, BigInt(i) * 10_000_000n); // 10 s of audio
    expect(Math.abs(emitted - 160000)).toBeLessThan(50);
    expect(p.ring.capacity).toBe(32000);
    expect(p.ring.end - p.ring.start).toBe(32000);
    const t = p.captureTimeOf(p.endIndex - 160)!; // ~10 ms before the end
    expect(Number(t) / 1e6).toBeGreaterThan(9970);
    expect(Number(t) / 1e6).toBeLessThan(10000);
  });
});
