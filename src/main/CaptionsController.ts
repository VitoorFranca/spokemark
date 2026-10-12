import { EventEmitter } from 'node:events';
import path from 'node:path';
import { AppStateMachine } from './AppStateMachine';
import { AudioCaptureService, type CaptureFormat, type CaptureStatus } from './audio/AudioCaptureService';
import { AudioProcessingPipeline } from './audio/AudioProcessingPipeline';
import type { Word } from './asr/localAgreement';
import type { TranscriptUpdate } from './asr/TranscriptionProvider';
import { DEFAULT_WHISPER_OPTIONS, WhisperProvider } from './asr/WhisperProvider';
import { binDir, modelPath, vadModelPath, type ModelId } from './paths';
import { SubtitleManager, type SubtitleView } from './subtitles/SubtitleManager';

export type Indicator = 'idle' | 'starting' | 'capturing' | 'processing' | 'silent' | 'permission' | 'error';

/**
 * Orchestrates one captioning session: capture -> pipeline -> VAD/whisper -> subtitles.
 * Capture and inference are independent: audio keeps flowing into the ring
 * buffer while an inference runs.
 *
 * Events: 'view'(SubtitleView, newWords) 'indicator'(Indicator, text) 'update'(TranscriptUpdate) 'log'(line)
 *         'level'(dBFS) ~15 Hz while capturing, 'sources'(app names producing audio), 'session'(started|ended)
 */
export class CaptionsController extends EventEmitter {
  readonly state = new AppStateMachine();
  readonly subtitles: SubtitleManager;
  private capture: AudioCaptureService | null = null;
  private pipeline: AudioProcessingPipeline | null = null;
  private provider: WhisperProvider | null = null;
  private model: ModelId;
  indicator: Indicator = 'idle';
  indicatorText = '';
  private silent = false;
  private levelAcc = 0;
  private levelN = 0;
  private levelLast = 0;
  sources: string[] = [];
  sourceDetails: { name: string; path: string; frontmost: boolean; icon?: string }[] = [];

  constructor(model: ModelId, opts: { maxLines: number; maxCharsPerLine: number }) {
    super();
    this.model = model;
    this.subtitles = new SubtitleManager(opts);
    this.subtitles.on('change', (v: SubtitleView, w: Word[]) => this.emit('view', v, w));
    this.state.on('change', () => this.refreshIndicator());
  }

  get currentModel(): ModelId {
    return this.model;
  }

  get pids(): number[] {
    return [this.capture?.pid, ...(this.provider?.pids ?? [])].filter((p): p is number => typeof p === 'number');
  }

  get captureTimeOf(): ((i: number) => bigint | null) | null {
    const p = this.pipeline;
    return p ? (i) => p.captureTimeOf(i) : null;
  }

  get providerStats() {
    return this.provider?.stats ?? null;
  }

  private setIndicator(i: Indicator, text = ''): void {
    this.indicator = i;
    this.indicatorText = text;
    this.emit('indicator', i, text);
  }

  private refreshIndicator(): void {
    const s = this.state.state;
    if (s === 'error') return this.setIndicator(this.state.error === 'permission-denied' ? 'permission' : 'error', this.state.error ?? '');
    if (s === 'capturing') return this.setIndicator(this.provider?.busy ? 'processing' : this.silent ? 'silent' : 'capturing');
    this.setIndicator(s === 'starting' ? 'starting' : s === 'stopping' ? 'starting' : 'idle');
  }

  async start(): Promise<void> {
    if (!this.state.can('starting')) return;
    this.state.to('starting');
    this.silent = false;
    this.subtitles.clear();
    const pipeline = new AudioProcessingPipeline(60);
    const provider = new WhisperProvider(pipeline.ring, {
      ...DEFAULT_WHISPER_OPTIONS,
      binPath: path.join(binDir(), 'whisper-worker'),
      modelPath: modelPath(this.model),
      vadModelPath: vadModelPath(),
      turnContextS: this.model.endsWith('-tdrz') ? 3 : 0,
    });
    const capture = new AudioCaptureService(path.join(binDir(), 'audiotap'));
    this.pipeline = pipeline;
    this.provider = provider;
    this.capture = capture;

    provider.on('update', (u: TranscriptUpdate) => { this.subtitles.apply(u); this.emit('update', u); });
    provider.on('busy', () => { if (this.state.state === 'capturing') this.refreshIndicator(); });
    provider.on('log', (l: string) => this.emit('log', l));
    provider.on('error', (m: string) => this.emit('log', `[whisper] error: ${m}`));
    provider.on('fatal', (m: string) => void this.fail(`Transcription failed: ${m}`));
    pipeline.on('samples', (s: Float32Array, i: number) => { provider.pushAudio(s, i); this.meter(s); });
    capture.on('format', (f: CaptureFormat) => { pipeline.setFormat(f.sampleRate, f.channels); this.emit('log', `[capture] format ${JSON.stringify(f)}`); });
    capture.on('audio', (x: Float32Array, ns: bigint) => { if (this.pipeline === pipeline) pipeline.push(x, ns); });
    capture.on('log', (l: string) => this.emit('log', l));
    capture.on('status', (s: CaptureStatus) => this.onCaptureStatus(s));
    capture.on('fatal', (m: string) => void this.fail(m === 'permission-denied' ? 'permission-denied' : `Audio capture failed: ${m}`));

    try {
      await provider.start(); // loads the model once (Metal), warms up
      if (this.state.state !== 'starting') return; // stopped while loading
      capture.start();
      this.state.to('capturing');
      this.emit('session', 'started');
      this.emit('log', `[captions] started (model ${this.model}, metal=${provider.metalInitialized})`);
    } catch (e) {
      await this.fail((e as Error).message);
    }
  }

  private onCaptureStatus(s: CaptureStatus): void {
    if (s.event === 'level') return;
    if (s.event === 'sources') { this.sources = s.apps; this.sourceDetails = s.details ?? []; this.emit('sources', s.apps); return; }
    this.emit('log', `[capture] ${JSON.stringify(s)}`);
    if (s.event === 'silent-since-start' && s.permission !== 'authorized') {
      // The tap delivers digital silence when the TCC permission is missing.
      this.silent = true;
      this.setIndicator('permission', 'No audio received — grant “System Audio Recording” permission');
      return;
    }
    if (s.event === 'silent' || s.event === 'silent-since-start') this.silent = true;
    if (s.event === 'audio-resumed' || s.event === 'started' || s.event === 'device-changed') this.silent = false;
    if (this.state.state === 'capturing') this.refreshIndicator();
  }

  private async fail(msg: string): Promise<void> {
    await this.teardown();
    if (this.state.state === 'starting' || this.state.state === 'capturing' || this.state.state === 'stopping') this.state.to('error', msg);
  }

  async stop(): Promise<void> {
    if (this.state.state === 'error') { this.state.to('idle'); return; }
    if (!this.state.can('stopping')) return;
    this.state.to('stopping');
    await this.teardown();
    this.state.to('idle');
  }

  /** RMS level for the UI meter (cheap: one pass over samples already in memory). */
  private meter(x: Float32Array): void {
    for (let i = 0; i < x.length; i++) this.levelAcc += x[i]! * x[i]!;
    this.levelN += x.length;
    const now = Date.now();
    if (now - this.levelLast < 66 || this.levelN === 0) return;
    const rms = Math.sqrt(this.levelAcc / this.levelN);
    this.levelAcc = 0; this.levelN = 0; this.levelLast = now;
    this.emit('level', rms > 0 ? Math.max(-90, 20 * Math.log10(rms)) : -90);
  }

  private async teardown(): Promise<void> {
    const wasRunning = this.capture !== null;
    if (wasRunning) this.emit('session', 'ended');
    this.sources = [];
    this.sourceDetails = [];
    const c = this.capture, p = this.provider;
    this.capture = null;
    this.provider = null;
    this.pipeline = null;
    await Promise.all([c?.stop(), p?.stop()]);
  }

  /** Switch model without restarting the app (restarts the worker only). */
  async setModel(m: ModelId): Promise<void> {
    if (m === this.model) return;
    this.model = m;
    if (this.state.state === 'capturing' || this.state.state === 'starting') {
      await this.stop();
      await this.start();
    }
  }

  setLayout(o: { maxLines?: number; maxCharsPerLine?: number }): void {
    this.subtitles.setOptions(o);
  }
}
