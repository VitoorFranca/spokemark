import { ArrowDown, Check, Clock, Copy, Download, FileText, History, Pause, Play, Radio, Search, Settings2, Square, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppStateMsg, Command, SegmentMsg, SessionRowMsg } from '../../shared/appIpc';
import { formatTimestamp } from '../../shared/exporters';
import '../shared/base.css';
import { formatDate, formatDuration } from '../shared/format';
import { api, useAppState, useCommand, useLevel, useLive, useT } from '../shared/hooks';
import { WaveBackdrop } from '../shared/WaveBackdrop';
import { statusLabel, StatusDot } from '../shared/StatusBits';
import { Button, cx, EmptyState, IconButton, SidebarItem } from '../shared/ui';
import { APP_NAME } from '../../shared/brand';

type T = ReturnType<typeof useT>;
type SessionFull = SessionRowMsg & { segments: SegmentMsg[] };

function useCopied(): [boolean, (text: string) => void] {
  const [copied, set] = useState(false);
  const timer = useRef<number | null>(null);
  return [copied, (text) => {
    void api().request('copy.text', text);
    set(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => set(false), 1500);
  }];
}

function Transcript({ segments, open, provisional }: { segments: SegmentMsg[]; open?: string; provisional?: string }) {
  return (
    <ol className="selectable space-y-3 text-[16px] leading-[1.55] font-[family-name:var(--font-read)]">
      {segments.map((g, i) => (
        <li key={`${g.startMs}-${i}`} className="grid grid-cols-[64px_1fr] gap-3">
          <time className="tabular pt-[4px] font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-3)] select-none">{formatTimestamp(g.startMs)}</time>
          <p>{g.text}</p>
        </li>
      ))}
      {(open || provisional) && (
        <li className="grid grid-cols-[64px_1fr] gap-3">
          <span aria-hidden />
          <p>{open}{provisional && <span className="text-[var(--text-2)]">{open ? ' ' : ''}{provisional}</span>}</p>
        </li>
      )}
    </ol>
  );
}

// ---- Live -----------------------------------------------------------------------------
function LiveView({ s, t }: { s: AppStateMsg; t: T }) {
  const live = useLive();
  const db = useLevel();
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [copied, copy] = useCopied();

  // Auto-scroll while following; pause as soon as the user scrolls up.
  useEffect(() => {
    const el = scroller.current;
    if (el && follow) el.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [live, follow]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setFollow(atBottom);
  };
  const text = useMemo(() => live.segments.map((g) => `[${formatTimestamp(g.startMs)}] ${g.text}`).join('\n'), [live.segments]);
  const empty = live.segments.length === 0 && !live.open && !live.provisional;

  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--separator)] px-5">
        <h1 className="text-[15px] font-semibold">{t('live.title')}</h1>
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--text-2)]"><StatusDot status={s.status} />{statusLabel(s.status, t)}{s.sources.length > 0 && s.running ? ` · ${s.sources.join(', ')}` : ''}</span>
        <div className="flex-1" />
        <div className="no-drag flex items-center gap-2">
          <Button icon={copied ? Check : Copy} disabled={empty} onClick={() => copy(text)}>{copied ? t('action.copied') : t('action.copy')}</Button>
          {(s.running || s.paused) && (
            <Button icon={s.running ? Pause : Play} disabled={s.status === 'stopping'} onClick={() => void api().request('captions.pause')}>
              {s.running ? t('action.pause') : t('action.resume')}
            </Button>
          )}
          {s.running || s.paused ? (
            <Button icon={Square} disabled={s.status === 'stopping'} onClick={() => void api().request('captions.stop')}>{t('action.stop')}</Button>
          ) : (
            <Button variant="primary" icon={Play} disabled={s.status === 'stopping' || s.status === 'modelMissing'} onClick={() => void api().request('captions.toggle')}>{t('action.start')}</Button>
          )}
        </div>
      </header>
      <div ref={scroller} onScroll={onScroll} className="scroll relative flex-1 px-8 py-6" aria-live="off">
        {empty ? (
          <>
            {/* the website's sound waves, quiet until speech arrives */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] [mask-image:linear-gradient(to_top,#000_40%,transparent)]">
              <WaveBackdrop animate={s.running && db > -50} dpr={1} db={s.running ? db : undefined} energy={0.25} top={0.85} time={14} className="opacity-60" />
            </div>
            <div className="relative h-full"><EmptyState icon={Radio} title={t('live.emptyTitle')} body={s.running ? t('live.emptyListening') : t('live.emptyIdle')} /></div>
          </>
        ) : (
          <div className="mx-auto max-w-[720px]"><Transcript segments={live.segments} open={live.open} provisional={live.provisional} /></div>
        )}
      </div>
      {!follow && !empty && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2">
          <Button className="pointer-events-auto fade-in shadow-[0_4px_12px_rgba(0,0,0,.15)]" icon={ArrowDown} onClick={() => setFollow(true)}>{t('action.backToLive')}</Button>
        </div>
      )}
    </div>
  );
}

// ---- History ----------------------------------------------------------------------------
function Highlighted({ text }: { text: string }) {
  // snippet() marks matches with «»
  const parts = text.split(/«|»/);
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded-[3px] bg-[var(--ember)]/20 text-[var(--text)] px-0.5">{p}</mark> : <span key={i}>{p}</span>))}</>;
}

function HistoryView({ s, t, searchRef }: { s: AppStateMsg; t: T; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SessionRowMsg[] | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState<SessionFull | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [copied, copy] = useCopied();
  const lang = s.lang;

  useEffect(() => {
    const h = setTimeout(() => {
      void api().request('history.list', q.trim() ? { query: q.trim() } : {}).then((r) => setRows(r as SessionRowMsg[]));
    }, q ? 150 : 0);
    return () => clearTimeout(h);
  }, [q, s.historyRevision]);
  useEffect(() => {
    if (rows && rows.length && (sel === null || !rows.some((r) => r.id === sel))) setSel(rows[0]!.id);
    if (rows && rows.length === 0) setSel(null);
  }, [rows]);
  useEffect(() => {
    setExported(null);
    if (sel === null) { setDetail(null); return; }
    void api().request('history.get', sel).then((d) => setDetail(d as SessionFull | null));
  }, [sel, s.historyRevision]);

  const exportAs = async (format: 'txt' | 'srt' | 'md') => {
    if (!detail) return;
    const r = (await api().request('history.export', { id: detail.id, format })) as { ok: boolean };
    if (r.ok) { setExported(format); setTimeout(() => setExported(null), 2000); }
  };
  const onListKey = (e: React.KeyboardEvent) => {
    if (!rows?.length) return;
    const i = rows.findIndex((r) => r.id === sel);
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(rows[Math.min(rows.length - 1, i + 1)]!.id); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(rows[Math.max(0, i - 1)]!.id); }
    if ((e.key === 'Backspace' || e.key === 'Delete') && sel !== null && e.metaKey) void api().request('history.delete', sel);
  };

  const historyOff = !s.settings.historyEnabled;
  return (
    <div className="flex h-full flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-[var(--separator)] px-5">
        <h1 className="text-[15px] font-semibold">{t('history.title')}</h1>
        <div className="flex-1" />
        {(rows === null || rows.length > 0 || q) && <>
        <label className="no-drag relative flex w-[280px] items-center">
          <Search size={14} strokeWidth={1.75} className="absolute left-2 text-[var(--text-2)]" aria-hidden />
          <input ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('history.search')} aria-label={t('history.search')}
            className="selectable h-7 w-full rounded-full border border-[var(--border)] bg-[var(--surface-2)] pl-7 pr-2 text-[13px] placeholder:text-[var(--text-3)] focus-visible:outline-2 focus-visible:outline-[var(--focus)]" />
        </label>
        <select aria-label={t('history.deleteRange')} value="" onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) void api().request('history.deleteRange', v as 'today'); }}
          className="no-drag h-7 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-2 text-[13px] text-[var(--text)]" disabled={!rows?.length}>
          <option value="" disabled>{t('history.deleteRange')}</option>
          <option value="today">{t('history.range.today')}</option>
          <option value="week">{t('history.range.week')}</option>
          <option value="month">{t('history.range.month')}</option>
          <option value="all">{t('history.range.all')}</option>
        </select>
        </>}
      </header>

      {historyOff && !rows?.length ? (
        <EmptyState icon={History} title={t('history.offTitle')} body={t('history.offBody')}
          action={<Button variant="primary" onClick={() => void api().request('settings.update', { historyEnabled: true })}>{t('history.turnOn')}</Button>} />
      ) : rows && rows.length === 0 && !q ? (
        <EmptyState icon={FileText} title={t('history.emptyTitle')} body={t('history.emptyBody')}
          action={!s.running ? <Button variant="primary" icon={Play} disabled={s.status === 'modelMissing'} onClick={() => void api().request('captions.toggle')}>{t('action.start')}</Button> : undefined} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* session list */}
          <div role="listbox" aria-label={t('history.title')} tabIndex={0} onKeyDown={onListKey} className="scroll w-[300px] shrink-0 border-r border-[var(--separator)] p-2">
            {rows && rows.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-[var(--text-2)]">{t('history.noResults', { q })}</p>}
            {rows?.map((r) => {
              const on = r.id === sel;
              return (
                <div key={r.id} role="option" aria-selected={on} onClick={() => setSel(r.id)}
                  className={cx('mb-1 rounded-[var(--r-md)] border px-3 py-2', on ? 'bg-[var(--surface-2)] border-[var(--border)]' : 'border-transparent hover:bg-[var(--surface-hover)]')}>
                  <div className="flex items-baseline gap-2">
                    <span className="flex-1 truncate text-[13px] font-semibold">{formatDate(r.startedAt, lang)}</span>
                    {r.endedAt === null ? <span className="text-[11px] font-medium text-[var(--signal)]">{t('history.liveBadge')}</span>
                      : <span className="tabular text-[11px] text-[var(--text-2)]">{formatDuration(r.endedAt - r.startedAt, lang)}</span>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12px] text-[var(--text-2)]">
                    {r.snippet ? <Highlighted text={r.snippet} /> : r.preview}
                  </p>
                  {r.sourceApp && <p className="mt-0.5 text-[11px] text-[var(--text-3)]">{r.sourceApp}</p>}
                </div>
              );
            })}
          </div>
          {/* detail */}
          <div className="flex min-w-0 flex-1 flex-col bg-[var(--bg)]">
            {!detail ? <EmptyState icon={Clock} title={t('history.title')} body={t('history.select')} /> : (
              <>
                <div className="flex shrink-0 items-center gap-2 border-b border-[var(--separator)] px-6 h-12">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{formatDate(detail.startedAt, lang)}</p>
                    <p className="text-[12px] text-[var(--text-2)]">{[detail.endedAt ? formatDuration(detail.endedAt - detail.startedAt, lang) : t('history.liveBadge'), t('history.words', { n: detail.wordCount }), detail.sourceApp].filter(Boolean).join(' · ')}</p>
                  </div>
                  <IconButton icon={copied ? Check : Copy} label={copied ? t('action.copied') : t('action.copy')} onClick={() => copy(detail.segments.map((g) => g.text).join('\n'))} />
                  <div className="flex items-center rounded-[6px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-1)]" role="group" aria-label={t('action.export')}>
                    <span className="flex items-center gap-1 pl-2 pr-1 text-[12px] text-[var(--text-2)]"><Download size={13} strokeWidth={1.75} aria-hidden />{exported ? t('history.exported') : t('action.export')}</span>
                    {(['txt', 'srt', 'md'] as const).map((f) => (
                      <button key={f} type="button" onClick={() => void exportAs(f)} aria-label={`${t('action.export')} .${f}`}
                        className={cx('h-6 px-2 text-[12px] font-medium border-l border-[var(--separator)] hover:bg-[var(--surface-hover)]', exported === f && 'text-[var(--success)]')}>.{f}</button>
                    ))}
                  </div>
                  <IconButton icon={Trash2} label={t('history.deleteSession')} disabled={detail.endedAt === null} onClick={() => void api().request('history.delete', detail.id)} />
                </div>
                <div className="scroll flex-1 px-8 py-6"><div className="mx-auto max-w-[720px]"><Transcript segments={detail.segments} /></div></div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Window -------------------------------------------------------------------------------
function MainWindow() {
  const s = useAppState();
  const t = useT(s);
  const [view, setView] = useState<'live' | 'history'>('live');
  const searchRef = useRef<HTMLInputElement>(null);
  useCommand(useCallback((c: Command) => {
    if (c.type === 'focus-search') { setView('history'); setTimeout(() => searchRef.current?.focus(), 30); }
  }, []));
  if (!s) return null;
  return (
    <div className="flex h-full">
      <nav aria-label="Sidebar" className="drag flex w-[200px] shrink-0 flex-col px-2.5 pt-[52px] pb-3 bg-[var(--surface)] border-r border-[var(--border)]">
        <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5">
          <SidebarItem icon={Radio} label={t('main.live')} active={view === 'live'} onClick={() => setView('live')}
            badge={s.running ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--signal)]" aria-label={t('state.listening')} /> : undefined} />
          <SidebarItem icon={History} label={t('main.history')} active={view === 'history'} onClick={() => setView('history')} />
        </div>
        <div className="flex-1" />
        <div className="mb-2 flex items-center gap-2 px-2 opacity-90"><img src="./icon.png" alt="" className="h-5 w-5" /><span className="text-[12px] font-semibold text-[var(--text-2)]">{APP_NAME}</span></div>
        <SidebarItem icon={Settings2} label={t('action.openSettings').replace('…', '')} active={false} onClick={() => void api().request('window.open', { window: 'settings' })} />
      </nav>
      <main className="relative min-w-0 flex-1 bg-[var(--bg)] border-l border-[var(--separator)]">
        {view === 'live' ? <LiveView s={s} t={t} /> : <HistoryView s={s} t={t} searchRef={searchRef} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<MainWindow />);
