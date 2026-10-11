import { EventEmitter } from 'node:events';
import { downmixToMono, RingBuffer, StreamingResampler } from './dsp';

export const TARGET_RATE = 16000;

interface Anchor {
  index: number; // absolute 16 kHz sample index
  ns: bigint; // capture host time (CLOCK_UPTIME_RAW ns) of that sample
}

/**
 * Converts captured audio (any rate / channel count) to 16 kHz mono and stores
 * it in a fixed-size ring buffer. Keeps a bounded list of (sample index ->
 * capture timestamp) anchors so latency can be measured per sample.
 *
 * Events: 'samples' (chunk: Float32Array, startIndex: number)
 */
export class AudioProcessingPipeline extends EventEmitter {
  readonly ring: RingBuffer;
  private resampler: StreamingResampler | null = null;
  private channels = 2;
  private anchors: Anchor[] = [];
  private static readonly MAX_ANCHORS = 512;

  constructor(readonly bufferSeconds = 60) {
    super();
    this.ring = new RingBuffer(bufferSeconds * TARGET_RATE);
  }

  setFormat(sampleRate: number, channels: number): void {
    // Format changes (e.g. output device switch) keep the absolute timeline.
    if (!this.resampler || this.resampler.inRate !== sampleRate || this.channels !== channels) {
      this.resampler = new StreamingResampler(sampleRate, TARGET_RATE);
      this.channels = channels;
    }
  }

  push(interleaved: Float32Array, captureNs: bigint): void {
    if (!this.resampler) throw new Error('setFormat() must be called before push()');
    const mono = downmixToMono(interleaved, this.channels);
    const out = this.resampler.process(mono);
    if (out.length === 0) return;
    const startIndex = this.ring.end;
    this.anchors.push({ index: startIndex, ns: captureNs });
    if (this.anchors.length > AudioProcessingPipeline.MAX_ANCHORS) this.anchors.shift();
    this.ring.write(out);
    this.emit('samples', out, startIndex);
  }

  /** Capture timestamp (ns) of an absolute sample index, interpolated from anchors. */
  captureTimeOf(index: number): bigint | null {
    const a = this.anchors;
    if (a.length === 0) return null;
    let best = a[0]!;
    for (let i = a.length - 1; i >= 0; i--) {
      if (a[i]!.index <= index) { best = a[i]!; break; }
    }
    const deltaNs = BigInt(Math.round(((index - best.index) / TARGET_RATE) * 1e9));
    return best.ns + deltaNs;
  }

  get endIndex(): number {
    return this.ring.end;
  }
}
