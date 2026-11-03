import * as RT from '@radix-ui/react-tabs';
import { createContext, useContext, type ReactNode } from 'react';
import clsx from 'clsx';
import { MagneticLayers, MagneticProvider, useMagneticGroup, useMagneticHover } from './magnetic-indicator';

// The selected value, so each Tab knows whether it owns the shared underline (Radix keeps it internal).
const TabsValue = createContext<string | undefined>(undefined);

export function Tabs({ value, onValueChange, className, children }: { value: string; onValueChange: (v: string) => void; className?: string; children: ReactNode }) {
  return (
    <RT.Root value={value} onValueChange={onValueChange} className={className}>
      <TabsValue.Provider value={value}>{children}</TabsValue.Provider>
    </RT.Root>
  );
}

export function TabList({ children, className }: { children: ReactNode; className?: string }) {
  const { ctx, containerProps } = useMagneticGroup();
  // overflow-x-auto alone turns overflow-y to auto too, so any 1px spill shows a vertical scrollbar.
  // Clip y explicitly and hide the bar: narrow windows can still scroll the strip sideways.
  return (
    <MagneticProvider value={ctx}>
      <RT.List className={clsx('no-scrollbar isolate flex shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden', className)} {...containerProps}>
        {children}
      </RT.List>
    </MagneticProvider>
  );
}

/**
 * View switcher inside a document. A 2px underline glides to the selected tab and a soft highlight follows
 * the mouse (user decision: overrides the "no motion on frequent switches" default; keyboard switches snap).
 * Both layers sit inside the tab, so nothing spills below the strip's divider.
 */
export function Tab({ value, children, count }: { value: string; children: ReactNode; count?: number }) {
  const active = useContext(TabsValue) === value;
  const hover = useMagneticHover(value);
  return (
    <RT.Trigger
      value={value}
      {...hover}
      className="relative inline-flex h-10 shrink-0 items-center px-2 text-ui font-medium text-muted hover:text-fg data-[state=active]:text-fg"
    >
      <MagneticLayers
        value={value}
        active={active}
        hoverLayer={{ className: 'pointer-events-none absolute inset-x-0 top-1.5 bottom-1.5 bg-hover', style: { borderRadius: 6 } }}
        activeLayer={{ className: 'pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-fg' }}
      />
      <span className="relative z-10 inline-flex items-center gap-1.5">
        {children}
        {count !== undefined && <span className="tnum inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-hover px-1.5 text-micro text-muted">{count}</span>}
      </span>
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
