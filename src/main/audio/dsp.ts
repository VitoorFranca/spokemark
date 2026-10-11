// Pure DSP primitives used by AudioProcessingPipeline (unit tested).

/** Interleaved N-channel float32 -> mono (average). */
export function downmixToMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels === 1) return interleaved.slice();
  const frames = Math.floor(interleaved.length / channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += interleaved[i * channels + c]!;
    out[i] = s / channels;
  }
  return out;
}

/**
 * Streaming resampler: windowed-sinc low-pass FIR (anti-aliasing) + fractional
 * position interpolation. Keeps history between calls so chunk boundaries are
 * seamless. Output length per call depends on accumulated phase.
 */
export class StreamingResampler {
  private readonly ratio: number; // input samples per output sample
  private readonly taps: Float32Array;
  private readonly half: number;
  private hist: Float32Array; // last `2*half` input samples
  private pos = 0; // position of next output, in input samples, relative to hist start

  constructor(readonly inRate: number, readonly outRate: number, halfTaps = 16) {
    this.ratio = inRate / outRate;
    this.half = halfTaps;
    const cutoff = Math.min(1, outRate / inRate) * 0.9; // normalized to input Nyquist
    const n = halfTaps * 2 + 1;
    this.taps = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = i - halfTaps;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1)); // Blackman
      this.taps[i] = sinc * w;
      sum += this.taps[i]!;
    }
    for (let i = 0; i < n; i++) this.taps[i]! /= sum;
    this.hist = new Float32Array(halfTaps * 2);
    this.pos = halfTaps; // first output centered after enough history
  }

  process(input: Float32Array): Float32Array {
    if (this.inRate === this.outRate) return input.slice();
    const buf = new Float32Array(this.hist.length + input.length);
    buf.set(this.hist, 0);
    buf.set(input, this.hist.length);
    const h = this.half;
    const out: number[] = [];
    // Need taps around floor(pos) and floor(pos)+1 for linear interpolation of filtered signal.
    while (Math.floor(this.pos) + 1 + h < buf.length) {
      const i0 = Math.floor(this.pos);
      const frac = this.pos - i0;
      const a = this.fir(buf, i0);
      const b = this.fir(buf, i0 + 1);
      out.push(a + (b - a) * frac);
      this.pos += this.ratio;
    }
    // Keep last 2*half samples as history; shift pos accordingly.
    const keep = Math.min(buf.length, this.hist.length);
    const drop = buf.length - keep;
    this.hist = buf.slice(drop);
    this.pos -= drop;
    return Float32Array.from(out);
  }

  private fir(buf: Float32Array, center: number): number {
    const h = this.half;
    let s = 0;
    for (let k = -h; k <= h; k++) {
      const idx = center + k;
      if (idx >= 0 && idx < buf.length) s += buf[idx]! * this.taps[k + h]!;
    }
    return s;
  }
}

/**
 * Fixed-capacity ring buffer of float32 samples addressed by absolute sample
 * index (monotonic since start). Old samples are overwritten; memory never grows.
 */
export class RingBuffer {
  private readonly data: Float32Array;
  private written = 0; // total samples ever written (absolute index of next sample)

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  write(samples: Float32Array): void {
    let src = samples;
    if (src.length > this.capacity) src = src.subarray(src.length - this.capacity);
    const skipped = samples.length - src.length;
    this.written += skipped;
    let w = this.written % this.capacity;
    const first = Math.min(src.length, this.capacity - w);
    this.data.set(src.subarray(0, first), w);
    if (first < src.length) this.data.set(src.subarray(first), 0);
    this.written += src.length;
    w = this.written % this.capacity;
  }

  /** Absolute index one past the newest sample. */
  get end(): number {
    return this.written;
  }

  /** Oldest absolute index still available. */
  get start(): number {
    return Math.max(0, this.written - this.capacity);
  }

  /** Copy [from, to) in absolute indices; clamps to the available range. */
  read(from: number, to: number): Float32Array {
    const a = Math.max(from, this.start);
    const b = Math.min(to, this.end);
    if (b <= a) return new Float32Array(0);
    const out = new Float32Array(b - a);
    const s = a % this.capacity;
    const first = Math.min(out.length, this.capacity - s);
    out.set(this.data.subarray(s, s + first), 0);
    if (first < out.length) out.set(this.data.subarray(0, out.length - first), first);
    return out;
  }
}

export function rms(x: Float32Array): number {
  if (x.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / x.length);
}
