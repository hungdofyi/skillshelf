import * as RT from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import clsx from 'clsx';

export const Tabs = RT.Root;

export function TabList({ children, className }: { children: ReactNode; className?: string }) {
  return <RT.List className={clsx('flex shrink-0 items-center gap-1 overflow-x-auto', className)}>{children}</RT.List>;
}

/** View switcher inside a document. Switching is a frequent action, so the indicator moves without animation. */
export function Tab({ value, children, count }: { value: string; children: ReactNode; count?: number }) {
  return (
    <RT.Trigger
      value={value}
      className="relative -mb-px inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2 text-ui font-medium text-muted hover:text-fg data-[state=active]:border-fg data-[state=active]:text-fg"
    >
      {children}
      {count !== undefined && <span className="tnum inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-hover px-1.5 text-micro text-muted">{count}</span>}
    </RT.Trigger>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RT.Content value={value} className={clsx('min-h-0 flex-1 overflow-y-auto focus-visible:-outline-offset-2', className)}>
      {children}
    </RT.Content>
  );
}
