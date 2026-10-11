// Caption rendering shared by the overlay and the Settings preview.
import { memo } from 'react';
import { captionCss, type CaptionLook } from '../../shared/captionStyle';

export interface CaptionLine { id: number; committed: string; provisional: string }

// Each line re-renders only when its own text changes; the confirmed part and
// the provisional tail are separate text nodes.
const Line = memo(function Line({ committed, provisional }: { committed: string; provisional: string }) {
  return (
    <div className="caption-line whitespace-pre-wrap break-words">
      <span>{committed}</span>
      {provisional && <span style={{ opacity: 0.62 }}>{committed ? ' ' : ''}{provisional}</span>}
    </div>
  );
});

export function CaptionBox({ look, lines, children }: { look: CaptionLook; lines: CaptionLine[]; children?: React.ReactNode }) {
  const css = captionCss(look);
  return (
    <div className="w-full px-5 py-3 transition-[background-color] duration-[var(--dur)]" style={css.box}>
      <div className="flex flex-col justify-end overflow-hidden" style={{ ...css.text, height: `${look.maxLines * css.lineHeight}em` }}>
        {children ?? lines.map((l) => <Line key={l.id} committed={l.committed} provisional={l.provisional} />)}
      </div>
    </div>
  );
}
