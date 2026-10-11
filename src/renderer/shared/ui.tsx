// Small set of native-feeling controls built on the design tokens.
import { useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---- Button -------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ variant = 'secondary', size = 'md', icon: Icon, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon }) {
  const sizes = { sm: 'h-6 px-2.5 text-[12px] gap-1.5 rounded-[6px]', md: 'h-7 px-3 gap-1.5 rounded-[6px]', lg: 'h-11 px-4 text-[15px] gap-2 rounded-[10px] font-semibold' };
  const styles: Record<Variant, string> = {
    primary: 'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] shadow-[var(--shadow-1)]',
    secondary: 'bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] shadow-[var(--shadow-1)] hover:bg-[var(--surface-2)]',
    ghost: 'text-[var(--text)] hover:bg-[var(--surface-hover)]',
    danger: 'bg-[var(--surface)] text-[var(--danger)] border border-[var(--border)] hover:bg-[var(--danger-soft)]',
  };
  return (
    <button type="button" className={cx('inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors duration-[var(--dur)] disabled:opacity-45 disabled:pointer-events-none', sizes[size], styles[variant], className)} {...rest}>
      {Icon && <Icon size={size === 'lg' ? 18 : 14} strokeWidth={1.75} aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className, size = 28, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; size?: number }) {
  return (
    <button type="button" aria-label={label} title={label} className={cx('inline-flex items-center justify-center rounded-[6px] text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition-colors duration-[var(--dur)]', className)} style={{ width: size, height: size }} {...rest}>
      <Icon size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

// ---- Toggle (switch) --------------------------------------------------------------
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-[20px] w-[34px] shrink-0 rounded-full transition-colors duration-[var(--dur)] disabled:opacity-45', checked ? 'bg-[var(--accent)]' : 'bg-[var(--surface-2)] border border-[var(--border)]')}>
      <span className={cx('absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-transform duration-[var(--dur)] ease-[var(--ease)]', checked ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
    </button>
  );
}

// ---- Segmented control ---------------------------------------------------------------
export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: { value: T; options: { value: T; label: ReactNode; aria?: string }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md' }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (dir: number) => {
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length]!;
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={cx('inline-flex rounded-[7px] bg-[var(--surface-2)] p-[2px]', size === 'sm' ? 'text-[12px]' : '')}
      onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); } if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); } }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.aria} tabIndex={on ? 0 : -1} onClick={() => onChange(o.value)}
            className={cx('rounded-[5px] font-medium transition-colors duration-[var(--dur)] flex-1 whitespace-nowrap', size === 'sm' ? 'h-[22px] px-2' : 'h-6 px-3',
              on ? 'bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_2px_rgba(0,0,0,.12)]' : 'text-[var(--text-2)] hover:text-[var(--text)]')}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Slider -------------------------------------------------------------------------
export function Slider({ value, min, max, step = 1, onChange, label, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string; format?: (v: number) => string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3 w-full">
      <input type="range" aria-label={label} aria-valuetext={format?.(value)} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="earline-range flex-1" style={{ ['--pct' as string]: `${pct}%` }} />
      {format && <span className="tabular text-[12px] text-[var(--text-2)] w-11 text-right">{format(value)}</span>}
    </div>
  );
}

// ---- Select (native popup, styled trigger) --------------------------------------------------
export function Select<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div className={cx('relative inline-flex', className)}>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none h-7 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-1)] pl-2.5 pr-7 text-[13px] text-[var(--text)] w-full">
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
      <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-2)]" />
    </div>
  );
}

// ---- Layout pieces ----------------------------------------------------------------------
export function Card({ children, className, tone }: { children: ReactNode; className?: string; tone?: 'warning' | 'danger' | 'accent' }) {
  const toneCls = tone === 'warning' ? 'bg-[var(--warning-soft)]' : tone === 'danger' ? 'bg-[var(--danger-soft)]' : tone === 'accent' ? 'bg-[var(--accent-soft)]' : 'bg-[var(--surface)] border border-[var(--border)]';
  return <div className={cx('rounded-[10px]', toneCls, className)}>{children}</div>;
}

/** Grouped settings list (System Settings style): optional title, rows separated by hairlines. */
export function Section({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={title ? id : undefined} className="mb-5">
      {title && <h2 id={id} className="mb-1.5 px-1 text-[12px] font-semibold text-[var(--text-2)]">{title}</h2>}
      <div className="rounded-[10px] bg-[var(--surface)] border border-[var(--border)] divide-y divide-[var(--separator)]">{children}</div>
      {footer && <p className="mt-1.5 px-1 text-[12px] text-[var(--text-2)]">{footer}</p>}
    </section>
  );
}

export function ListRow({ label, description, children, icon: Icon }: { label: ReactNode; description?: ReactNode; children?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex items-center gap-3 min-h-[40px] px-3 py-2">
      {Icon && <Icon size={16} strokeWidth={1.75} className="text-[var(--text-2)] shrink-0" aria-hidden />}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--text)]">{label}</div>
        {description && <div className="text-[12px] text-[var(--text-2)] mt-0.5">{description}</div>}
      </div>
      {children && <div className="shrink-0 flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-10 fade-in">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text-2)]"><Icon size={20} strokeWidth={1.75} aria-hidden /></div>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-1 max-w-[340px] text-[13px] text-[var(--text-2)]">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-[var(--dur)]" style={{ width: `${Math.max(2, value * 100)}%` }} />
    </div>
  );
}

/** "CommandOrControl+Alt+C" -> ⌘⌥C */
export function Kbd({ accel, className }: { accel: string; className?: string }) {
  const map: Record<string, string> = { CommandOrControl: '⌘', Command: '⌘', Cmd: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Space: 'Space' };
  const order = ['⌃', '⌥', '⇧', '⌘'];
  const parts = accel.split('+').map((p) => map[p] ?? p.toUpperCase());
  const mods = parts.filter((p) => order.includes(p)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const keys = parts.filter((p) => !order.includes(p));
  return <kbd className={cx('font-[inherit] tabular text-[12px] text-[var(--text-2)] tracking-wide', className)}>{[...mods, ...keys].join('')}</kbd>;
}

// ---- Sidebar / Toolbar ---------------------------------------------------------------------
export function SidebarItem({ icon: Icon, label, active, onClick, badge }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void; badge?: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={cx('no-drag flex w-full items-center gap-2 rounded-[6px] px-2 h-7 text-[13px] text-left transition-colors duration-[var(--dur)]', active ? 'bg-[var(--sidebar-selected)] font-medium' : 'hover:bg-[var(--surface-hover)]')}>
      <Icon size={16} strokeWidth={1.75} className={active ? 'text-[var(--accent)]' : 'text-[var(--text-2)]'} aria-hidden />
      <span className="flex-1 truncate">{label}</span>
      {badge}
    </button>
  );
}

export function ToolbarTab({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={cx('no-drag flex w-[76px] flex-col items-center gap-0.5 rounded-[7px] py-1.5 text-[11px] transition-colors duration-[var(--dur)]', active ? 'bg-[var(--sidebar-selected)] text-[var(--accent)]' : 'text-[var(--text-2)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]')}>
      <Icon size={20} strokeWidth={1.6} aria-hidden />
      <span className={active ? 'font-medium' : ''}>{label}</span>
    </button>
  );
}

export { cx };
