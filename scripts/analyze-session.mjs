// Summarizes an e2e-session.sh run: per-minute CPU/memory/latency, WER per
// played file, and words confirmed during long silences (hallucinations).
// Usage: node scripts/analyze-session.mjs <outdir> <fixturesDir>
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [dir, fixtures = 'tests/e2e/fixtures'] = process.argv.slice(2);
const jsonl = (f) => readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const metrics = jsonl('metrics.jsonl');
const transcript = jsonl('transcript.jsonl');
const plays = jsonl('playlog.jsonl');

// Whisper writes numbers as digits; the references spell them out.
const NUMBERS = { '200': 'two hundred' };
const norm = (s) => s.toLowerCase().replace(/\b\d+\b/g, (n) => NUMBERS[n] ?? n).replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
function wer(ref, hyp) {
  const r = norm(ref), h = norm(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => Array.from({ length: h.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
  return { errors: d[r.length][h.length], n: r.length };
}
const refText = (file) => readFileSync(path.join(fixtures, file.replace(/\.(aiff|wav)$/, '.txt')), 'utf8');

// Assign confirmed words to the file playing (until 4 s after it ended).
const MARGIN = 4000;
const perFile = {};
const hallucinations = [];
for (let k = 0; k < plays.length; k++) {
  const p = plays[k];
  if (p.file) {
    // attribution window: from this file's start until the next file starts (max MARGIN after its end)
    const nextFile = plays.slice(k + 1).find((x) => x.file);
    const until = Math.min(p.end + MARGIN, nextFile ? nextFile.start : Infinity);
    const words = transcript.filter((t) => t.t > p.start && t.t <= until).flatMap((t) => t.words).join(' ');
    if (process.env.SHOW) console.log(p.file, '|', words);
    const w = wer(refText(p.file), words);
    (perFile[p.file] ??= { errors: 0, n: 0, plays: 0 }).errors += w.errors;
    perFile[p.file].n += w.n;
    perFile[p.file].plays++;
  } else if (p.gap >= 10) {
    const ws = transcript.filter((t) => t.t > p.start + MARGIN && t.t <= p.end).flatMap((t) => t.words);
    if (ws.length) hallucinations.push({ gapS: p.gap, at: new Date(p.start).toISOString(), words: ws.join(' ') });
  }
}
const silenceS = plays.filter((p) => p.gap >= 10).reduce((s, p) => s + (p.end - p.start - MARGIN) / 1000, 0);

const med = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const rows = metrics.map((m, i) => ({
  min: i + 1,
  p50: m.latencyMs.p50?.toFixed(0), p95: m.latencyMs.p95?.toFixed(0), n: m.latencyMs.n,
  cpu: m.totalCpu?.toFixed(1), rssMB: m.totalRssMB?.toFixed(0),
  workerMB: m.helpers.find((h) => h.comm === 'whisper-worker')?.rssMB.toFixed(0),
  electronMB: m.electronRssMB.toFixed(0), infer: m.inferP50?.toFixed(0), skippedBusy: m.skippedBusy,
}));
console.table(rows);
const tot = Object.values(perFile).reduce((a, b) => ({ errors: a.errors + b.errors, n: a.n + b.n }), { errors: 0, n: 0 });
const first = metrics.slice(0, 3), last = metrics.slice(-3);
console.log(JSON.stringify({
  minutes: metrics.length,
  renderLatencyMs: { medianOfMinuteP50: med(metrics.map((m) => m.latencyMs.p50)), medianOfMinuteP95: med(metrics.map((m) => m.latencyMs.p95)), worstMinuteP95: Math.max(...metrics.map((m) => m.latencyMs.p95 ?? 0)) },
  cpuPct: { median: med(metrics.map((m) => m.totalCpu)), max: Math.max(...metrics.map((m) => m.totalCpu)) },
  rssMB: { first3: first.map((m) => Math.round(m.totalRssMB)), last3: last.map((m) => Math.round(m.totalRssMB)) },
  wer: { overall: tot.n ? tot.errors / tot.n : null, words: tot.n, perFile: Object.fromEntries(Object.entries(perFile).map(([f, v]) => [f, { wer: +(v.errors / v.n).toFixed(3), plays: v.plays }])) },
  silence: { seconds: Math.round(silenceS), gapsWithWords: hallucinations.length, hallucinations },
}, null, 1));
