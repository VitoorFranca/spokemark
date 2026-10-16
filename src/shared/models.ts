// Model metadata for the UI (no Node imports: used by renderers too).
// speed: median inference on a 10 s window, M4 + Metal, measured offline on 2026-10-11
//        (base.en-q5_1 149 ms, base.en 159 ms, small.en-q5_1 388 ms, small.en 430 ms).
// accuracy: relative ordering by model size (Whisper paper); our own clean-speech
//           tests did not separate them, so no WER number is shown.
import type { ModelIdT } from './settings';
import type { StringKey } from './i18n';

export const VAD_BYTES = 885_098; // Silero VAD, downloaded together with the first model

/** turns: the model can mark speaker changes by itself (tinydiarize). Superseded by the speaker model, which works with every model. */
export const MODELS: Record<ModelIdT, { label: StringKey; bytes: number; speed: StringKey; accuracy: StringKey; turns?: boolean }> = {
  'base.en': { label: 'modelName.base', bytes: 147_964_211, speed: 'rating.fastest', accuracy: 'rating.good' },
  'base.en-q5_1': { label: 'modelName.baseCompact', bytes: 59_721_011, speed: 'rating.fastest', accuracy: 'rating.good' },
  'small.en': { label: 'modelName.small', bytes: 487_614_201, speed: 'rating.moderate', accuracy: 'rating.better' },
  'small.en-q5_1': { label: 'modelName.smallCompact', bytes: 190_098_681, speed: 'rating.moderate', accuracy: 'rating.better' },
  'small.en-tdrz': { label: 'modelName.smallTurns', bytes: 487_614_184, speed: 'rating.moderate', accuracy: 'rating.better', turns: true },
};

/** Translation lines under the original in "both" mode: one per speaker when speaker changes are active. */
export const translationLineCount = (maxLines: number, speakerTurns: boolean): number => (speakerTurns ? maxLines : maxLines === 3 ? 2 : 1);

/** Speaker changes are on and can be produced: with the speaker model (any recognition model) or a model that marks them itself. */
export const speakerChangesActive = (s: { speakerChanges: boolean; model: ModelIdT; engine?: string }, speakerModel: boolean): boolean =>
  s.speakerChanges && (speakerModel || ((s.engine ?? 'whisper') === 'whisper' && !!MODELS[s.model].turns));
