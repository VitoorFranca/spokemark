// Speech recognition engines (no Node imports: used by renderers too).
import type { StringKey } from './i18n';
import type { EngineId } from './settings';

export const PARAKEET_BYTES = 625_837_419;

export const ENGINES: Record<EngineId, { label: StringKey; body: StringKey }> = {
  whisper: { label: 'engine.whisper', body: 'engine.whisperBody' },
  apple: { label: 'engine.apple', body: 'engine.appleBody' },
  parakeet: { label: 'engine.parakeet', body: 'engine.parakeetBody' },
};
