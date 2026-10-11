import { memo, useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Appearance, OverlayApi, SubtitleViewMsg } from '../shared/ipc';
import './index.css';

declare global {
  interface Window { captions: OverlayApi }
}

const api = window.captions;

// Each line re-renders only when its own text changes; the confirmed part and
// the provisional tail are separate text nodes, so a tail update never touches
// confirmed text.
const Line = memo(function Line({ committed, provisional }: { committed: string; provisional: string }) {
  return (
    <div className="caption-line whitespace-pre-wrap break-words">
      <span>{committed}</span>
      {provisional && <span className="opacity-60">{committed ? ' ' : ''}{provisional}</span>}
    </div>
  );
});

// Bottom-right handle (edit mode). Transparent windows can't be resized natively.
function ResizeHandle() {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const sx = e.screenX, sy = e.screenY, w0 = window.innerWidth, h0 = window.innerHeight;
    const move = (ev: PointerEvent) => api.resize(w0 + ev.screenX - sx, h0 + ev.screenY - sy);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return <div onPointerDown={onPointerDown} className="no-drag absolute right-0 bottom-0 h-5 w-5 cursor-nwse-resize rounded-br-xl border-r-4 border-b-4 border-white/80" />;
}

function App() {
  const [view, setView] = useState<SubtitleViewMsg>({ version: 0, lines: [] });
  const [ap, setAp] = useState<Appearance>({ fontSize: 28, opacity: 0.6, maxLines: 2, editMode: false, status: 'idle', statusText: '' });

  useEffect(() => {
    const offV = api.onView(setView);
    const offA = api.onAppearance(setAp);
    api.ready();
    return () => { offV(); offA(); };
  }, []);

  // Ack after the frame containing this version is painted (latency metrics).
  useLayoutEffect(() => {
    const v = view.version;
    requestAnimationFrame(() => setTimeout(() => api.rendered(v), 0));
  }, [view.version]);

  const hasText = view.lines.some((l) => l.committed || l.provisional);
  const showBox = hasText || ap.editMode || ap.status === 'error';
  const lineHeight = 1.35;

  return (
    <div className={`relative flex h-full w-full items-end justify-center ${ap.editMode ? 'drag' : ''}`}>
      {ap.editMode && <ResizeHandle />}
      <div
        className={`w-full rounded-xl px-5 py-3 text-white transition-opacity duration-300 ${ap.editMode ? 'outline-2 outline-dashed outline-white/70' : ''}`}
        style={{
          backgroundColor: `rgba(0,0,0,${ap.opacity})`,
          opacity: showBox ? 1 : 0,
          fontSize: ap.fontSize,
          lineHeight,
          fontWeight: 500,
          textShadow: '0 1px 2px rgba(0,0,0,0.6)',
        }}
      >
        <div className="flex flex-col justify-end overflow-hidden" style={{ height: `${ap.maxLines * lineHeight}em` }}>
          {ap.status === 'error' && !hasText ? (
            <div className="text-red-300" style={{ fontSize: '0.6em' }}>{ap.statusText}</div>
          ) : ap.editMode && !hasText ? (
            <div className="opacity-70" style={{ fontSize: '0.6em' }}>Drag to move · resize from the corner · ⌥⌘E to lock</div>
          ) : (
            view.lines.map((l) => <Line key={l.id} committed={l.committed} provisional={l.provisional} />)
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
