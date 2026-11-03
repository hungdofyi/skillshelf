import { useEffect, useMemo } from 'react';
import clsx from 'clsx';
import { AnimatePresence, LazyMotion, m, useReducedMotion } from 'motion/react';
import { Copy, PanelRight, X } from 'lucide-react';
import { toast } from 'sonner';
import type { TreeNode } from '@b2s/shared';
import { useTree } from '../../api/queries';
import { copyText } from '../../lib/format';
import { hasDirtyUnder, navigate, useDirtyPaths } from '../../lib/location-state';
import { closeOtherTabs, closeTab, useOpenTabs } from '../../lib/open-tabs-store';
import { basename, dirname, findNode } from '../../lib/route';
import { setUi, useUi } from '../../lib/ui-store';
import { shortcutLabels } from '../../lib/use-global-shortcuts';
import { IconButton } from '../ui/button';
import { ContextMenu } from '../ui/menu';
import { NodeIcon } from '../tree/tree-row';
import { useHorizontalOverflow } from '../ui/use-horizontal-overflow';
import { ScrollNudge } from '../ui/one-line';

// Tabs arrive with a short fade and scale from 0.96, leave faster, and neighbours slide into the gap.
const ENTER = { duration: 0.18, ease: [0.32, 0.72, 0, 1] as const };
const EXIT = { duration: 0.12, ease: [0.4, 0, 1, 1] as const };
const MOVE = { duration: 0.2, ease: [0.645, 0.045, 0.355, 1] as const };
// Active underline moving between tabs: spring without bounce, interruptible (matches Tabs/Segmented).
const UNDERLINE = { type: 'spring', duration: 0.25, bounce: 0 } as const;

const loadMotionFeatures = () => import('./motion-features').then((r) => r.default);

// Before the tree loads (or for a path that vanished) the tab still needs an icon.
const fallbackNode = (path: string): TreeNode => ({ name: basename(path), path, type: 'file' });

/**
 * IDE-style document tabs. Every item you open gets its own tab, right of the current one; opening
 * something that is already open switches to its tab. Switching is instant; opening and closing animate.
 */
export function DocumentTabs({ activePath }: { activePath: string }) {
  const paths = useOpenTabs();
  const { data: tree } = useTree();
  const dirty = useDirtyPaths();
  const inspectorOpen = useUi((s) => s.inspectorOpen);
  const reduce = useReducedMotion();
  const strip = useHorizontalOverflow<HTMLDivElement>(paths, { wheel: true });

  useEffect(() => {
    strip.ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activePath, strip.ref]);

  // Same file name open twice (a skill and its eval folder): show the parent folder too.
  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    paths.forEach((p) => seen.set(basename(p), (seen.get(basename(p)) ?? 0) + 1));
    return seen;
  }, [paths]);

  return (
    <div className="hairline-b flex h-10 shrink-0 items-stretch bg-panel">
      <div className="group/strip relative flex min-w-0 flex-1">
      <div
        ref={strip.ref}
        role="tablist"
        aria-label="Open documents"
        className="no-scrollbar flex min-w-0 flex-1 items-stretch overflow-x-auto"
        style={{ maskImage: strip.mask, WebkitMaskImage: strip.mask }}
        onKeyDown={(e) => {
          // Tablist keyboard pattern: arrows move focus between tabs, Enter or Space opens one.
          const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
          const i = tabs.indexOf(document.activeElement as HTMLElement);
          if (i < 0) return;
          const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
          if (to === null) return;
          e.preventDefault();
          tabs[(to + tabs.length) % tabs.length]?.focus();
        }}
      >
        {paths.length === 0 && <p className="flex items-center px-4 text-caption text-muted">Items you open from the sidebar appear here as tabs.</p>}
        <LazyMotion features={loadMotionFeatures} strict>
        <AnimatePresence initial={false} mode="popLayout">
          {paths.map((p, i) => {
            const active = p === activePath;
            const isDirty = hasDirtyUnder(dirty, p);
            const node = findNode(tree?.root, p) ?? fallbackNode(p);
            const name = basename(p);
            return (
              <m.div
                key={p}
                layout="position"
                initial={reduce ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1, transition: reduce ? { duration: 0 } : ENTER }}
                exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.96, transition: EXIT }}
                transition={reduce ? { duration: 0 } : { layout: MOVE }}
                className="shrink-0"
              >
                <ContextMenu items={[
                  { label: 'Close tab', icon: <X size={14} />, onSelect: () => closeTab(p, activePath) },
                  { label: 'Close other tabs', onSelect: () => closeOtherTabs(p, activePath, 'others'), disabled: paths.length < 2 },
                  { label: 'Close tabs to the right', onSelect: () => closeOtherTabs(p, activePath, 'right'), disabled: i === paths.length - 1 },
                  { label: 'Copy path', icon: <Copy size={14} />, separated: true, onSelect: async () => { if (await copyText(p)) toast.success('Path copied', { duration: 1500 }); } },
                ]}>
                  <div
                    className={clsx(
                      'group hairline-r relative flex h-full max-w-60 items-center',
                      active ? 'bg-surface text-fg' : 'text-muted hover:bg-hover hover:text-fg',
                    )}
                    onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(p, activePath); } }}
                    onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                  >
                    {/* The active tab joins the document below: its bottom edge covers the bar's hairline. */}
                    {active && <span aria-hidden className="absolute inset-x-0 -bottom-px h-px bg-surface" />}
                    {/* Active underline: one shared element that glides to the newly active tab (same spring as Tabs). */}
                    {active && (
                      <m.span
                        aria-hidden
                        layoutId="document-tab-underline"
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-fg"
                        transition={{ layout: reduce ? { duration: 0 } : UNDERLINE }}
                      />
                    )}
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      tabIndex={active || (!activePath && i === 0) ? 0 : -1}
                      title={p}
                      onClick={() => navigate(p)}
                      className="flex h-full min-w-0 items-center gap-1.5 pl-3 pr-1 text-ui outline-offset-[-2px]"
                    >
                      <NodeIcon node={node} open={false} />
                      <span className="truncate">{name}</span>
                      {(dupes.get(name) ?? 0) > 1 && <span className="truncate text-caption text-faint">{basename(dirname(p))}</span>}
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={isDirty ? `Close ${name} (unsaved changes)` : `Close ${name}`}
                      title={`Close (${shortcutLabels.closeTab}, or middle-click the tab)`}
                      onClick={() => closeTab(p, activePath)}
                      className={clsx(
                        'fx relative mr-1.5 flex size-5 shrink-0 items-center justify-center rounded text-muted before:absolute before:-inset-x-2 before:-inset-y-2.5 hover:bg-active hover:text-fg',
                        !active && !isDirty && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
                      )}
                    >
                      {isDirty ? (
                        <>
                          <span aria-hidden className="size-2 rounded-full bg-fg group-hover:hidden" />
                          <X size={13} aria-hidden className="hidden group-hover:block" />
                        </>
                      ) : (
                        <X size={13} aria-hidden />
                      )}
                    </button>
                  </div>
                </ContextMenu>
              </m.div>
            );
          })}
        </AnimatePresence>
        </LazyMotion>
      </div>
      {/* Hover affordances for overflow; wheel, trackpad and keyboard focus scroll the strip too. */}
      {strip.canLeft && <ScrollNudge side="left" groupClass="group-hover/strip:opacity-100" onClick={() => strip.page(-1)} />}
      {strip.canRight && <ScrollNudge side="right" groupClass="group-hover/strip:opacity-100" onClick={() => strip.page(1)} />}
      </div>
      <div className="flex shrink-0 items-center px-1.5">
        <IconButton label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} shortcut={shortcutLabels.inspector} active={inspectorOpen} aria-pressed={inspectorOpen} onClick={() => setUi({ inspectorOpen: !inspectorOpen })}>
          <PanelRight size={16} />
        </IconButton>
      </div>
    </div>
  );
}
