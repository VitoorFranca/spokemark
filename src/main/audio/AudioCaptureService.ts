import { EventEmitter } from 'node:events';
import { ChildSupervisor } from '../native/ChildSupervisor';
import { AUDIOTAP_MAGIC, float32FromBuffer, FrameParser, ProtocolError } from '../native/protocol';

export interface CaptureFormat {
  sampleRate: number;
  channels: number;
  outputDevice?: string;
}

export type CaptureStatus =
  | { event: 'started'; outputDevice?: string; permission?: string }
  | { event: 'permission-denied' }
  | { event: 'silent' | 'silent-since-start'; permission?: string }
  | { event: 'audio-resumed' }
  | { event: 'device-changed'; outputDevice?: string }
  | { event: 'level'; rms: number }
  | { event: 'error'; message: string }
  | { event: 'stopped' };

const FRAME_FORMAT = 1;
const FRAME_AUDIO = 2;
const FRAME_STATUS = 3;

/**
 * Runs the `audiotap` helper (CoreAudio Process Tap) and decodes its stream.
 * Events: 'format'(CaptureFormat) 'audio'(Float32Array interleaved, captureNs bigint)
 *         'status'(CaptureStatus) 'exit'(code, willRestart) 'fatal'(message)
 */
export class AudioCaptureService extends EventEmitter {
  private sup: ChildSupervisor | null = null;
  private parser = new FrameParser(AUDIOTAP_MAGIC);
  format: CaptureFormat | null = null;
  lastLevel = 0;

  constructor(private readonly binPath: string) {
    super();
  }

  start(): void {
    if (this.sup) return;
    this.parser = new FrameParser(AUDIOTAP_MAGIC);
    const sup = new ChildSupervisor({ name: 'audiotap', command: this.binPath, args: [], maxRestarts: 5 });
    this.sup = sup;
    sup.on('spawn', () => { this.parser = new FrameParser(AUDIOTAP_MAGIC); });
    sup.on('stdout', (d: Buffer) => {
      try {
        for (const f of this.parser.push(d)) this.handle(f.type, f.payload, f.timestampNs);
      } catch (e) {
        if (e instanceof ProtocolError) this.emit('status', { event: 'error', message: e.message });
        else throw e;
      }
    });
    sup.on('stderr', (s: string) => this.emit('log', s.trimEnd()));
    sup.on('exit', (code: number | null, _sig: string | null, willRestart: boolean) => {
      // exit code 3 = permission denied: restarting will not help
      if (code === 3) { void sup.stop(); this.emit('fatal', 'permission-denied'); return; }
      this.emit('exit', code, willRestart);
    });
    sup.on('gave-up', () => this.emit('fatal', 'audiotap kept crashing'));
    sup.start();
  }

  private handle(type: number, payload: Buffer, ns: bigint): void {
    if (type === FRAME_AUDIO) {
      this.emit('audio', float32FromBuffer(payload), ns);
    } else if (type === FRAME_FORMAT) {
      this.format = JSON.parse(payload.toString()) as CaptureFormat;
      this.emit('format', this.format);
    } else if (type === FRAME_STATUS) {
      const st = JSON.parse(payload.toString()) as CaptureStatus;
      if (st.event === 'level') this.lastLevel = st.rms;
      this.emit('status', st);
    }
  }

  get pid(): number | undefined {
    return this.sup?.pid;
  }

  async stop(): Promise<void> {
    const s = this.sup;
    this.sup = null;
    if (s) await s.stop();
  }
}
