import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { navigate } from '../lib/location-state';

/**
 * Clickable path crumbs; the last segment is the current location. As a bar it owns a row under
 * the tab bar; `inline` drops the row chrome so a toolbar (the file editor's) can host it.
 */
export function Breadcrumb({ path, inline }: { path: string; inline?: boolean }) {
  const parts = path.split('/').filter(Boolean);
  return (
    // Standalone bar = the editor toolbar's height (h-10) and inset (px-4): the top bar never changes height or
    // shifts the page when switching between a book/skill view and a file.
    <nav aria-label="Breadcrumb" className={clsx('flex min-w-0 items-center gap-0.5 overflow-hidden text-caption text-muted', !inline && 'hairline-b h-10 shrink-0 px-4')}>
      <button className="fx shrink-0 rounded px-1 py-0.5 hover:bg-hover hover:text-fg" onClick={() => navigate('')}>Library</button>
      {parts.map((p, i) => {
        const to = parts.slice(0, i + 1).join('/');
        const last = i === parts.length - 1;
        return (
          <span key={to} className={clsx('flex items-center gap-0.5', last ? 'min-w-0' : 'shrink-0')}>
            <ChevronRight size={12} className="shrink-0 text-faint" aria-hidden />
            {last ? (
              <span className="truncate px-1 font-medium text-fg" aria-current="page" title={p}>{p}</span>
            ) : (
              <button className="fx rounded px-1 py-0.5 hover:bg-hover hover:text-fg" onClick={() => navigate(to)}>{p}</button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
