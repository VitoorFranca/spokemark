import { existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { APP_NAME, LEGACY_DATA_DIR_NAMES } from '../shared/brand';

export { APP_NAME };

export function dataDir(): string {
  return process.env.LC_DATA_DIR ?? path.join(homedir(), 'Library', 'Application Support', APP_NAME);
}

/** One-time move of an earlier build's data folder (models, settings, history) to the current name. */
export function migrateLegacyDataDir(): boolean {
  if (process.env.LC_DATA_DIR) return false;
  const target = dataDir();
  if (existsSync(target)) return false;
  for (const name of LEGACY_DATA_DIR_NAMES) {
    const legacy = path.join(homedir(), 'Library', 'Application Support', name);
    if (legacy !== target && existsSync(legacy)) { renameSync(legacy, target); return true; } // same volume: instant
  }
  return false;
}

export const MODELS = {
  'base.en': 'ggml-base.en.bin',
  'base.en-q5_1': 'ggml-base.en-q5_1.bin',
  'small.en': 'ggml-small.en.bin',
  'small.en-q5_1': 'ggml-small.en-q5_1.bin',
  'small.en-tdrz': 'ggml-small.en-tdrz.bin', // tinydiarize: marks speaker changes
} as const;
export type ModelId = keyof typeof MODELS;
export const VAD_MODEL_FILE = 'ggml-silero-v6.2.0.bin';

export function modelsDir(): string {
  return process.env.LC_MODELS_DIR ?? path.join(dataDir(), 'models');
}

export function modelPath(id: ModelId): string {
  return path.join(modelsDir(), MODELS[id]);
}

export function vadModelPath(): string {
  return path.join(modelsDir(), VAD_MODEL_FILE);
}

export function availableModels(): ModelId[] {
  return (Object.keys(MODELS) as ModelId[]).filter((m) => existsSync(modelPath(m)));
}

/** Native helpers: packaged app -> Contents/Resources/bin, dev -> <repo>/build/bin. */
export function binDir(): string {
  if (process.env.LC_BIN_DIR) return process.env.LC_BIN_DIR;
  const rp = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (rp && existsSync(path.join(rp, 'bin', 'audiotap'))) return path.join(rp, 'bin');
  // dist/main/main.js -> repo root
  return path.resolve(__dirname, '..', '..', 'build', 'bin');
}
