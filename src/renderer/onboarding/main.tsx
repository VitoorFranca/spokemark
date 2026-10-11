import { ArrowLeft, ArrowRight, CircleCheck, Cpu, ShieldCheck, Sparkles, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppStateMsg } from '../../shared/appIpc';
import { APP_NAME } from '../../shared/brand';
import { MODELS } from '../../shared/models';
import '../shared/base.css';
import { api, useAppState, useLevel, useLive, useT } from '../shared/hooks';
import { lastLines } from '../shared/liveReducer';
import { currentModel, LevelMeter, ModelDownload } from '../shared/StatusBits';
import { Button, cx } from '../shared/ui';

type T = ReturnType<typeof useT>;
const STEPS = 4;

function Step({ icon, title, body, children, bare }: { icon: ReactNode; title: string; body: string; children?: ReactNode; bare?: boolean }) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => { h.current?.focus(); }, [title]); // VoiceOver announces each new step
  return (
    <div className="fade-in flex flex-col items-center text-center">
      <div className={bare ? 'mb-4' : 'mb-4 flex h-14 w-14 items-center justify-center rounded-[16px] bg-[var(--accent-soft)] text-[var(--accent)]'}>{icon}</div>
      {/* focused so VoiceOver announces each step; no visible ring for a heading */}
      <h1 ref={h} tabIndex={-1} className="text-[22px] font-semibold tracking-[-0.01em] focus-visible:outline-none">{title}</h1>
      <p className="mt-2 max-w-[420px] text-[14px] leading-[1.5] text-[var(--text-2)]">{body}</p>
      <div className="mt-6 w-full max-w-[400px]">{children}</div>
    </div>
  );
}

function Done({ label }: { label: string }) {
  return <p className="fade-in flex items-center justify-center gap-2 text-[14px] font-medium text-[var(--success)]" role="status"><CircleCheck size={18} strokeWidth={2} aria-hidden />{label}</p>;
}

function TestStep({ s, t, onOk }: { s: AppStateMsg; t: T; onOk: (ok: boolean) => void }) {
  const live = useLive();
  const db = useLevel();
  const started = useRef(false);
  useEffect(() => {
    if (!started.current && !s.running) { started.current = true; void api().request('captions.toggle'); }
  }, []);
  const words = live.segments.reduce((n, g) => n + g.text.split(' ').length, 0) + (live.open ? live.open.split(' ').length : 0);
  const ok = words >= 3;
  useEffect(() => { onOk(ok); }, [ok]);
  const { confirmed, provisional } = lastLines(live, 2);
  const capturing = s.status === 'listening' || s.status === 'processing' || s.status === 'silent';
  return (
    <Step icon={<Volume2 size={26} strokeWidth={1.75} />} title={t('onb.testTitle')} body={t('onb.testBody')}>
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 text-left">
        <div className="mb-2 flex items-center gap-2 text-[12px] text-[var(--text-2)]">
          <span className="text-[var(--accent)]"><LevelMeter db={db} active={capturing} label={t('panel.level')} /></span>
          <span aria-live="polite">{ok ? '' : s.status === 'loading' ? t('state.loading') : t('onb.testWaiting')}</span>
        </div>
        <p className="selectable min-h-[44px] text-[15px] leading-[1.45]">{confirmed}{provisional && <span className="text-[var(--text-2)]"> {provisional}</span>}</p>
      </div>
      {ok && <div className="mt-4"><Done label={t('onb.testOk')} /></div>}
    </Step>
  );
}

function Onboarding() {
  const s = useAppState();
  const t = useT(s);
  const [step, setStep] = useState(1);
  const [testOk, setTestOk] = useState(false);
  const [asking, setAsking] = useState(false);
  if (!s) return null;
  const model = currentModel(s);
  const permOk = s.permission === 'granted';
  const modelOk = model.installed && s.status !== 'modelMissing'; // 'modelMissing' also covers the VAD model
  const canNext = step === 1 || (step === 2 && permOk) || (step === 3 && modelOk);

  const finish = async () => {
    if (s.running && !testOk) await api().request('captions.toggle');
    await api().request('onboarding.complete');
  };

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      <div className="drag h-[38px] shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center px-10">
        {step === 1 && (
          <Step bare icon={<img src="./icon.png" alt="" className="h-16 w-16" />} title={t('onb.welcomeTitle')} body={t('onb.welcomeBody')} />
        )}
        {step === 2 && (
          <Step icon={<ShieldCheck size={26} strokeWidth={1.75} />} title={t('onb.permTitle')} body={t('onb.permBody')}>
            {permOk ? <Done label={t('onb.permGranted')} /> : (
              <div className="flex flex-col items-center gap-3">
                <Button variant="primary" onClick={async () => { setAsking(true); await api().request('permission.request'); }}>{t('action.allow')}</Button>
                {asking && <p className="text-[12px] text-[var(--text-2)]" aria-live="polite">{t('onb.permWaiting')}</p>}
                {asking && <Button variant="ghost" size="sm" onClick={() => void api().request('permission.openSettings')}>{t('action.openPrivacy')}</Button>}
              </div>
            )}
          </Step>
        )}
        {step === 3 && (
          <Step icon={<Cpu size={26} strokeWidth={1.75} />} title={t('onb.modelTitle')} body={t('onb.modelBody', { size: `${Math.round(MODELS[model.id].bytes / 1e6)}\u00A0MB` })}>
            {modelOk ? <Done label={t('onb.modelReady')} /> : <div className="text-left"><ModelDownload model={model} t={t} /></div>}
          </Step>
        )}
        {step === 4 && <TestStep s={s} t={t} onOk={setTestOk} />}
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-[var(--separator)] px-6 h-16">
        <div className="flex items-center gap-1.5" aria-label={t('onb.step', { n: step, total: STEPS })} role="img">
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={cx('h-1.5 rounded-full transition-all duration-[var(--dur)]', i + 1 === step ? 'w-5 bg-[var(--accent)]' : i + 1 < step ? 'w-1.5 bg-[var(--accent)] opacity-50' : 'w-1.5 bg-[var(--surface-2)]')} />
          ))}
        </div>
        <span className="text-[12px] text-[var(--text-2)]">{t('onb.step', { n: step, total: STEPS })}</span>
        <div className="flex-1" />
        {step > 1 && step < 4 && <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(step - 1)}>{t('action.back')}</Button>}
        {step < 4 ? (
          <Button variant="primary" disabled={!canNext} onClick={() => setStep(step + 1)}>{t('action.continue')}<ArrowRight size={14} strokeWidth={2} aria-hidden /></Button>
        ) : (
          <>
            {!testOk && <Button variant="ghost" onClick={() => void finish()}>{t('action.skipTest')}</Button>}
            <Button variant="primary" icon={Sparkles} disabled={!testOk} onClick={() => void finish()}>{t('onb.finish', { app: APP_NAME })}</Button>
          </>
        )}
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Onboarding />);
