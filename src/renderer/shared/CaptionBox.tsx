// Caption rendering shared by the overlay and the Settings preview.
import { memo, useEffect, useRef, type ReactNode } from 'react';
import { captionCss, type CaptionLook } from '../../shared/captionStyle';

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
const WAVES = [
  { color: '59,130,246', freq: 1.3, speed: 0.9, phase: 0.0, alpha: 0.55 },  // blue
  { color: '34,211,238', freq: 1.9, speed: 1.3, phase: 1.7, alpha: 0.4 },   // cyan
  { color: '168,85,247', freq: 1.1, speed: 0.7, phase: 3.1, alpha: 0.45 },  // purple
  { color: '244,63,94', freq: 2.3, speed: 1.1, phase: 4.4, alpha: 0.35 },   // rose
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
      glow.addColorStop(0, 'rgba(20,30,60,0)');
      glow.addColorStop(1, `rgba(40,60,140,${0.10 + amp * 0.18})`);
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
        ctx.lineWidth = 1.4;
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

export function CaptionBox({ look, lines, children, source, translation, translationEnabled, translationMode, showSourceApp, waves, level }: {
  look: CaptionLook;
  lines: CaptionLine[];
  children?: ReactNode;
  source?: CaptionSource | null;
  translation?: string;
  translationEnabled?: boolean;
  translationMode?: 'both' | 'translation';
  showSourceApp?: boolean;
  waves?: boolean;
  level?: { current: number };
}) {
  const css = captionCss(look);
  const both = translationEnabled && translationMode === 'both';
  const onlyTranslation = translationEnabled && translationMode === 'translation' && !!translation;
  const translationLines = both ? (look.maxLines === 3 ? 2 : 1) : 0;
  const withBox = look.opacity > 0;
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
        <div className="flex flex-col justify-end overflow-hidden" style={{ ...css.text, height: `${look.maxLines * css.lineHeight}em` }}>
          {children ?? (onlyTranslation
            ? <div className="caption-line whitespace-pre-wrap break-words">{translation}</div>
            : lines.map((l) => <Line key={l.id} committed={l.committed} provisional={l.provisional} />))}
        </div>
        {both && (
          <div className="flex flex-col justify-end overflow-hidden" style={{ ...css.text, fontSize: Math.round(look.fontSize * 0.86), fontWeight: 500, color: 'rgba(255,255,255,0.68)', height: `${translationLines * css.lineHeight}em` }}>
            {translation ? <div className="whitespace-pre-wrap break-words">{translation}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
