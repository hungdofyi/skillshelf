import type { ReactNode } from 'react';
import clsx from 'clsx';

/** Two-line sidebar row: icon and title, then a muted status line. The whole row is the hit target. */
export function SidebarListItem({ icon, title, meta, selected, onClick }: {
  icon: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'page' : undefined}
        onClick={onClick}
        className={clsx('flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left outline-offset-[-2px]', selected ? 'bg-accent-soft' : 'hover:bg-hover')}
      >
        <span className="mt-0.5 flex shrink-0 text-muted" aria-hidden>{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-fg">{title}</span>
          {meta && <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted">{meta}</span>}
        </span>
      </button>
    </li>
  );
}

/** Quiet one-line state for an empty or loading sidebar list. */
export const SidebarNote = ({ children }: { children: ReactNode }) => <p className="px-3 py-2 text-caption text-muted">{children}</p>;

/** Is `path` the item itself or something inside it? Used to highlight the row for the open document. */
export const isWithin = (activePath: string, itemPath: string) => activePath === itemPath || activePath.startsWith(`${itemPath}/`);
