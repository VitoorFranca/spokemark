// Caption look shared by the overlay and the live preview in Settings, so the
// preview is exactly what the overlay renders.
import type { Settings } from './settings';

export type CaptionLook = Pick<Settings, 'captionPreset' | 'captionFont' | 'fontSize' | 'opacity' | 'maxLines'>;

export const FONT_STACKS: Record<Settings['captionFont'], string> = {
  system: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", -apple-system, sans-serif',
  serif: 'ui-serif, "New York", Georgia, serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
};

export interface CaptionCss {
  box: Record<string, string | number>;
  text: Record<string, string | number>;
  lineHeight: number;
}

export function captionCss(l: CaptionLook): CaptionCss {
  const lineHeight = 1.35;
  const base = { fontFamily: FONT_STACKS[l.captionFont], fontSize: l.fontSize, lineHeight, color: '#FFFFFF' };
  switch (l.captionPreset) {
    case 'contrast':
      return {
        lineHeight,
        box: { backgroundColor: `rgba(0,0,0,${l.opacity})`, borderRadius: 10 },
        text: { ...base, fontWeight: 700, letterSpacing: '0.01em' },
      };
    case 'cinema':
      return {
        lineHeight,
        box: { backgroundColor: `rgba(0,0,0,${l.opacity})`, borderRadius: 10 },
        // outline readable on any background when there is no box
        text: { ...base, fontWeight: 600, textShadow: '0 0 2px #000, 0 0 2px #000, 0 1px 3px rgba(0,0,0,.9), 0 0 8px rgba(0,0,0,.6)' },
      };
    default:
      return {
        lineHeight,
        box: { backgroundColor: `rgba(0,0,0,${l.opacity})`, borderRadius: 14 },
        text: { ...base, fontWeight: 500, textShadow: '0 1px 2px rgba(0,0,0,0.5)' },
      };
  }
}
