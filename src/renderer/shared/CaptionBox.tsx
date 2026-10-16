// Caption rendering shared by the overlay and the Settings preview.
import { Fragment, memo, useEffect, useRef, type ReactNode } from 'react';
import { captionCss, type CaptionLook } from '../../shared/captionStyle';
import { translationLineCount } from '../../shared/models';

export interface CaptionLine { id: number; committed: string; provisional: string }
export interface CaptionSource { name: string; icon: string | null }

// Each line re-renders only when its own text changes; the confirmed part and
// the provisional tail are separate text nodes.
const Line = memo(function Line({ committed, provisional }: { committed: string; provisional: string }) {
  return (
    <div className="caption-line whitespace-pre-wrap break-words">
      <span>{committed}</span>
      {provisional && <span style={{ opacity: 0.55 }}>{committed ? ' ' : ''}{provisional}</span>}
    </div>
  );
});

/**
 * Soft colored waves behind the captions. Their height follows the audio level;
 * the animation runs only while there is sound (and never with reduced motion),
 * then settles into a still frame.
 */
// The website's iridescent palette: ember, gold, ivory, teal, violet, cobalt (thin fibre-like strokes).
const WAVES = [
  { color: '242,84,27', freq: 1.3, speed: 0.9, phase: 0.0, alpha: 0.55 },   // ember
  { color: '250,199,92', freq: 1.9, speed: 1.3, phase: 1.7, alpha: 0.45 },  // gold
  { color: '242,237,220', freq: 1.6, speed: 1.0, phase: 2.4, alpha: 0.35 }, // ivory
  { color: '51,168,178', freq: 1.1, speed: 0.7, phase: 3.1, alpha: 0.45 },  // teal
  { color: '128,77,199', freq: 2.3, speed: 1.1, phase: 4.4, alpha: 0.4 },   // violet
  { color: '59,108,246', freq: 0.9, speed: 0.8, phase: 5.2, alpha: 0.35 },  // cobalt
];

export function Waves({ level }: { level: { current: number } }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, t = 0, amp = 0.15, last = 0, running = false;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const glow = ctx.createLinearGradient(0, h * 0.35, 0, h);
      glow.addColorStop(0, 'rgba(40,24,16,0)');
      glow.addColorStop(1, `rgba(120,64,30,${0.08 + amp * 0.16})`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      for (const wv of WAVES) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const u = x / w;
          const env = Math.sin(Math.PI * u); // calm at the edges
          const y = h * 0.84 + Math.sin(u * Math.PI * 2 * wv.freq + t * wv.speed + wv.phase) * (2 + amp * h * 0.22) * env;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${wv.color},${wv.alpha * (0.45 + amp * 0.4)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };
    const frame = (now: number) => {
      if (now - last >= 33) { // ~30 fps is plenty for a background
        const target = Math.min(1, Math.max(0, (level.current + 55) / 40));
        amp += (target - amp) * 0.12;
        t += 0.045;
        last = now;
        draw();
      }
      // keep animating while there is sound or the waves are still settling
      if (level.current > -55 || amp > 0.06) raf = requestAnimationFrame(frame);
      else running = false;
    };
    const kick = () => { if (!running && !reduce) { running = true; raf = requestAnimationFrame(frame); } };
    draw();
    const id = setInterval(() => { if (level.current > -55) kick(); }, 150);
    const ro = new ResizeObserver(() => draw());
    ro.observe(c);
    return () => { cancelAnimationFrame(raf); clearInterval(id); ro.disconnect(); };
  }, [level]);
  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] w-full" />;
}

export function CaptionBox({ look, lines, children, source, translation, pairs, translationEnabled, translationMode, speakerTurns, showSourceApp, waves, level }: {
  look: CaptionLook;
  lines: CaptionLine[];
  children?: ReactNode;
  source?: CaptionSource | null;
  translation?: string;
  /** Each speaker's text with its translation: with speaker changes, the translation goes right under its speaker. */
  pairs?: { source: string; text: string }[];
  translationEnabled?: boolean;
  translationMode?: 'both' | 'translation';
  /** Speaker changes active: the translation has one line per speaker ("– …"). */
  speakerTurns?: boolean;
  showSourceApp?: boolean;
  waves?: boolean;
  level?: { current: number };
}) {
  const css = captionCss(look);
  const both = translationEnabled && translationMode === 'both';
  const onlyTranslation = translationEnabled && translationMode === 'translation' && !!translation;
  const translationLines = both ? translationLineCount(look.maxLines, !!speakerTurns) : 0;
  const withBox = look.opacity > 0;
  const interleaved = both && !!speakerTurns && !!pairs && !children;
  const trStyle = { fontSize: `${0.86}em`, fontWeight: 500, color: 'rgba(255,255,255,0.68)' };
  return (
    <div className="relative w-full overflow-hidden" style={{ ...css.box, ...(withBox ? { backgroundColor: `rgba(9,9,13,${look.opacity})` } : {}) }}>
      {waves && withBox && level && <Waves level={level} />}
      <div className="relative px-5 py-3">
        {showSourceApp && source && (
          <div className="mb-1 flex items-center gap-2" style={{ fontFamily: css.text.fontFamily as string }}>
            {source.icon ? <img src={source.icon} alt="" className="h-5 w-5 rounded-[5px]" /> : <span className="h-5 w-5 rounded-[5px] bg-white/15" />}
            <span className="truncate text-[14px] font-semibold text-white/60" style={{ textShadow: 'none' }}>{source.name}</span>
          </div>
        )}
        {interleaved ? (
          // one column: each speaker's lines, then its translation; the same total height as the two blocks
          <div className="flex flex-col justify-end overflow-hidden" style={{ ...css.text, height: `${(look.maxLines + translationLines * 0.86) * css.lineHeight}em` }}>
            {speakerGroups(lines).map((g, i, all) => {
              const tr = translationFor(i, all.length, pairs!);
              return (
                <Fragment key={g.lines[0]!.id}>
                  {g.lines.map((l) => <Line key={l.id} committed={l.committed} provisional={l.provisional} />)}
                  {tr && <div className="whitespace-pre-wrap break-words" style={trStyle}>{g.turn ? `– ${tr}` : tr}</div>}
                </Fragment>
              );
            })}
          </div>
        ) : <>
        <div className="flex flex-col justify-end overflow-hidden" style={{ ...css.text, height: `${look.maxLines * css.lineHeight}em` }}>
          {children ?? (onlyTranslation
            ? translation!.split('\n').map((l, i) => <div key={i} className="caption-line whitespace-pre-wrap break-words">{l}</div>)
            : lines.map((l) => <Line key={l.id} committed={l.committed} provisional={l.provisional} />))}
        </div>
        {both && (
          <div className="flex flex-col justify-end overflow-hidden" style={{ ...css.text, fontSize: Math.round(look.fontSize * 0.86), fontWeight: 500, color: 'rgba(255,255,255,0.68)', height: `${translationLines * css.lineHeight}em` }}>
            {translation ? translation.split('\n').map((l, i) => <div key={i} className="whitespace-pre-wrap break-words">{l}</div>) : null}
          </div>
        )}
        </>}
      </div>
    </div>
  );
}

/** Caption lines grouped by speaker: a line starting with "–" starts a new speaker (as in SentenceTranslator turns). */
export function speakerGroups(lines: CaptionLine[]): { lines: CaptionLine[]; text: string; turn: boolean }[] {
  const groups: { lines: CaptionLine[]; text: string; turn: boolean }[] = [];
  for (const l of lines) {
    const text = [l.committed, l.provisional].filter(Boolean).join(' ').trim();
    const turn = /^–(\s|$)/.test(text);
    const body = turn ? text.replace(/^–\s*/, '') : text;
    const last = groups[groups.length - 1];
    if (turn || !last) groups.push({ lines: [l], text: body, turn });
    else { last.lines.push(l); last.text = [last.text, body].filter(Boolean).join(' '); }
  }
  return groups;
}

/**
 * The translation under speaker group `i` of `n` on screen. Translations come one per turn,
 * oldest first, and the newest turn is always the last group, so they are matched from the
 * end: lines scrolling off the top never shift them.
 */
export function translationFor(i: number, n: number, pairs: { source: string; text: string }[]): string | null {
  const p = pairs[pairs.length - (n - i)];
  return p?.text || null;
}
