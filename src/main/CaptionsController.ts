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
    pipeline.on('samples', (s: Float32Array, i: number) => provider.pushAudio(s, i));
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
      this.emit('log', `[captions] started (model ${this.model}, metal=${provider.metalInitialized})`);
    } catch (e) {
      await this.fail((e as Error).message);
    }
  }

  private onCaptureStatus(s: CaptureStatus): void {
    if (s.event === 'level') return;
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

  private async teardown(): Promise<void> {
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
