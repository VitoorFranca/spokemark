import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Appearance, OverlayApi, OverlayExtra, SubtitleViewMsg } from '../../shared/ipc';
import { CaptionBox } from '../shared/CaptionBox';
import './overlay.css';

declare global {
  interface Window { captions: OverlayApi }
}

const api = window.captions;

// Corner handle (edit mode). Transparent windows can't be resized natively.
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
  return <div onPointerDown={onPointerDown} aria-hidden className="no-drag absolute right-1 bottom-1 h-3.5 w-3.5 cursor-nwse-resize rounded-[3px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,.35)]" />;
}

function App() {
  const [view, setView] = useState<SubtitleViewMsg>({ version: 0, lines: [] });
  const [ap, setAp] = useState<Appearance | null>(null);
  const [extra, setExtra] = useState<OverlayExtra>({ source: null, translation: '' });
  const level = useRef(-90); // read by the waves' animation loop, no re-render per sample

  useEffect(() => {
    const offV = api.onView(setView);
    const offA = api.onAppearance(setAp);
    const offE = api.onExtra(setExtra);
    const offL = api.onLevel((db) => { level.current = db; });
    api.ready();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') api.exitEdit(); };
    window.addEventListener('keydown', onKey);
    return () => { offV(); offA(); offE(); offL(); window.removeEventListener('keydown', onKey); };
  }, []);

  // Ack after the frame containing this version is painted (latency metrics).
  useLayoutEffect(() => {
    const v = view.version;
    requestAnimationFrame(() => setTimeout(() => api.rendered(v), 0));
  }, [view.version]);

  if (!ap) return null;
  const hasText = view.lines.some((l) => l.committed || l.provisional);
  const showBox = hasText || ap.editMode || ap.status === 'error';

  return (
    <div className={`relative flex h-full w-full items-end justify-center ${ap.editMode ? 'drag' : ''}`}>
      <div className="relative w-full transition-opacity duration-300" style={{ opacity: showBox ? 1 : 0 }}>
        <CaptionBox look={ap} lines={view.lines} source={extra.source} translation={extra.translation} translationEnabled={ap.translationEnabled}
          translationMode={ap.translationMode} speakerTurns={ap.speakerTurns} showSourceApp={ap.showSourceApp} waves={ap.captionWaves} level={level}>
          {ap.status === 'error' && !hasText ? (
            <div style={{ fontSize: '0.55em', color: '#FFB4A8' }}>{ap.statusText}</div>
          ) : ap.editMode && !hasText ? (
            <div style={{ fontSize: '0.55em', opacity: 0.85 }}>{ap.editHint}</div>
          ) : undefined}
        </CaptionBox>
        {ap.editMode && (
          <>
            {/* subtle frame + one-line hint while editing */}
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[14px] shadow-[0_0_0_1.5px_rgba(255,255,255,.75),0_0_0_3px_rgba(0,0,0,.25)]" />
            {hasText && <div className="pointer-events-none absolute right-6 top-1.5 rounded-full bg-black/70 px-2.5 py-0.5 text-[11px] font-medium text-white">{ap.editHint}</div>}
            <ResizeHandle />
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
