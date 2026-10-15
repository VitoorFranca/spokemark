// The website's sound-wave landscape as a backdrop for app surfaces.
// Animates only while `animate` is on, the window is visible and motion is allowed;
// otherwise (or on software GL, or under 45 fps) it settles into one still frame.
import { useEffect, useRef } from 'react';
import { createWaves, type Waves } from './waves';
import { cx } from './ui';

/** dBFS (−60…0) to the shader's 0…1 "speech energy". */
export const dbToEnergy = (db: number) => Math.min(1, Math.max(0, (db + 55) / 40));

export function WaveBackdrop({ animate = false, db, energy = 0.4, top = 0.75, time = 6, dpr = 1.5, className }: {
  animate?: boolean;
  /** Device-pixel-ratio cap (small bands can use 1). */
  dpr?: number;
  /** Live level in dBFS; when given it drives the energy. */
  db?: number;
  energy?: number;
  top?: number;
  time?: number;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const waves = useRef<Waves | null>(null);
  const slow = useRef(false);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let w: Waves | null = null;
    try { w = createWaves(c, { maxDpr: dpr, top, time, clear: true, fps: 30 }); } catch { w = null; }
    waves.current = w;
    if (!w) return;
    w.setEnergy(energy);
    w.render();
    const ro = new ResizeObserver(() => w!.render());
    ro.observe(c);
    return () => { ro.disconnect(); w!.stop(); waves.current = null; };
    // the shader is created once per mount; props below only steer it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const w = waves.current;
    if (!w) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sync = () => {
      const go = animate && !reduce && !w.software && !slow.current && !document.hidden;
      if (go) w.start(); else { w.stop(); w.render(); }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    // a GPU that can't hold ~45 fps keeps a still frame
    const check = animate ? setTimeout(() => { const f = w.fps(); if (f && f < 45) { slow.current = true; sync(); } }, 3000) : 0;
    return () => { document.removeEventListener('visibilitychange', sync); clearTimeout(check); };
  }, [animate]);

  useEffect(() => { waves.current?.setEnergy(db !== undefined ? dbToEnergy(db) : energy); }, [db, energy]);

  return <canvas ref={canvas} aria-hidden className={cx('pointer-events-none absolute inset-0 h-full w-full', className)} />;
}
