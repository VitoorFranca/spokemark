import { EventEmitter } from 'node:events';
import { ChildSupervisor } from '../native/ChildSupervisor';
import { ASR_MAGIC, encodeFrame, LineParser } from '../native/protocol';
import type { Word } from './localAgreement';
import type { TranscriptionProvider, TranscriptUpdate } from './TranscriptionProvider';

const SR = 16000;
const BATCH = 1600; // audio goes out in 100 ms pieces
const T_AUDIO = 1;

type Timed = [string, number, number]; // text, start s, end s (since the first sample sent)
type Msg =
  | { type: 'ready'; loadMs: number }
  | { type: 'words'; final: Timed[]; volatile: Timed[] }
  | { type: 'error'; fatal?: boolean; message: string };

export interface StreamingEngineOptions { name: string; binPath: string; args: string[]; readyTimeoutMs?: number }

/** A word ending a sentence closes an utterance (history segments break there). */
const endsSentence = (t: string) => /[.?!]["')\]]*$/.test(t);

/**
 * A recognition engine that streams by itself (speech-worker: Apple SpeechAnalyzer;
 * parakeet-worker: Nemotron Speech Streaming). The helper decides which words are final;
 * there is no sliding window, VAD gate or LocalAgreement here. Final words become
 * `confirmed`, the volatile tail `provisional`, as with Whisper.
 *
 * Events: 'update'(TranscriptUpdate) 'ready'() 'busy'(false) 'log'(line) 'error'(msg) 'fatal'(msg)
 */
export class StreamingEngineProvider extends EventEmitter implements TranscriptionProvider {
  private sup: ChildSupervisor | null = null;
  private lines = new LineParser();
  private ready = false;
  private base: number | null = null; // absolute index of the first sample this helper process got
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  private sentEnd = 0;
  private provisional: Word[] = [];
  readonly busy = false;
  readonly metalInitialized = false;
  readonly stats = { inferences: 0, skippedBusy: 0, inferMs: [] as number[] };

  constructor(private readonly opts: StreamingEngineOptions) {
    super();
  }

  get pids(): number[] {
    return this.sup?.pid ? [this.sup.pid] : [];
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => { cleanup(); reject(new Error(`${this.opts.name} did not become ready`)); }, this.opts.readyTimeoutMs ?? 90_000);
      const onReady = () => { cleanup(); resolve(); };
      const onFatal = (m: string) => { cleanup(); reject(new Error(m)); };
      const cleanup = () => { clearTimeout(to); this.off('ready', onReady); this.off('fatal', onFatal); };
      this.on('ready', onReady);
      this.on('fatal', onFatal);
      const sup = new ChildSupervisor({ name: this.opts.name, command: this.opts.binPath, args: this.opts.args, maxRestarts: 3 });
      this.sup = sup;
      sup.on('spawn', () => { this.lines = new LineParser(); this.ready = false; this.base = null; this.pending = []; this.pendingLen = 0; this.provisional = []; });
      sup.on('stdout', (d: Buffer) => { for (const l of this.lines.push(d)) this.onLine(l); });
      sup.on('stderr', (s: string) => this.emit('log', s.trimEnd()));
      sup.on('exit', (code: number | null, _s: string | null, willRestart: boolean) => { this.ready = false; this.emit('log', `[${this.opts.name}] exited code=${code} restart=${willRestart}`); });
      sup.on('gave-up', () => this.emit('fatal', `${this.opts.name} kept crashing`));
      sup.start();
    });
  }

  private onLine(l: string): void {
    let m: Msg;
    try { m = JSON.parse(l) as Msg; } catch { this.emit('log', `[${this.opts.name}] bad line: ${l.slice(0, 200)}`); return; }
    if (m.type === 'ready') { this.ready = true; this.emit('log', `[${this.opts.name}] ready (load ${m.loadMs} ms)`); this.emit('ready'); return; }
    if (m.type === 'error') { if (m.fatal) this.emit('fatal', m.message); else this.emit('error', m.message); return; }
    if (m.type !== 'words' || this.base === null) return;
    const base = this.base;
    const toWord = ([text, s, e]: Timed): Word => ({ text: ` ${text}`, start: base + Math.round(s * SR), end: base + Math.round(Math.max(e, s) * SR), p: 1 });
    const confirmed = m.final.map(toWord);
    this.provisional = m.volatile.map(toWord);
    this.stats.inferences++;
    const last = confirmed[confirmed.length - 1];
    const u: TranscriptUpdate = {
      confirmed, provisional: this.provisional, windowEnd: this.sentEnd, inferMs: 0, resultNs: process.hrtime.bigint(),
      utteranceEnd: !!last && endsSentence(last.text.trim()) && this.provisional.length === 0,
    };
    this.emit('update', u);
  }

  pushAudio(samples: Float32Array, startIndex: number): void {
    if (!this.ready || !this.sup) return;
    if (this.base === null) this.base = startIndex;
    this.pending.push(samples);
    this.pendingLen += samples.length;
    this.sentEnd = startIndex + samples.length;
    if (this.pendingLen < BATCH) return;
    const all = new Float32Array(this.pendingLen);
    let o = 0;
    for (const p of this.pending) { all.set(p, o); o += p.length; }
    this.pending = [];
    this.pendingLen = 0;
    this.sup.write(encodeFrame(ASR_MAGIC, T_AUDIO, 0, Buffer.from(all.buffer, all.byteOffset, all.byteLength)));
  }

  async stop(): Promise<void> {
    const s = this.sup;
    this.sup = null;
    this.ready = false;
    if (s) await s.stop(3000);
  }
}
