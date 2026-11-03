import { useLayoutEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight, Ellipsis } from 'lucide-react';
import { navigate } from '../lib/location-state';
import { DropdownMenu } from '../components/ui/menu';

// Ancestors truncate past this width so one long slug cannot eat the whole bar.
const ANCESTOR_MAX = 'max-w-[14rem]';
// The current crumb always gets at least this much (or its natural width, if shorter) before ancestors are kept.
const CURRENT_MIN_PX = 160;
const CRUMB_BTN = 'fx min-w-0 truncate rounded px-1 py-0.5 hover:bg-hover hover:text-fg';

/**
 * Which crumbs fit beside a minimum-width current crumb. `kept` = ancestors (counted back from the current
 * crumb's parent) that stay visible; `showRoot` = whether `Library` stays visible too. When even
 * `Library › … › current` is too wide, Library folds into the `…` menu as well so the current crumb keeps room.
 * Everything shows when the whole path fits unabridged.
 * `widths` = natural widths [Library, ...ancestors, current, ellipsis], each including its chevron.
 */
export function fitCrumbs(available: number, widths: number[]): { kept: number; showRoot: boolean } {
  const [libraryW = 0] = widths;
  const ellipsisW = widths.at(-1) ?? 0;
  const currentW = widths.at(-2) ?? 0;
  const ancestors = widths.slice(1, -2);
  const total = libraryW + ancestors.reduce((a, b) => a + b, 0) + currentW;
  if (total <= available) return { kept: ancestors.length, showRoot: true };
  const currentMin = Math.min(currentW, CURRENT_MIN_PX);
  if (available < libraryW + ellipsisW + currentMin) return { kept: 0, showRoot: false };
  let budget = available - libraryW - ellipsisW - currentMin;
  let kept = 0;
  for (let i = ancestors.length - 1; i >= 0 && (ancestors[i] ?? 0) <= budget; i--) {
    budget -= ancestors[i] ?? 0;
    kept++;
  }
  return { kept, showRoot: true };
}

/**
 * Clickable path crumbs; the last segment is the current location. When the bar is too narrow the
 * middle crumbs fold into a `…` dropdown (Library and the current crumb always stay, plus as many
 * nearest ancestors as fit); the current crumb truncates last. As a bar it owns a row under the tab
 * bar; `inline` drops the row chrome so a toolbar (the file editor's) can host it.
 */
export function Breadcrumb({ path, inline }: { path: string; inline?: boolean }) {
  const parts = path.split('/').filter(Boolean);
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  // Crumbs kept visible; null until measured, which renders the full path once.
  const [fit, setFit] = useState<{ kept: number; showRoot: boolean } | null>(null);

  // Re-measure on width change and whenever the path changes. A hidden clone of the full path gives the
  // natural crumb widths, so the decision never depends on what is currently collapsed (no flicker loop).
  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure) return;
    const run = () => {
      const widths = Array.from(measure.children, (c) => (c as HTMLElement).getBoundingClientRect().width + 2);
      const next = fitCrumbs(nav.clientWidth - 1, widths);
      setFit((prev) => (prev && prev.kept === next.kept && prev.showRoot === next.showRoot ? prev : next));
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [path]);

  const ancestors = parts.slice(0, -1);
  const current = parts[parts.length - 1];
  const showRoot = fit?.showRoot ?? true;
  const keepCount = fit?.kept ?? ancestors.length;
  const hidden = ancestors.slice(0, ancestors.length - keepCount);
  const shown = ancestors.slice(ancestors.length - keepCount);
  const folded = hidden.length + (showRoot ? 0 : 1);
  const toPath = (i: number) => parts.slice(0, i + 1).join('/');

  const chevron = <ChevronRight size={12} className="shrink-0 text-faint" aria-hidden />;
  const ancestorCrumb = (p: string, i: number) => (
    <span key={toPath(i)} className="flex min-w-0 shrink-0 items-center gap-0.5">
      {chevron}
      <button className={clsx(CRUMB_BTN, ANCESTOR_MAX)} title={p} onClick={() => navigate(toPath(i))}>{p}</button>
    </span>
  );
  const currentCrumb = current !== undefined && (
    <span className="flex min-w-0 items-center gap-0.5">
      {chevron}
      <span className="truncate px-1 font-medium text-fg" aria-current="page" title={current}>{current}</span>
    </span>
  );
  const ellipsisTrigger = (
    <button className="fx shrink-0 rounded px-1 py-0.5 hover:bg-hover hover:text-fg" aria-label={`Show ${folded} hidden path levels`} title="Show full path">
      <Ellipsis size={14} aria-hidden />
    </button>
  );

  return (
    // Standalone bar = the editor toolbar's height (h-10) and inset (px-4): the top bar never changes height or
    // shifts the page when switching between a book/skill view and a file. `relative` anchors the hidden measuring row.
    <nav
      ref={navRef}
      aria-label="Breadcrumb"
      className={clsx('relative flex w-full min-w-0 items-center gap-0.5 overflow-hidden text-caption text-muted', !inline && 'hairline-b h-10 shrink-0 px-4')}
    >
      {showRoot && <button className="fx shrink-0 rounded px-1 py-0.5 hover:bg-hover hover:text-fg" onClick={() => navigate('')}>Library</button>}
      {folded > 0 && (
        <span className="flex shrink-0 items-center gap-0.5">
          {showRoot && chevron}
          <DropdownMenu
            align="start"
            trigger={ellipsisTrigger}
            items={[
              ...(showRoot ? [] : [{ label: 'Library', onSelect: () => navigate('') }]),
              ...hidden.map((p, i) => ({ label: p, onSelect: () => navigate(toPath(i)) })),
            ]}
          />
        </span>
      )}
      {shown.map((p, i) => ancestorCrumb(p, hidden.length + i))}
      {currentCrumb}

      {/* Off-screen natural-width clone: [Library, ...ancestors, current, ellipsis]. Never visible or announced. */}
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex h-0 items-center gap-0.5 overflow-hidden whitespace-nowrap" style={{ width: 'max-content' }}>
        <span className="shrink-0 px-1">Library</span>
        {ancestors.map((p, i) => (
          <span key={toPath(i)} className="flex shrink-0 items-center gap-0.5">
            <ChevronRight size={12} />
            <span className={clsx('truncate px-1', ANCESTOR_MAX)}>{p}</span>
          </span>
        ))}
        {current !== undefined && (
          <span className="flex shrink-0 items-center gap-0.5">
            <ChevronRight size={12} />
            <span className="px-1 font-medium">{current}</span>
          </span>
        )}
        <span className="flex shrink-0 items-center gap-0.5"><ChevronRight size={12} /><span className="px-1"><Ellipsis size={14} /></span></span>
      </div>
    </nav>
  );
}
