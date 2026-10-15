// Headless harness: system audio (audiotap) -> pipeline -> VAD -> whisper -> subtitles.
// Used for the Phase 2 gate and benchmarks. Same modules as the Electron app.
// Usage: node dist/cli/transcribe.js --model base.en --seconds 30 --out run.json
//        --wav file.wav       feed a file at real-time pace instead of capturing (nothing is played)
//        --speakers <dir>     mark speaker changes with speaker-worker (the speaker model folder)
import { readFileSync, writeFileSync } from 'node:fs';
import { wer } from '../shared/wer';
import { TURN_TEXT } from '../main/asr/localAgreement';
import { SpeakerAttributor, type SpeakerSpan } from '../main/speakers/SpeakerAttributor';
import { SpeakerWorkerClient } from '../main/speakers/SpeakerWorkerClient';
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
const wavFile = arg('wav', '');
const speakerDir = arg('speakers', '');

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
const subs = new SubtitleManager({ maxCharsPerLine: 60, maxLines: wavFile ? 500 : 3 }); // a file run keeps every line for the summary
const speakers = speakerDir ? new SpeakerWorkerClient(path.join(binDir(), 'speaker-worker'), speakerDir) : null;
const attributor = speakers ? new SpeakerAttributor() : null;
const speakerSpans: SpeakerSpan[] = [];

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
pipeline.on('samples', (s: Float32Array, i: number) => { provider.pushAudio(s, i); speakers?.push(s, i); });
speakers?.on('log', (l: string) => console.error(l));
speakers?.on('ready', () => { attributor!.live = true; });
speakers?.on('spans', (sp: SpeakerSpan[]) => { speakerSpans.push(...sp); onUpdate(attributor!.addSpans(sp)); });
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

provider.on('update', (u: TranscriptUpdate) => onUpdate(attributor ? attributor.apply(u) : u));

function onUpdate(u: TranscriptUpdate | null): void {
  if (!u) return;
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
}

/** 16-bit PCM or 32-bit float WAV -> interleaved samples. */
function readWav(file: string): { rate: number; channels: number; x: Float32Array } {
  const b = readFileSync(file);
  let off = 12, rate = 0, channels = 0, bits = 0, data: Buffer | null = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { channels = b.readUInt16LE(off + 10); rate = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22); }
    if (id === 'data') data = b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size & 1);
  }
  if (!data || !rate || (bits !== 16 && bits !== 32)) throw new Error(`unsupported WAV: ${file}`);
  const n = data.length / (bits / 8);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = bits === 16 ? data.readInt16LE(i * 2) / 32768 : data.readFloatLE(i * 4);
  return { rate, channels, x };
}

/** Push a file through the pipeline in 10 ms pieces at real-time pace, then 3 s of silence. */
async function feedWav(file: string): Promise<void> {
  const { rate, channels, x } = readWav(file);
  pipeline.setFormat(rate, channels);
  const step = Math.round(rate / 100) * channels;
  const all = new Float32Array(x.length + 3 * rate * channels);
  all.set(x);
  const start = Date.now();
  for (let i = 0, k = 0; i < all.length; i += step, k++) {
    const wait = start + k * 10 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    pipeline.push(all.subarray(i, i + step), process.hrtime.bigint());
  }
}

const pct = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!; };

async function main() {
  if (speakers) {
    speakers.start();
    await new Promise<void>((r) => { speakers.once('ready', () => r()); speakers.once('down', () => r()); });
  }
  await provider.start();
  if (wavFile) {
    console.error(`[cli] whisper ready (model ${model}, metal=${provider.metalInitialized}); feeding ${wavFile}`);
    await feedWav(wavFile);
  } else {
    console.error(`[cli] whisper ready (model ${model}, metal=${provider.metalInitialized}); capturing ${seconds}s`);
    capture.start();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    await capture.stop();
  }
  // let the last inference land
  await new Promise((r) => setTimeout(r, 2500));
  onUpdate(attributor?.flush() ?? null);
  await Promise.all([provider.stop(), speakers?.stop()]);
  const summary = {
    model, seconds, stepMs, usePrompt,
    metal: provider.metalInitialized,
    transcript: confirmedWords.filter((w) => w.text !== TURN_TEXT.trim()).map((w) => w.text).join(' '),
    wer: ref ? wer(readFileSync(ref, 'utf8'), confirmedWords.filter((w) => w.text !== TURN_TEXT.trim()).map((w) => w.text).join(' ')) : undefined,
    speakerTurns: confirmedWords.filter((w) => w.text === TURN_TEXT.trim()).length,
    lines: subs.view().lines.map((l) => l.committed),
    confirmedLatencyMs: { p50: pct(wordLatency, 50), p95: pct(wordLatency, 95), n: wordLatency.length },
    firstSeenLatencyMs: { p50: pct(firstSeenLatency, 50), p95: pct(firstSeenLatency, 95), n: firstSeenLatency.length },
    inferMs: { p50: pct(provider.stats.inferMs, 50), p95: pct(provider.stats.inferMs, 95), n: provider.stats.inferMs.length },
    captureToMainMs: { p50: pct(clockSkew, 50), p95: pct(clockSkew, 95) },
    stats: { ...provider.stats, inferMs: undefined, vadMaxInflight: provider.vad.maxInflight },
    words: confirmedWords,
    speakerSpans: speakerSpans.filter((sp) => sp.speaker >= 0).map((sp) => ({ speaker: sp.speaker, startS: sp.start / 16000, endS: sp.end / 16000, overlap: sp.overlap })),
    events,
  };
  console.error(JSON.stringify({ ...summary, words: undefined, events: undefined }, null, 1));
  if (out) writeFileSync(out, JSON.stringify(summary, null, 1));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
