import * as CM from '@radix-ui/react-context-menu';
import * as DM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import clsx from 'clsx';

// Content is 8px round with 4px padding, so items are 4px round (concentric radii).
const contentCls = 'anim-menu z-(--z-popover) min-w-[184px] max-w-[280px] overflow-y-auto rounded-lg bg-raised p-1 text-ui shadow-pop';
const itemCls =
  'flex h-7 cursor-default select-none items-center gap-2 rounded px-2 text-fg outline-none data-[disabled]:text-muted data-[highlighted]:bg-hover data-[variant=danger]:text-danger';

export interface MenuItemSpec {
  label: string;
  icon?: ReactNode;
  /** Omit for a read-only line (shown, never highlighted). */
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a separator before this item. */
  separated?: boolean;
  checked?: boolean;
  /** Indent one level (sub-headings in an outline menu). */
  inset?: boolean;
}

/** Context menu around `children` (a single element that receives the right-click). */
export function ContextMenu({ items, children }: { items: MenuItemSpec[]; children: ReactNode }) {
  return (
    <CM.Root>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className={contentCls} collisionPadding={8}>
          {items.map((it, i) => (
            <div key={`${i}-${it.label}`} className="contents">
              {it.separated && <CM.Separator className="my-1 h-px bg-line" />}
              <CM.Item className={itemCls} data-variant={it.danger ? 'danger' : undefined} disabled={it.disabled || !it.onSelect} onSelect={it.onSelect}>
                <span className="flex size-4 items-center justify-center text-muted" aria-hidden>{it.icon}</span>
                {it.label}
              </CM.Item>
            </div>
          ))}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

export function DropdownMenu({ trigger, items, align = 'end', side = 'bottom' }: { trigger: ReactNode; items: MenuItemSpec[]; align?: 'start' | 'end'; side?: 'bottom' | 'right' | 'top' }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className={clsx(contentCls, 'max-h-(--radix-dropdown-menu-content-available-height)')} align={align} side={side} sideOffset={6} collisionPadding={8}>
          {items.map((it, i) => (
            <div key={`${i}-${it.label}`} className="contents">
              {it.separated && <DM.Separator className="my-1 h-px bg-line" />}
              <DM.Item className={clsx(itemCls, it.inset && 'pl-5')} data-variant={it.danger ? 'danger' : undefined} disabled={it.disabled || !it.onSelect} onSelect={it.onSelect}>
                <span className="flex size-4 shrink-0 items-center justify-center text-muted" aria-hidden>{it.icon}</span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.checked && <span className="size-1.5 shrink-0 rounded-full bg-fg" aria-label="Selected" />}
              </DM.Item>
            </div>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
