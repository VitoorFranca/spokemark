import type { EventEmitter } from 'node:events';
import type { Word } from './localAgreement';

export interface TranscriptUpdate {
  /** Newly confirmed words (immutable from now on). */
  confirmed: Word[];
  /** Current provisional tail (replaces the previous one). */
  provisional: Word[];
  /** Absolute 16 kHz index of the newest sample used for this update. */
  windowEnd: number;
  inferMs: number;
  /** process.hrtime.bigint() when the inference result arrived. */
  resultNs: bigint;
  /** true when the utterance ended (pause) and everything was committed. */
  utteranceEnd: boolean;
}

/**
 * Speech-to-text engine abstraction. Events:
 *  'update'(TranscriptUpdate) — partial (provisional) + confirmed segments
 *  'ready'() 'busy'(boolean) 'error'(message) 'fatal'(message) 'log'(line)
 */
export interface TranscriptionProvider extends EventEmitter {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** 16 kHz mono samples, contiguous; startIndex = absolute index of samples[0]. */
  pushAudio(samples: Float32Array, startIndex: number): void;
  readonly pids: number[];
}
