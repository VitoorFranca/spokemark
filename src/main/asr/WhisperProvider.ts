import { EventEmitter } from 'node:events';
import type { RingBuffer } from '../audio/dsp';
import { filterSegments, newStats, type FilterStats } from './filters';
import { HypothesisBuffer, type Word } from './localAgreement';
import type { TranscriptionProvider, TranscriptUpdate } from './TranscriptionProvider';
import { VoiceActivityDetector } from './VoiceActivityDetector';
import { WhisperWorkerClient, type WorkerResult, type WorkerVad } from './WhisperWorkerClient';

const SR = 16000;

export interface WhisperProviderOptions {
  binPath: string;
  modelPath: string;
  vadModelPath: string;
  stepMs: number; // how often a new inference may start
  minWindowMs: number; // don't transcribe less audio than this
  maxWindowS: number; // hard cap of the audio window
  trimWindowS: number; // trim the window at the last confirmed word beyond this length
  usePrompt: boolean; // condition on recently confirmed text
  minSilenceMs: number;
  /** Seconds of the previous utterance re-sent as context so a speaker-turn model sees the transition (0 = off). */
  turnContextS: number;
}

export const DEFAULT_WHISPER_OPTIONS: Omit<WhisperProviderOptions, 'binPath' | 'modelPath' | 'vadModelPath'> = {
  stepMs: 500,
  minWindowMs: 1000,
  maxWindowS: 15,
  trimWindowS: 8,
  usePrompt: false,
  minSilenceMs: 600,
  turnContextS: 0,
};

interface Inflight { id: number; start: number; end: number; sentNs: bigint }

export class WhisperProvider extends EventEmitter implements TranscriptionProvider {
  private readonly worker: WhisperWorkerClient;
  readonly vad: VoiceActivityDetector;
  private readonly hyp = new HypothesisBuffer();
  private bufferStart = 0;
  private contextFrom: number | null = null; // start of re-sent context (turn detection only)
  private inflight: Inflight | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  readonly stats = { inferences: 0, skippedBusy: 0, skippedNoSpeech: 0, forcedTrims: 0, filters: newStats() as FilterStats, inferMs: [] as number[] };

  constructor(private readonly ring: RingBuffer, private readonly opts: WhisperProviderOptions, worker?: WhisperWorkerClient) {
    super();
    // `worker` is injectable for unit tests (fake backend); production spawns the helper.
    this.worker = worker ?? new WhisperWorkerClient(opts.binPath, opts.modelPath, opts.vadModelPath);
    this.vad = new VoiceActivityDetector(this.worker, { minSilenceMs: opts.minSilenceMs });
    this.worker.on('vad', (m: WorkerVad) => this.vad.onProbs(m.id, m.probs));
    this.worker.on('result', (m: WorkerResult) => this.onResult(m));
    this.worker.on('log', (l: string) => this.emit('log', l));
    this.worker.on('error-msg', (m: string) => this.emit('error', m));
    this.worker.on('fatal', (m: string) => this.emit('fatal', m));
    this.worker.on('exit', (code: number | null, willRestart: boolean) => {
      // A crashed worker loses in-flight work; the VAD stream restarts from "now".
      this.inflight = null;
      this.emit('log', `[whisper] worker exited code=${code} restart=${willRestart}`);
    });
    this.worker.on('ready', () => { if (this.running) this.vad.reset(this.ring.end); this.bufferStart = this.ring.end; this.emit('ready'); });
  }

  get metalInitialized(): boolean {
    return this.worker.metalInitialized;
  }

  get pids(): number[] {
    return this.worker.pid ? [this.worker.pid] : [];
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.bufferStart = this.ring.end;
    this.hyp.clearPending();
    await new Promise<void>((resolve, reject) => {
      const onReady = () => { cleanup(); resolve(); };
      const onFatal = (m: string) => { cleanup(); reject(new Error(m)); };
      const to = setTimeout(() => { cleanup(); reject(new Error('whisper-worker did not become ready in 60 s')); }, 60_000);
      const cleanup = () => { clearTimeout(to); this.off('ready', onReady); this.off('fatal', onFatal); };
      this.on('ready', onReady);
      this.on('fatal', onFatal);
      this.worker.start();
    });
    this.vad.reset(this.ring.end);
    this.timer = setInterval(() => this.tick(), this.opts.stepMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.inflight = null;
    await this.worker.stop();
  }

  pushAudio(samples: Float32Array, _startIndex: number): void {
    if (!this.running || !this.worker.ready) return;
    this.vad.push(samples);
  }

  private speechRatio = (from: number, to: number): number => {
    const frames = Math.max(1, Math.ceil((to - from) / 512));
    return this.vad.speechFramesIn(from, to) / frames;
  };

  /** One scheduling step (normally driven by the stepMs timer). */
  tick(): void {
    if (!this.running || !this.worker.ready) return;
    if (this.inflight) { this.stats.skippedBusy++; return; } // backpressure: at most one inference

    const end = this.ring.end;
    // Never keep more audio than the ring buffer holds.
    if (this.bufferStart < this.ring.start) this.bufferStart = this.ring.start;
    const hasSpeech = this.vad.speechFramesIn(this.bufferStart, end) > 0;
    const pending = this.hyp.tentative.length > 0;

    if (!hasSpeech && !this.vad.speaking) {
      if (pending) this.finishUtterance(end, 0, 0n);
      // Slide the window over silence (keep 300 ms of context for word onsets).
      const processed = this.vad.processedUntil;
      this.bufferStart = Math.max(this.bufferStart, Math.min(end, processed) - 0.3 * SR);
      this.stats.skippedNoSpeech++;
      return;
    }
    if (end - this.bufferStart < (this.opts.minWindowMs / 1000) * SR) return;

    // Hard cap: never send more than maxWindowS.
    if (end - this.bufferStart > this.opts.maxWindowS * SR) {
      const committedEnd = this.hyp.lastCommittedEnd;
      if (committedEnd > this.bufferStart && end - committedEnd <= this.opts.maxWindowS * SR) {
        this.bufferStart = committedEnd;
      } else {
        this.finishUtterance(end, 0, 0n);
        this.bufferStart = end - 2 * SR;
      }
      this.hyp.popCommittedBefore(this.bufferStart);
      this.contextFrom = null;
      this.stats.forcedTrims++;
    }

    // Speech gating uses bufferStart; the audio sent may start earlier (context).
    let windowStart = this.bufferStart;
    if (this.contextFrom !== null && this.contextFrom < windowStart && end - this.contextFrom <= this.opts.maxWindowS * SR) {
      windowStart = Math.max(this.contextFrom, this.ring.start);
    }
    const audio = this.ring.read(windowStart, end);
    const prompt = this.opts.usePrompt ? this.hyp.committedWords.map((w) => w.text).join('').slice(-200) : undefined;
    const id = this.worker.transcribe(audio, prompt ? { prompt } : {});
    this.inflight = { id, start: windowStart, end, sentNs: process.hrtime.bigint() };
    this.emit('busy', true);
  }

  private onResult(m: WorkerResult): void {
    const inf = this.inflight;
    if (!inf || inf.id !== m.id) return; // stale result (after stop/restart)
    this.inflight = null;
    this.emit('busy', false);
    this.stats.inferences++;
    this.stats.inferMs.push(m.inferMs);
    if (this.stats.inferMs.length > 2000) this.stats.inferMs.shift();
    const resultNs = process.hrtime.bigint();

    const words = filterSegments(m.segments, { speechRatio: this.speechRatio, windowStart: inf.start }, this.stats.filters);
    // Words must not extend past the audio we sent.
    for (const w of words) { w.end = Math.min(w.end, inf.end); w.start = Math.min(w.start, w.end); }
    this.hyp.insert(words);
    const confirmed = this.hyp.flush();

    // The VAD already declared end-of-speech (after minSilenceMs) and this window
    // contains all of it -> the utterance is complete. (Requiring the VAD to have
    // processed up to inf.end almost never held: it works in 256 ms chunks.)
    const utteranceOver = !this.vad.speaking && this.vad.lastSpeechEnd > inf.start && this.vad.lastSpeechEnd <= inf.end;
    if (utteranceOver) {
      this.finishUtterance(inf.end, m.inferMs, resultNs, confirmed);
      this.bufferStart = Math.max(this.bufferStart, inf.end - 0.3 * SR);
      return;
    }
    this.emitUpdate(confirmed, this.hyp.tentative.slice(), inf.end, m.inferMs, resultNs, false);

    // Keep the window short: cut at the last confirmed word once it grows.
    if (inf.end - this.bufferStart > this.opts.trimWindowS * SR && this.hyp.lastCommittedEnd > this.bufferStart) {
      this.bufferStart = this.hyp.lastCommittedEnd;
      this.hyp.popCommittedBefore(this.bufferStart);
      this.contextFrom = null;
    }
  }

  private finishUtterance(windowEnd: number, inferMs: number, resultNs: bigint, alreadyConfirmed: Word[] = []): void {
    const rest = this.hyp.commitAll();
    const ctx = this.opts.turnContextS;
    // With turn context, keep enough committed words to align the repeated context away.
    this.hyp.popCommittedBefore(Number.MAX_SAFE_INTEGER, ctx > 0 ? 12 : 3);
    this.contextFrom = ctx > 0 ? Math.max(0, this.vad.lastSpeechEnd - ctx * SR) : null;
    this.emitUpdate([...alreadyConfirmed, ...rest], [], windowEnd, inferMs, resultNs || process.hrtime.bigint(), true);
  }

  private emitUpdate(confirmed: Word[], provisional: Word[], windowEnd: number, inferMs: number, resultNs: bigint, utteranceEnd: boolean): void {
    const u: TranscriptUpdate = { confirmed, provisional, windowEnd, inferMs, resultNs, utteranceEnd };
    this.emit('update', u);
  }

  get busy(): boolean {
    return this.inflight !== null;
  }
}
