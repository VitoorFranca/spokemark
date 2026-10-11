// Transcript exporters (.txt, .srt, .md). Pure functions, unit tested.

export interface ExportSegment { startMs: number; endMs: number; text: string }
export interface ExportSession { startedAt: number; endedAt: number | null; sourceApp: string | null; segments: ExportSegment[] }

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');

/** 3723004 -> "01:02:03" (or "01:02:03,004" for SRT). */
export function formatTimestamp(ms: number, withMs = false): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const base = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return withMs ? `${base},${pad(t % 1000, 3)}` : base;
}

export function toTxt(s: ExportSession): string {
  return s.segments.map((g) => `[${formatTimestamp(g.startMs)}] ${g.text}`).join('\n') + '\n';
}

export function toSrt(s: ExportSession): string {
  return s.segments
    .map((g, i) => {
      // SRT cues must not end before they start or overlap the next one.
      const next = s.segments[i + 1];
      let end = Math.max(g.endMs, g.startMs + 500);
      if (next && end > next.startMs) end = Math.max(g.startMs + 1, next.startMs);
      return `${i + 1}\n${formatTimestamp(g.startMs, true)} --> ${formatTimestamp(end, true)}\n${g.text}\n`;
    })
    .join('\n');
}

export function toMd(s: ExportSession, title: string, locale = 'en'): string {
  const date = new Date(s.startedAt).toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' });
  const dur = s.endedAt ? formatTimestamp(s.endedAt - s.startedAt) : null;
  const meta = [date, dur, s.sourceApp].filter(Boolean).join(' · ');
  const body = s.segments.map((g) => `**${formatTimestamp(g.startMs)}** ${g.text}`).join('\n\n');
  return `# ${title}\n\n_${meta}_\n\n${body}\n`;
}
