// Scores speaker-turn detection from transcribe CLI outputs against ground truth.
// Usage: node scripts/tdrz-eval.mjs <run.json> <truth.json|"none"> [toleranceWords=1]
// A detected turn is correct if it lands within ±tolerance words of a true turn.
import { readFileSync } from 'node:fs';

const [runPath, truthPath, tolArg] = process.argv.slice(2);
const tol = Number(tolArg ?? 1);
const run = JSON.parse(readFileSync(runPath, 'utf8'));
const truth = truthPath === 'none' ? { turnAfterWord: [] } : JSON.parse(readFileSync(truthPath, 'utf8'));
const MARK = '⟪SPEAKERTURN⟫';
const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

// hypothesis words + marker positions (in hyp word count)
const hyp = [];
const markersAt = [];
for (const w of run.words) {
  if (w.text === MARK) markersAt.push(hyp.length);
  else for (const t of w.text.split(/\s+/)) { const n = norm(t); if (n) hyp.push(n); }
}

// reference words (from the dialogue text) via the .txt next to the truth file
const refText = truthPath === 'none' ? '' : readFileSync(truthPath.replace(/\.json$/, '.txt'), 'utf8');
const ref = refText.split(/\s+/).map(norm).filter(Boolean);

// Levenshtein alignment -> for each hyp prefix length, the aligned ref prefix length
const R = ref.length, H = hyp.length;
const d = Array.from({ length: R + 1 }, (_, i) => Array.from({ length: H + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
for (let i = 1; i <= R; i++) for (let j = 1; j <= H; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
const hypToRef = new Array(H + 1).fill(0);
let i = R, j = H;
hypToRef[H] = R;
while (i > 0 || j > 0) {
  if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) { i--; j--; hypToRef[j] = i; }
  else if (i > 0 && d[i][j] === d[i - 1][j] + 1) i--;
  else { j--; hypToRef[j] = i; }
}

const detected = markersAt.map((h) => hypToRef[h]);
const trueTurns = truth.turnAfterWord;
const used = new Set();
let tp = 0;
const detail = detected.map((r) => {
  let best = -1;
  for (let k = 0; k < trueTurns.length; k++) if (!used.has(k) && Math.abs(trueTurns[k] - r) <= tol && (best < 0 || Math.abs(trueTurns[k] - r) < Math.abs(trueTurns[best] - r))) best = k;
  if (best >= 0) { used.add(best); tp++; return { at: r, match: trueTurns[best] }; }
  return { at: r, match: null };
});
console.log(JSON.stringify({
  file: runPath.split('/').pop(), model: run.model,
  trueTurns: trueTurns.length, detected: detected.length, correct: tp,
  missed: trueTurns.length - tp, false: detected.length - tp,
  recall: trueTurns.length ? +(tp / trueTurns.length).toFixed(2) : null,
  precision: detected.length ? +(tp / detected.length).toFixed(2) : null,
  wer: run.wer?.wer != null ? +run.wer.wer.toFixed(3) : null,
  firstSeenP50: run.firstSeenLatencyMs?.p50 != null ? Math.round(run.firstSeenLatencyMs.p50) : null,
  firstSeenP95: run.firstSeenLatencyMs?.p95 != null ? Math.round(run.firstSeenLatencyMs.p95) : null,
  inferP50: run.inferMs?.p50 ?? null,
  detail,
}));
