import * as RT from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

// Radix keeps the group "warm" for skipDelayDuration: the next tooltip opens instantly and unanimated.
export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <RT.Provider delayDuration={400} skipDelayDuration={300}>
    {children}
  </RT.Provider>
);

export function Tooltip({ label, shortcut, children, side = 'bottom' }: { label: ReactNode; shortcut?: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content
          side={side}
          sideOffset={6}
          className="anim-tooltip z-(--z-popover) flex max-w-xs items-center gap-2 rounded-md bg-fg px-2 py-1 text-caption text-bg shadow-pop"
        >
          {label}
          {shortcut && <kbd className="font-sans text-micro opacity-70">{shortcut}</kbd>}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
