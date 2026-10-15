// Headless harness: system audio (audiotap) -> pipeline -> VAD -> whisper -> subtitles.
// Used for the Phase 2 gate and benchmarks. Same modules as the Electron app.
// Usage: node dist/cli/transcribe.js --model base.en --seconds 30 --out run.json
import { readFileSync, writeFileSync } from 'node:fs';
import { wer } from '../shared/wer';
import { TURN_TEXT } from '../main/asr/localAgreement';
import path from 'node:path';
import { AudioCaptureService, type CaptureFormat, type CaptureStatus } from '../main/audio/AudioCaptureService';
import { AudioProcessingPipeline } from '../main/audio/AudioProcessingPipeline';
import type { TranscriptUpdate } from '../main/asr/TranscriptionProvider';
import { DEFAULT_WHISPER_OPTIONS, WhisperProvider } from '../main/asr/WhisperProvider';
import { binDir, modelPath, vadModelPath, type ModelId } from '../main/paths';
import { SubtitleManager } from '../main/subtitles/SubtitleManager';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1]! : d; };
const model = arg('model', 'base.en') as ModelId;
const seconds = Number(arg('seconds', '30'));
const out = arg('out', '');
const stepMs = Number(arg('step', String(DEFAULT_WHISPER_OPTIONS.stepMs)));
const usePrompt = arg('prompt', '0') === '1';
const ref = arg('ref', '');

const t0 = process.hrtime.bigint();
const ms = (ns: bigint) => Number(ns - t0) / 1e6;

const capture = new AudioCaptureService(path.join(binDir(), 'audiotap'));
const pipeline = new AudioProcessingPipeline(60);
const provider = new WhisperProvider(pipeline.ring, {
  ...DEFAULT_WHISPER_OPTIONS,
  stepMs,
  usePrompt,
  turnContextS: Number(arg('turnctx', model.endsWith('-tdrz') ? '3' : '0')),
  tdrz: arg('tdrz', model.endsWith('-tdrz') ? '1' : '0') === '1',
  binPath: path.join(binDir(), 'whisper-worker'),
  modelPath: modelPath(model),
  vadModelPath: vadModelPath(),
});
const subs = new SubtitleManager({ maxCharsPerLine: 60, maxLines: 3 });

const events: unknown[] = [];
const confirmedWords: { p: number; text: string; startS: number; endS: number; latencyMs: number | null; atMs: number }[] = [];
const wordLatency: number[] = [];
const firstSeenLatency: number[] = [];
const clockSkew: number[] = [];

capture.on('format', (f: CaptureFormat) => { pipeline.setFormat(f.sampleRate, f.channels); console.error(`[cli] format ${JSON.stringify(f)}`); });
capture.on('audio', (x: Float32Array, ns: bigint) => {
  clockSkew.push(Number(process.hrtime.bigint() - ns) / 1e6);
  if (clockSkew.length > 1000) clockSkew.shift();
  pipeline.push(x, ns);
});
capture.on('status', (s: CaptureStatus) => { if (s.event !== 'level') { console.error(`[cli] capture ${JSON.stringify(s)}`); events.push({ atMs: ms(process.hrtime.bigint()), capture: s }); } });
capture.on('log', (l: string) => process.env.LC_VERBOSE && console.error(l));
capture.on('fatal', (m: string) => { console.error(`[cli] capture fatal: ${m}`); process.exit(3); });
pipeline.on('samples', (s: Float32Array, i: number) => provider.pushAudio(s, i));
provider.on('log', (l: string) => { if (process.env.LC_VERBOSE || /metal|error|fail/i.test(l)) console.error(l); });
provider.vad.on('speech-start', (i: number) => events.push({ atMs: ms(process.hrtime.bigint()), vad: 'start', t: i / 16000 }));
provider.vad.on('speech-end', (i: number) => events.push({ atMs: ms(process.hrtime.bigint()), vad: 'end', t: i / 16000 }));

subs.on('change', (_v, newWords: { end: number }[]) => {
  const now = process.hrtime.bigint();
  for (const w of newWords) {
    const c = pipeline.captureTimeOf(w.end);
    if (c !== null) firstSeenLatency.push(Number(now - c) / 1e6);
  }
});

provider.on('update', (u: TranscriptUpdate) => {
  subs.apply(u);
  const now = process.hrtime.bigint();
  for (const w of u.confirmed) {
    const c = pipeline.captureTimeOf(w.end);
    const lat = c !== null ? Number(now - c) / 1e6 : null;
    if (lat !== null && w.text !== TURN_TEXT) wordLatency.push(lat);
    confirmedWords.push({ p: Number(w.p.toFixed(2)), text: w.text.trim(), startS: w.start / 16000, endS: w.end / 16000, latencyMs: lat, atMs: ms(now) });
  }
  const conf = u.confirmed.map((w) => w.text).join('').trim();
  const prov = u.provisional.map((w) => w.text).join('').trim();
  console.log(`${(ms(now) / 1000).toFixed(1).padStart(6)}s infer=${u.inferMs.toFixed(0)}ms ${u.utteranceEnd ? 'END ' : ''}| ${conf} \x1b[2m${prov}\x1b[0m`);
});

const pct = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!; };

async function main() {
  await provider.start();
  console.error(`[cli] whisper ready (model ${model}, metal=${provider.metalInitialized}); capturing ${seconds}s`);
  capture.start();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  await capture.stop();
  // let the last inference land
  await new Promise((r) => setTimeout(r, 2500));
  await provider.stop();
  const summary = {
    model, seconds, stepMs, usePrompt,
    metal: provider.metalInitialized,
    transcript: confirmedWords.filter((w) => w.text !== TURN_TEXT.trim()).map((w) => w.text).join(' '),
    wer: ref ? wer(readFileSync(ref, 'utf8'), confirmedWords.filter((w) => w.text !== TURN_TEXT.trim()).map((w) => w.text).join(' ')) : undefined,
    speakerTurns: confirmedWords.filter((w) => w.text === TURN_TEXT.trim()).length,
    confirmedLatencyMs: { p50: pct(wordLatency, 50), p95: pct(wordLatency, 95), n: wordLatency.length },
    firstSeenLatencyMs: { p50: pct(firstSeenLatency, 50), p95: pct(firstSeenLatency, 95), n: firstSeenLatency.length },
    inferMs: { p50: pct(provider.stats.inferMs, 50), p95: pct(provider.stats.inferMs, 95), n: provider.stats.inferMs.length },
    captureToMainMs: { p50: pct(clockSkew, 50), p95: pct(clockSkew, 95) },
    stats: { ...provider.stats, inferMs: undefined, vadMaxInflight: provider.vad.maxInflight },
    words: confirmedWords,
    events,
  };
  console.error(JSON.stringify({ ...summary, words: undefined, events: undefined }, null, 1));
  if (out) writeFileSync(out, JSON.stringify(summary, null, 1));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
