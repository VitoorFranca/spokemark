import { EventEmitter } from 'node:events';
import { ChildSupervisor } from '../native/ChildSupervisor';
import { encodeFrame, LineParser, WORKER_MAGIC } from '../native/protocol';

export interface WorkerToken { t0: number; t1: number; p: number; text: string }
export interface WorkerSegment {
  t0: number; // ms relative to the window start
  t1: number;
  speakerTurnNext?: boolean; // tinydiarize: the next segment is a different speaker
  noSpeechProb: number;
  avgLogprob: number;
  text: string;
  tokens: WorkerToken[];
}
export interface WorkerResult { type: 'result'; id: number; samples: number; inferMs: number; segments: WorkerSegment[] }
export interface WorkerVad { type: 'vad'; id: number; samples: number; ms: number; probs: number[] }
export interface WorkerReady { type: 'ready'; model: string; loadMs: number; warmupMs: number; system: string }
type WorkerMsg = WorkerResult | WorkerVad | WorkerReady | { type: 'error'; id?: number; fatal?: boolean; message: string };

const T_VAD = 10;
const T_TRANSCRIBE = 11;
const T_VAD_RESET = 12;

/**
 * Talks to the whisper-worker helper. Events:
 * 'ready'(WorkerReady) 'vad'(WorkerVad) 'result'(WorkerResult) 'error'(msg) 'log'(line)
 * 'exit'(code, willRestart) 'fatal'(message)
 */
export class WhisperWorkerClient extends EventEmitter {
  private sup: ChildSupervisor | null = null;
  private lines = new LineParser();
  private nextId = 1;
  ready = false;
  metalInitialized = false;

  constructor(private readonly binPath: string, private readonly modelPath: string, private readonly vadModelPath: string) {
    super();
  }

  start(): void {
    const sup = new ChildSupervisor({
      name: 'whisper-worker',
      command: this.binPath,
      args: ['--model', this.modelPath, '--vad-model', this.vadModelPath, '--threads', '4', ...(/-tdrz\.bin$/.test(this.modelPath) ? ['--tdrz'] : [])],
      maxRestarts: 3,
    });
    this.sup = sup;
    sup.on('spawn', () => { this.lines = new LineParser(); this.ready = false; });
    sup.on('stdout', (d: Buffer) => {
      for (const l of this.lines.push(d)) {
        let m: WorkerMsg;
        try { m = JSON.parse(l) as WorkerMsg; } catch { this.emit('log', `[whisper-worker] bad line: ${l.slice(0, 200)}`); continue; }
        if (m.type === 'ready') { this.ready = true; this.emit('ready', m); }
        else if (m.type === 'vad') this.emit('vad', m);
        else if (m.type === 'result') this.emit('result', m);
        else if (m.type === 'error') { if (m.fatal) this.emit('fatal', m.message); else this.emit('error-msg', m.message); }
      }
    });
    sup.on('stderr', (s: string) => {
      if (/ggml_metal_init|ggml_metal_device_init|using Metal backend|MTL/i.test(s)) this.metalInitialized = true;
      this.emit('log', s.trimEnd());
    });
    sup.on('exit', (code: number | null, _s: string | null, willRestart: boolean) => { this.ready = false; this.emit('exit', code, willRestart); });
    sup.on('gave-up', () => this.emit('fatal', 'whisper-worker kept crashing'));
    sup.start();
  }

  sendVad(samples: Float32Array): number {
    const id = this.nextId++;
    this.sup?.write(encodeFrame(WORKER_MAGIC, T_VAD, id, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)));
    return id;
  }

  resetVad(): void {
    this.sup?.write(encodeFrame(WORKER_MAGIC, T_VAD_RESET, this.nextId++, Buffer.alloc(0)));
  }

  transcribe(samples: Float32Array, opts: { prompt?: string } = {}): number {
    const id = this.nextId++;
    const json = Buffer.from(JSON.stringify(opts));
    const len = Buffer.alloc(4);
    len.writeUInt32LE(json.length, 0);
    const payload = Buffer.concat([len, json, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]);
    this.sup?.write(encodeFrame(WORKER_MAGIC, T_TRANSCRIBE, id, payload));
    return id;
  }

  get pid(): number | undefined {
    return this.sup?.pid;
  }

  async stop(): Promise<void> {
    const s = this.sup;
    this.sup = null;
    this.ready = false;
    if (s) await s.stop(3000);
  }
}
