import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';

export const Spinner = ({ size = 14, className }: { size?: number; className?: string }) => (
  <Loader2 size={size} className={clsx('spin text-muted', className)} aria-label="Loading" />
);

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-muted">
      <Spinner />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-6 py-16 text-center">
      {icon && <div className="mb-1 text-faint">{icon}</div>}
      <h2 className="text-body font-semibold">{title}</h2>
      {children && <p className="text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, title = 'Could not load this', action }: { error: unknown; title?: string; action?: ReactNode }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-14 text-center">
      <AlertTriangle size={20} className="text-danger" aria-hidden />
      <h2 className="text-body font-semibold">{title}</h2>
      <p className="break-words text-muted">{message}</p>
      {action}
    </div>
  );
}

// Inputs keep a real border: it marks the field edge and is part of its accessible affordance.
const fieldBase =
  'fx w-full rounded-md border border-line-strong bg-surface px-2.5 text-ui text-fg placeholder:text-faint hover:border-[color-mix(in_oklch,var(--line-strong),var(--fg)_20%)] disabled:bg-disabled-bg disabled:text-disabled';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={clsx(fieldBase, 'h-8', className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={clsx(fieldBase, 'min-h-[72px] resize-y py-1.5 leading-relaxed', className)} {...p} />;
});
/** Native select (keyboard and screen-reader behaviour for free) with the field's own chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return (
    <span className="relative flex">
      <select ref={ref} className={clsx(fieldBase, 'h-8 appearance-none pr-8', className)} {...p} />
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
    </span>
  );
});

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-caption font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? <p className="text-caption text-danger">{error}</p> : hint ? <p className="text-caption text-faint">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx('flex cursor-pointer items-center gap-2 text-ui', disabled && 'pointer-events-none text-disabled')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
      {children}
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md bg-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'fx h-6 rounded px-2.5 text-caption font-medium',
            o.value === value ? 'bg-surface text-fg shadow-[0_0_0_0.5px_var(--line-strong)]' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, indeterminate, tone = 'accent' }: { value?: number; indeterminate?: boolean; tone?: 'accent' | 'ok' | 'danger' }) {
  const color = { accent: 'bg-accent', ok: 'bg-ok', danger: 'bg-danger' }[tone];
  // Fill moves with transform (scaleX), never width, so progress ticks stay on the compositor.
  const fraction = Math.min(1, Math.max(0, value ?? 0));
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-active" role="progressbar" aria-valuenow={indeterminate ? undefined : Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
      {indeterminate ? (
        <div className={clsx('absolute inset-y-0 left-0 w-2/5 rounded-full', color)} style={{ animation: 'indeterminate 1.4s var(--ease-move) infinite' }} />
      ) : (
        <div className={clsx('h-full w-full origin-left rounded-full transition-transform duration-200 ease-out', color)} style={{ transform: `scaleX(${fraction})` }} />
      )}
    </div>
  );
}

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent';
const tones: Record<Tone, string> = {
  neutral: 'bg-hover text-muted',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-accent-soft text-accent',
};
export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-micro font-medium', tones[tone], className)}>{children}</span>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-7 items-center justify-between gap-3">
      <h3 className="text-caption font-semibold text-muted">{children}</h3>
      {aside}
    </div>
  );
}
