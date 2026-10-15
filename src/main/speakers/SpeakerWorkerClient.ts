import { EventEmitter } from 'node:events';
import { ChildSupervisor } from '../native/ChildSupervisor';
import { encodeFrame, LineParser, SPEAKER_MAGIC } from '../native/protocol';
import type { SpeakerSpan } from './SpeakerAttributor';

const T_AUDIO = 1;
const FRAME = 160; // the worker reports 10 ms frames (160 samples at 16 kHz)
const BATCH = 1600; // send audio in 100 ms pieces

type Msg =
  | { type: 'ready'; loadMs: number; latencyMs: number }
  | { type: 'spk'; from: number; runs: [number, number, number][] }
  | { type: 'error'; fatal?: boolean; message: string };

/**
 * Runs the speaker-worker helper (speaker diarization on CoreML) on the same 16 kHz
 * audio Whisper gets. Events: 'ready'(loadMs) 'spans'(SpeakerSpan[]) 'down'(reason) 'log'(line)
 */
export class SpeakerWorkerClient extends EventEmitter {
  private sup: ChildSupervisor | null = null;
  private lines = new LineParser();
  ready = false;
  /** Absolute sample index of the first sample this worker process received. */
  private base: number | null = null;
  private pending: Float32Array[] = [];
  private pendingLen = 0;

  constructor(private readonly binPath: string, private readonly modelDir: string) {
    super();
  }

  start(): void {
    const sup = new ChildSupervisor({ name: 'speaker-worker', command: this.binPath, args: ['--model-dir', this.modelDir], maxRestarts: 2 });
    this.sup = sup;
    sup.on('spawn', () => { this.lines = new LineParser(); this.ready = false; this.base = null; this.pending = []; this.pendingLen = 0; });
    sup.on('stdout', (d: Buffer) => {
      for (const l of this.lines.push(d)) {
        let m: Msg;
        try { m = JSON.parse(l) as Msg; } catch { this.emit('log', `[speaker-worker] bad line: ${l.slice(0, 200)}`); continue; }
        if (m.type === 'ready') { this.ready = true; this.emit('log', `[speaker-worker] ready (load ${m.loadMs} ms, look-ahead ${m.latencyMs} ms)`); this.emit('ready', m.loadMs); }
        else if (m.type === 'spk') this.onRuns(m.from, m.runs);
        else if (m.type === 'error') this.emit('log', `[speaker-worker] ${m.fatal ? 'fatal: ' : ''}${m.message}`);
      }
    });
    sup.on('stderr', (s: string) => this.emit('log', s.trimEnd()));
    sup.on('exit', (code: number | null, _s: string | null, willRestart: boolean) => {
      this.ready = false;
      this.emit('log', `[speaker-worker] exited code=${code} restart=${willRestart}`);
      this.emit('down', 'exited');
    });
    sup.on('gave-up', () => this.emit('down', 'gave-up'));
    sup.start();
  }

  private onRuns(from: number, runs: [number, number, number][]): void {
    if (this.base === null) return;
    const spans: SpeakerSpan[] = [];
    let f = from;
    for (const [speaker, len, ov] of runs) {
      spans.push({ start: this.base + f * FRAME, end: this.base + (f + len) * FRAME, speaker, overlap: ov === 1 });
      f += len;
    }
    this.emit('spans', spans);
  }

  /** 16 kHz mono, contiguous; `startIndex` = absolute index of samples[0]. */
  push(samples: Float32Array, startIndex: number): void {
    if (!this.ready || !this.sup) return;
    if (this.base === null) this.base = startIndex;
    this.pending.push(samples);
    this.pendingLen += samples.length;
    if (this.pendingLen < BATCH) return;
    const all = new Float32Array(this.pendingLen);
    let o = 0;
    for (const p of this.pending) { all.set(p, o); o += p.length; }
    this.pending = [];
    this.pendingLen = 0;
    this.sup.write(encodeFrame(SPEAKER_MAGIC, T_AUDIO, 0, Buffer.from(all.buffer, all.byteOffset, all.byteLength)));
  }

  get pid(): number | undefined {
    return this.sup?.pid;
  }

  async stop(): Promise<void> {
    const s = this.sup;
    this.sup = null;
    this.ready = false;
    if (s) await s.stop(1500);
  }
}
