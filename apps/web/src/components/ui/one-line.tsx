import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useHorizontalOverflow } from './use-horizontal-overflow';

/**
 * Hover control that pages a one-line strip sideways. Wheel, trackpad and keyboard scroll the strip
 * too, so this only ever adds a shortcut for mouse users; it is hidden on touch.
 */
export function ScrollNudge({ side, onClick, groupClass, small }: { side: 'left' | 'right'; onClick: () => void; groupClass: string; small?: boolean }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={side === 'left' ? 'Scroll left' : 'Scroll right'}
      onClick={onClick}
      className={clsx(
        'fx absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md bg-raised text-muted opacity-0 shadow-raised hover:text-fg [@media(hover:none)]:hidden',
        small ? 'size-5' : 'size-7',
        side === 'left' ? 'left-1' : 'right-1',
        groupClass,
      )}
    >
      <Icon size={small ? 12 : 15} aria-hidden />
    </button>
  );
}

/**
 * One line of text that never wraps, never shows a scrollbar and never truncates with an ellipsis:
 * when it is longer than its box, the overflowing edge fades out (eased mask) and the line scrolls
 * sideways with the wheel, trackpad or arrow keys, with hover nudges for a mouse. Use it for
 * commands, URLs, paths and ids people need to read in full. Labels that only need recognising
 * (tabs, menu items, tree rows) keep `truncate` with a title instead.
 */
export function OneLine({ children, className, label, nudges = true }: { children: ReactNode; className?: string; label?: string; nudges?: boolean }) {
  const strip = useHorizontalOverflow<HTMLSpanElement>(children);
  const overflowing = strip.canLeft || strip.canRight;
  return (
    <span className={clsx('group/line relative flex min-w-0 items-center', className)}>
      <span
        ref={strip.ref}
        aria-label={label}
        // Focusable only when there is something to scroll to, so arrow keys can reach the hidden part.
        tabIndex={overflowing ? 0 : undefined}
        title={typeof children === 'string' ? children : undefined}
        className="no-scrollbar block min-w-0 flex-1 overflow-x-auto whitespace-nowrap outline-offset-0"
        style={{ maskImage: strip.mask, WebkitMaskImage: strip.mask }}
      >
        {children}
      </span>
      {nudges && strip.canLeft && <ScrollNudge small side="left" groupClass="group-hover/line:opacity-100" onClick={() => strip.page(-1)} />}
      {nudges && strip.canRight && <ScrollNudge small side="right" groupClass="group-hover/line:opacity-100" onClick={() => strip.page(1)} />}
    </span>
  );
}
