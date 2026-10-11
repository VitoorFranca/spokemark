// Live transcript state on the renderer side (pure; unit tested).
import type { LiveEvent, SegmentMsg } from '../../shared/appIpc';

export interface LiveState { startedAt: number | null; segments: SegmentMsg[]; open: string; provisional: string }
export const emptyLive: LiveState = { startedAt: null, segments: [], open: '', provisional: '' };
const CAP = 2000; // a renderer never holds more than this many segments

export function liveReducer(s: LiveState, e: LiveEvent): LiveState {
  switch (e.type) {
    case 'reset':
      return { startedAt: e.startedAt, segments: e.segments.slice(-CAP), open: '', provisional: '' };
    case 'append': {
      const last = s.segments[s.segments.length - 1];
      if (last && last.startMs === e.segment.startMs && last.text === e.segment.text) return s; // duplicate delivery
      const segments = [...s.segments, e.segment];
      if (segments.length > CAP) segments.shift();
      // the open segment just closed: its words are now in `segments`
      return { ...s, segments, open: '' };
    }
    case 'tail':
      if (e.open === s.open && e.provisional === s.provisional) return s;
      return { ...s, open: e.open, provisional: e.provisional };
  }
}

/** Last `n` lines of text for compact previews (panel, onboarding). */
export function lastLines(s: LiveState, n: number): { confirmed: string; provisional: string } {
  const confirmed = [...s.segments.slice(-n).map((g) => g.text), s.open].filter(Boolean).join(' ');
  return { confirmed, provisional: s.provisional };
}
