// Word error rate (Levenshtein over normalized words).
export function normalizeForWer(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
}

export function wer(reference: string, hypothesis: string): { wer: number; s: number; d: number; i: number; n: number } {
  const r = normalizeForWer(reference);
  const h = normalizeForWer(hypothesis);
  const dp: number[][] = Array.from({ length: r.length + 1 }, (_, i) => Array.from({ length: h.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= r.length; i++)
    for (let j = 1; j <= h.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
  // backtrack for S/D/I counts
  let i = r.length, j = h.length, s = 0, d = 0, ins = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1)) { if (r[i - 1] !== h[j - 1]) s++; i--; j--; }
    else if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + 1) { d++; i--; }
    else { ins++; j--; }
  }
  return { wer: r.length ? dp[r.length]![h.length]! / r.length : 0, s, d, i: ins, n: r.length };
}
