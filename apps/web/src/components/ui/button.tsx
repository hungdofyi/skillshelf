import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';
import { Tooltip } from './tooltip';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

// Disabled uses dedicated tokens instead of opacity, so a disabled primary never reads as a paler accent.
const variants: Record<Variant, string> = {
  primary: 'bg-accent-solid text-accent-fg hover:bg-accent-solid-hover',
  secondary: 'bg-raised text-fg shadow-raised hover:bg-raised-hover',
  ghost: 'bg-transparent text-muted hover:bg-hover hover:text-fg',
  danger: 'bg-danger-solid text-accent-fg hover:bg-danger-solid-hover',
};
const disabledLook: Record<Variant, string> = {
  primary: 'disabled:bg-disabled-bg disabled:text-disabled',
  secondary: 'disabled:bg-disabled-bg disabled:text-disabled disabled:shadow-none',
  ghost: 'disabled:text-disabled',
  danger: 'disabled:bg-disabled-bg disabled:text-disabled',
};
// The ::before strip grows the vertical hit area to 36/40px without touching layout.
const sizes: Record<Size, string> = { sm: 'h-7 px-2.5 gap-1.5 text-caption', md: 'h-8 px-3 gap-2 text-ui' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'fx press relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium before:absolute before:inset-x-0 before:-inset-y-1 disabled:pointer-events-none',
        variants[variant],
        // While loading the button keeps its colours; the spinner says "busy".
        !loading && disabledLook[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  /** Keyboard shortcut shown in the tooltip, e.g. "⌘B". */
  shortcut?: string;
  children: ReactNode;
  active?: boolean;
}

/** 32px icon-only button; the label doubles as tooltip and accessible name. Hit area extends to 36×40. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, children, active, className, type = 'button', ...rest },
  ref,
) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={clsx(
          'fx relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted before:absolute before:-inset-x-0.5 before:-inset-y-1 hover:bg-hover hover:text-fg active:bg-active disabled:pointer-events-none disabled:text-disabled',
          active && 'bg-active text-fg',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});
