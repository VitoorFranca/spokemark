import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ModelIdT } from '../../shared/settings';
import { MODELS, modelsDir, VAD_MODEL_FILE } from '../paths';

interface CatalogEntry { file: string; url: string; sha256: string; bytes: number }

const WHISPER_REV = '5359861c739e955e79d9a303bcbc70fb988958b1';
const VAD_REV = '9ffd54a1e1ee413ddf265af9913beaf518d1639b';
const TDRZ_REV = 'd44ba793fc67e509623a88a409723311fa677744';
const NEMOTRON_REV = '25a90f97f254428d4b30374b76af9c74fdee8327'; // FluidInference/nemotron-3-diarization-coreml, weights ga-2026-09-23
const hf = (repo: string, rev: string, file: string) => `https://huggingface.co/${repo}/resolve/${rev}/${file}`;

/** Same pinned revisions + SHA-256 as scripts/download-models.sh. */
export const CATALOG: Record<ModelIdT | 'vad', CatalogEntry> = {
  'base.en': { file: MODELS['base.en'], url: hf('ggerganov/whisper.cpp', WHISPER_REV, MODELS['base.en']), sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', bytes: 147964211 },
  'base.en-q5_1': { file: MODELS['base.en-q5_1'], url: hf('ggerganov/whisper.cpp', WHISPER_REV, MODELS['base.en-q5_1']), sha256: '4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f', bytes: 59721011 },
  'small.en': { file: MODELS['small.en'], url: hf('ggerganov/whisper.cpp', WHISPER_REV, MODELS['small.en']), sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d', bytes: 487614201 },
  'small.en-q5_1': { file: MODELS['small.en-q5_1'], url: hf('ggerganov/whisper.cpp', WHISPER_REV, MODELS['small.en-q5_1']), sha256: 'bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30', bytes: 190098681 },
  'small.en-tdrz': { file: MODELS['small.en-tdrz'], url: hf('akashmjn/tinydiarize-whisper.cpp', TDRZ_REV, MODELS['small.en-tdrz']), sha256: 'ceac3ec06d1d98ef71aec665283564631055fd6129b79d8e1be4f9cc33cc54b4', bytes: 487614184 },
  vad: { file: VAD_MODEL_FILE, url: hf('ggml-org/whisper-vad', VAD_REV, VAD_MODEL_FILE), sha256: '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987', bytes: 885098 },
};

/** Folder (inside modelsDir) of the speaker-change model: what speaker-worker gets as --model-dir. */
export const SPEAKER_MODEL_DIR = 'speakers-nemotron3-low';
const nemotron = (file: string, sha256: string, bytes: number, from = `monolithic/v2/${file}`): CatalogEntry =>
  ({ file: path.join(SPEAKER_MODEL_DIR, file), url: hf('FluidInference/nemotron-3-diarization-coreml', NEMOTRON_REV, from), sha256, bytes });
/** NVIDIA Nemotron 3 Diarization, `low` streaming preset, compiled for CoreML (OpenMDW 1.1). Same pins as scripts/download-models.sh. */
export const SPEAKER_FILES: CatalogEntry[] = [
  nemotron('learnable_sil_emb.bin', 'd4417b3c0eabdf7c47032fac2b5b5a7ee83d819a6ddda8fd8eaf74e2b5cc4ac7', 2048, 'learnable_sil_emb.bin'),
  nemotron('Nemotron3Diarizer_low.mlmodelc/coremldata.bin', '2c2c82efc948433cb47b60aceb4917182e2e00d1d79097b8898adfd615b0c5f8', 752),
  nemotron('Nemotron3Diarizer_low.mlmodelc/analytics/coremldata.bin', '1ec46d7392b470ebfaac473123de9e5bc62630972b01349b929bf6e48e067c6c', 243),
  nemotron('Nemotron3Diarizer_low.mlmodelc/model.mil', '8e2ffc4ce5edf86b8a1845e5229a219ca9e8cc0e03aa4a6e7317e81cb7da2da5', 503842),
  nemotron('Nemotron3Diarizer_low.mlmodelc/weights/weight.bin', '88307e2c51d1877de59803299354f689e70cad7f8892a197764d5f3626089495', 198617472),
];

/** Folder of the Parakeet engine model: what parakeet-worker gets as --model-dir. */
export const PARAKEET_MODEL_DIR = 'parakeet-nemotron-560ms';
const PARAKEET_REV = 'e673531caa6d25ab7baf5a8c14c9b99ba1551838'; // FluidInference/nemotron-speech-streaming-en-0.6b-coreml
const parakeet = (file: string, sha256: string, bytes: number): CatalogEntry =>
  ({ file: path.join(PARAKEET_MODEL_DIR, file), url: hf('FluidInference/nemotron-speech-streaming-en-0.6b-coreml', PARAKEET_REV, `nemotron_coreml_560ms/${file}`), sha256, bytes });
/**
 * NVIDIA Nemotron Speech Streaming 0.6B (a Parakeet FastConformer-RNNT, English), 560 ms chunks,
 * CoreML with an int8 encoder (NVIDIA Open Model License). The CoreML preprocessor is not
 * needed (FluidAudio computes the mel features in Swift). Same pins as scripts/download-models.sh.
 */
export const PARAKEET_FILES: CatalogEntry[] = ([
  ['decoder.mlmodelc/analytics/coremldata.bin', 'bca0e343fa0d698de8bdb22c66fd377b79104f606b1bfffc90931fe2161029b8', 243],
  ['decoder.mlmodelc/coremldata.bin', '4d0549ac72a38abdcbe7927f2b7d488386d6b96f1f5e837d93ba9e379de04f4e', 493],
  ['decoder.mlmodelc/model.mil', '8298f16d3926565b77732b549fa9c64fedebb2e5a29a76e33d0b2e970e93ae69', 13093],
  ['decoder.mlmodelc/weights/weight.bin', 'd9758e49f9b2b9a0462c933256663d4174209739e62f0ddc14e4147bc50e7818', 14429952],
  ['decoder_joint.mlmodelc/analytics/coremldata.bin', 'd46ecf790a728d91b8962ec62e597980e288e66c775e45429bf734b54c658ffc', 243],
  ['decoder_joint.mlmodelc/coremldata.bin', 'd9a7f7cfece967a69dca59b3fc3cc7d1ecff93ad2815ac3ba6b47e057db22172', 514],
  ['decoder_joint.mlmodelc/model.mil', '517bb31cf87eb8aa80adaa8c3fee2df0fd7d7dd0c8791e615c5023886c39d572', 17146],
  ['decoder_joint.mlmodelc/weights/weight.bin', '96cac67a1352e45a2418284779dbd5efe5865159b7b92f328247e5ed31485f52', 17876866],
  ['encoder/encoder_int8.mlmodelc/analytics/coremldata.bin', 'ef51dbab5c6ce310ce1a537538a4df6b88f13ad5c45c0acaddca055503896daa', 243],
  ['encoder/encoder_int8.mlmodelc/coremldata.bin', '864a357ae2eb7d6b38ced73d5f23c908096a256516afa498c6730778767ec404', 608],
  ['encoder/encoder_int8.mlmodelc/model.mil', '4b903ee4f401d81add07d1252192a486bd07154174818902f03bca38b2f293f6', 968920],
  ['encoder/encoder_int8.mlmodelc/weights/weight.bin', '8ced31411f7903eaec52de85e94c7847228f3e44028d8f0040800e5603943a40', 589057600],
  ['joint.mlmodelc/analytics/coremldata.bin', '478804308534c7f9cab1030aa9ce19ddf672fcd15deba633fe3ed5da8f53b103', 243],
  ['joint.mlmodelc/coremldata.bin', '46363626fd89730ade6e6461e8be808c7fade198fb0df63db83fb00ed033abb2', 401],
  ['joint.mlmodelc/model.mil', '73bcc51b58ff73c7620e31a2c32dc5ef4939e8ec2a77ec22242303422bfafba4', 5064],
  ['joint.mlmodelc/weights/weight.bin', 'd1d45514a91da39f24e264712a9f8b5a2a90e9cbce04bad3f3f74242bea106d5', 3446978],
  ['metadata.json', 'e8d93e5afa1e5c87257f6e31a5c336058eeba7d6cacd36ba80fbf9758c3916dc', 438],
  ['tokenizer.json', 'a87b5b8a0e0a989fa7db3121f279ce6af70e337feb55ab553b8d0658db70b9d3', 18374],
] as const).map(([f, h, n]) => parakeet(f, h, n));

/** Multi-file models downloaded as a unit (a folder each). */
export const PACKS = {
  speakers: { dir: SPEAKER_MODEL_DIR, files: SPEAKER_FILES },
  parakeet: { dir: PARAKEET_MODEL_DIR, files: PARAKEET_FILES },
} as const;
export type PackId = keyof typeof PACKS;
export const packBytes = (id: PackId): number => PACKS[id].files.reduce((n: number, f: CatalogEntry) => n + f.bytes, 0);
export const SPEAKER_MODEL_BYTES = packBytes('speakers');

export interface DownloadProgress { id: ModelIdT; received: number; total: number; bytesPerSec: number; phase: 'downloading' | 'verifying' }
export type ModelStatus = { id: ModelIdT; installed: boolean; bytes: number; download: DownloadProgress | null; error: string | null };
export type PackStatus = { installed: boolean; bytes: number; download: Omit<DownloadProgress, 'id'> | null; error: string | null };
export type SpeakerModelStatus = PackStatus;

/**
 * Downloads/removes models with progress, speed, cancellation and SHA-256
 * verification. Events: 'change'() whenever any status changes.
 */
export class ModelManager extends EventEmitter {
  private active = new Map<ModelIdT, { abort: AbortController; progress: DownloadProgress }>();
  private errors = new Map<ModelIdT, string>();
  private packJobs = new Map<PackId, { abort: AbortController; progress: Omit<DownloadProgress, 'id'> }>();
  private packErrors = new Map<PackId, string>();

  isInstalled(id: ModelIdT | 'vad'): boolean {
    return present(CATALOG[id]);
  }

  packInstalled(id: PackId): boolean {
    return PACKS[id].files.every(present);
  }

  packDir(id: PackId): string {
    return path.join(modelsDir(), PACKS[id].dir);
  }

  packStatus(id: PackId): PackStatus {
    return { installed: this.packInstalled(id), bytes: packBytes(id), download: this.packJobs.get(id)?.progress ?? null, error: this.packErrors.get(id) ?? null };
  }

  async downloadPack(id: PackId): Promise<boolean> {
    if (this.packJobs.has(id)) return false;
    const abort = new AbortController();
    const progress: Omit<DownloadProgress, 'id'> = { received: 0, total: packBytes(id), bytesPerSec: 0, phase: 'downloading' };
    this.packJobs.set(id, { abort, progress });
    this.packErrors.delete(id);
    this.emit('change');
    try {
      let base = 0;
      for (const f of PACKS[id].files) {
        if (!present(f)) await this.fetchOne(f, abort.signal, (n, bps, phase) => { progress.received = base + n; progress.bytesPerSec = bps; progress.phase = phase; });
        base += f.bytes;
      }
      return true;
    } catch (e) {
      if (!abort.signal.aborted) this.packErrors.set(id, (e as Error).message);
      return false;
    } finally {
      this.packJobs.delete(id);
      this.emit('change');
    }
  }

  cancelPack(id: PackId): void {
    this.packJobs.get(id)?.abort.abort();
  }

  removePack(id: PackId): void {
    rmSync(this.packDir(id), { recursive: true, force: true });
    this.emit('change');
  }

  /** The speaker-change model (all of its files). */
  get speakerModelInstalled(): boolean {
    return this.packInstalled('speakers');
  }

  speakerStatus(): SpeakerModelStatus {
    return this.packStatus('speakers');
  }

  downloadSpeakerModel(): Promise<boolean> {
    return this.downloadPack('speakers');
  }

  cancelSpeakerModel(): void {
    this.cancelPack('speakers');
  }

  removeSpeakerModel(): void {
    this.removePack('speakers');
  }

  /** A model is usable only together with the VAD model. */
  isReady(id: ModelIdT): boolean {
    return this.isInstalled(id) && this.isInstalled('vad');
  }

  status(): ModelStatus[] {
    return (Object.keys(MODELS) as ModelIdT[]).map((id) => ({
      id,
      installed: this.isInstalled(id),
      bytes: CATALOG[id].bytes,
      download: this.active.get(id)?.progress ?? null,
      error: this.errors.get(id) ?? null,
    }));
  }

  async download(id: ModelIdT): Promise<boolean> {
    if (this.active.has(id)) return false;
    const abort = new AbortController();
    const progress: DownloadProgress = { id, received: 0, total: CATALOG[id].bytes + (this.isInstalled('vad') ? 0 : CATALOG.vad.bytes), bytesPerSec: 0, phase: 'downloading' };
    this.active.set(id, { abort, progress });
    this.errors.delete(id);
    this.emit('change');
    try {
      let base = 0;
      if (!this.isInstalled('vad')) { await this.fetchOne(CATALOG.vad, abort.signal, (n) => { progress.received = n; }); base = CATALOG.vad.bytes; }
      await this.fetchOne(CATALOG[id], abort.signal, (n, bps, phase) => { progress.received = base + n; progress.bytesPerSec = bps; progress.phase = phase; });
      return true;
    } catch (e) {
      if (!abort.signal.aborted) this.errors.set(id, (e as Error).message);
      return false;
    } finally {
      this.active.delete(id);
      this.emit('change');
    }
  }

  cancel(id: ModelIdT): void {
    this.active.get(id)?.abort.abort();
  }

  remove(id: ModelIdT): void {
    rmSync(path.join(modelsDir(), CATALOG[id].file), { force: true });
    this.emit('change');
  }

  private async fetchOne(e: CatalogEntry, signal: AbortSignal, onProgress: (received: number, bps: number, phase: DownloadProgress['phase']) => void): Promise<void> {
    const final = path.join(modelsDir(), e.file);
    mkdirSync(path.dirname(final), { recursive: true });
    const part = `${final}.part`;
    const res = await fetch(e.url, { signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const hash = createHash('sha256');
    const out = createWriteStream(part);
    let received = 0, lastEmit = 0, windowBytes = 0, windowStart = Date.now(), bps = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.length;
        windowBytes += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        const now = Date.now();
        if (now - windowStart >= 1000) { bps = (windowBytes * 1000) / (now - windowStart); windowBytes = 0; windowStart = now; }
        if (now - lastEmit > 200) { lastEmit = now; onProgress(received, bps, 'downloading'); this.emit('change'); }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      onProgress(received, bps, 'verifying');
      this.emit('change');
      const got = hash.digest('hex');
      if (got !== e.sha256) throw new Error('checksum mismatch');
      renameSync(part, final);
    } catch (err) {
      out.destroy();
      rmSync(part, { force: true });
      throw err;
    }
  }
}

function present(e: CatalogEntry): boolean {
  const p = path.join(modelsDir(), e.file);
  return existsSync(p) && statSync(p).size === e.bytes;
}
