/**
 * Secondary navigation for a document (e.g. a skill's reference files). It mirrors the Markdown outline so a page
 * keeps one structure: the centred page column, with navigation floating at the pane edges instead of taking
 * columns of its own.
 *
 * - SideNavList: overlay on the pane's left edge (outline is on the right; same offsets, same 1120px
 *   container breakpoint). Mounted in every view mode: Preview and Edit keep their content in the centred
 *   page column, Split starts after the list, so it never covers content.
 * - SideNavMenu: the toolbar fallback, only when the pane is too narrow for the overlay (all modes alike).
 */
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { DropdownMenu } from '../ui/menu';

export interface SideNav {
  label: string;
  items: Array<{ key: string; label: string; current: boolean; onSelect: () => void }>;
}

export function SideNavList({ nav }: { nav: SideNav }) {
  return (
    <nav aria-label={nav.label} className="absolute left-6 top-8 hidden max-h-[calc(100%-4rem)] w-52 overflow-y-auto @min-[1120px]:block">
      <p className="mb-1.5 px-2 text-caption font-semibold text-muted">{nav.label}</p>
      <ul className="flex flex-col">
        {nav.items.map((it) => (
          <li key={it.key}>
            <button
              type="button"
              title={it.label}
              aria-current={it.current ? 'page' : undefined}
              onClick={it.onSelect}
              className={clsx('fx block w-full truncate rounded px-2 py-1 text-left text-caption leading-snug', it.current ? 'bg-hover text-fg' : 'text-muted hover:text-fg')}
            >
              {it.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SideNavMenu({ nav }: { nav: SideNav }) {
  const current = nav.items.find((it) => it.current);
  return (
    <DropdownMenu
      align="start"
      items={nav.items.map((it) => ({ label: it.label, checked: it.current, onSelect: it.onSelect }))}
      trigger={
        <Button size="sm" variant="ghost" aria-label={`${nav.label}: ${current?.label ?? 'choose'}`}>
          <span className="max-w-48 truncate">{current?.label ?? nav.label}</span>
          <ChevronDown size={13} aria-hidden className="text-muted" />
        </Button>
      }
    />
  );
}
