import { useSyncExternalStore } from 'react';
import { navigate } from './location-state';

/**
 * Document tabs. One rule: every item you open gets its own tab, placed right of the tab you were
 * on; opening something that already has a tab switches to it. The active tab is always the
 * `?path=` in the URL; this store only remembers which paths are open and in what order.
 */
const STORE_KEY = 'b2s-open-tabs';
const listeners = new Set<() => void>();

function load(): readonly string[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const v = raw ? (JSON.parse(raw) as { paths?: unknown }) : null;
    return Array.isArray(v?.paths) ? v.paths.filter((p): p is string => typeof p === 'string' && p.length > 0) : [];
  } catch {
    return [];
  }
}

let paths: readonly string[] = load();

function commit(next: readonly string[]): void {
  paths = next;
  listeners.forEach((l) => l());
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ paths }));
  } catch {
    /* storage unavailable: tabs just won't survive a reload */
  }
}

export function useOpenTabs(): readonly string[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => paths,
  );
}

/** Called for every navigation. `after` is the tab the user was on, so the new tab opens to its right. */
export function openTab(path: string, after: string | null): void {
  if (!path || paths.includes(path)) return;
  const at = after ? paths.indexOf(after) + 1 : 0;
  const next = [...paths];
  next.splice(at > 0 ? at : paths.length, 0, path);
  commit(next);
}

/**
 * Close a tab. Closing the active one moves to its right neighbour (else the left one); when the
 * user declines to discard unsaved edits the tab stays. Returns whether it closed.
 */
export function closeTab(path: string, activePath: string): boolean {
  const i = paths.indexOf(path);
  if (i < 0) return false;
  if (path === activePath && !navigate(paths[i + 1] ?? paths[i - 1] ?? '')) return false;
  commit(paths.filter((p) => p !== path));
  return true;
}

/** Keep only `keep`, or `keep` and everything left of it. Moves to `keep` if the active tab goes. */
export function closeOtherTabs(keep: string, activePath: string, side: 'others' | 'right'): void {
  const i = paths.indexOf(keep);
  if (i < 0) return;
  const next = side === 'others' ? [keep] : paths.slice(0, i + 1);
  if (!next.includes(activePath) && !navigate(keep)) return;
  commit(next);
}

/** Drop tabs whose files no longer exist (deleted or renamed outside the app). */
export function pruneTabs(exists: (path: string) => boolean, activePath: string): void {
  const kept = paths.filter((p) => p === activePath || exists(p));
  if (kept.length !== paths.length) commit(kept);
}
