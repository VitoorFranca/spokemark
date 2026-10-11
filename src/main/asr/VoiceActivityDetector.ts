import { EventEmitter } from 'node:events';

export const VAD_FRAME = 512; // Silero frame at 16 kHz (32 ms)

export interface VadBackend {
  sendVad(samples: Float32Array): number;
  resetVad(): void;
}

export interface VadOptions {
  threshold: number; // enter speech
  negThreshold: number; // candidate silence
  minSilenceMs: number; // silence needed to end an utterance
  chunkFrames: number; // frames per request to the backend
}

const DEFAULTS: VadOptions = { threshold: 0.5, negThreshold: 0.35, minSilenceMs: 600, chunkFrames: 8 };

/**
 * Silero VAD (running inside whisper-worker via whisper.cpp's VAD API) applied
 * to the continuous 16 kHz stream. Keeps a bounded history of per-frame
 * speech flags addressed by absolute sample index.
 *
 * Events: 'speech-start'(sampleIndex) 'speech-end'(sampleIndex)
 */
export class VoiceActivityDetector extends EventEmitter {
  private readonly opts: VadOptions;
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  private nextFrameIndex = 0; // absolute frame index of the next frame to send
  private inflight = new Map<number, number>(); // request id -> first frame index
  private readonly historyFrames: number;
  private flags: Uint8Array; // ring of speech flags per frame
  private processedFrames = 0; // absolute frame index one past the last processed frame
  private inSpeech = false;
  private silenceFrames = 0;
  private lastSpeechFrame = -1;
  maxInflight = 0;

  constructor(private readonly backend: VadBackend, opts: Partial<VadOptions> = {}, historySeconds = 120) {
    super();
    this.opts = { ...DEFAULTS, ...opts };
    this.historyFrames = Math.ceil((historySeconds * 16000) / VAD_FRAME);
    this.flags = new Uint8Array(this.historyFrames);
  }

  reset(startSampleIndex: number): void {
    this.pending = [];
    this.pendingLen = 0;
    this.inflight.clear();
    this.nextFrameIndex = Math.ceil(startSampleIndex / VAD_FRAME);
    this.processedFrames = this.nextFrameIndex;
    this.flags.fill(0);
    this.inSpeech = false;
    this.silenceFrames = 0;
    this.lastSpeechFrame = -1;
    this.backend.resetVad();
  }

  /** Feed new 16 kHz samples (contiguous with previous calls). */
  push(samples: Float32Array): void {
    this.pending.push(samples);
    this.pendingLen += samples.length;
    const chunk = this.opts.chunkFrames * VAD_FRAME;
    while (this.pendingLen >= chunk) {
      const buf = new Float32Array(chunk);
      let filled = 0;
      while (filled < chunk) {
        const head = this.pending[0]!;
        const take = Math.min(head.length, chunk - filled);
        buf.set(head.subarray(0, take), filled);
        filled += take;
        if (take === head.length) this.pending.shift();
        else this.pending[0] = head.subarray(take);
      }
      this.pendingLen -= chunk;
      const id = this.backend.sendVad(buf);
      this.inflight.set(id, this.nextFrameIndex);
      this.maxInflight = Math.max(this.maxInflight, this.inflight.size);
      this.nextFrameIndex += this.opts.chunkFrames;
    }
  }

  /** Backend response for a request. */
  onProbs(id: number, probs: number[]): void {
    const first = this.inflight.get(id);
    if (first === undefined) return; // stale (before reset)
    this.inflight.delete(id);
    const minSilenceFrames = Math.ceil((this.opts.minSilenceMs * 16) / VAD_FRAME);
    for (let i = 0; i < probs.length; i++) {
      const f = first + i;
      const p = probs[i]!;
      let speech: boolean;
      if (this.inSpeech) {
        speech = p >= this.opts.negThreshold;
        if (speech) this.silenceFrames = 0;
        else if (++this.silenceFrames >= minSilenceFrames) {
          this.inSpeech = false;
          this.emit('speech-end', (this.lastSpeechFrame + 1) * VAD_FRAME);
        }
      } else {
        speech = p >= this.opts.threshold;
        if (speech) {
          this.inSpeech = true;
          this.silenceFrames = 0;
          this.emit('speech-start', f * VAD_FRAME);
        }
      }
      if (speech) this.lastSpeechFrame = f;
      this.flags[f % this.historyFrames] = speech ? 1 : 0;
      this.processedFrames = f + 1;
    }
  }

  /** Sample index up to which VAD decisions are known. */
  get processedUntil(): number {
    return this.processedFrames * VAD_FRAME;
  }

  get speaking(): boolean {
    return this.inSpeech;
  }

  get lastSpeechEnd(): number {
    return (this.lastSpeechFrame + 1) * VAD_FRAME;
  }

  /** Number of speech frames in [from, to) sample range (only frames already processed). */
  speechFramesIn(from: number, to: number): number {
    const f0 = Math.max(Math.floor(from / VAD_FRAME), this.processedFrames - this.historyFrames, 0);
    const f1 = Math.min(Math.ceil(to / VAD_FRAME), this.processedFrames);
    let n = 0;
    for (let f = f0; f < f1; f++) n += this.flags[f % this.historyFrames]!;
    return n;
  }

  get pendingRequests(): number {
    return this.inflight.size;
  }
}
