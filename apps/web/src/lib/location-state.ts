import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * URL <-> UI state: `?path=<library path>&tab=<skill tab>`. Reload and back/forward restore the
 * selection; MCP search results link to `/?path=...` and open the same item.
 * Navigation away from unsaved editors asks for confirmation.
 */

const NAV_EVENT = 'b2s:navigate';
const dirtySources = new Set<string>();
const dirtyListeners = new Set<() => void>();
let dirtySnapshot: readonly string[] = [];

function emitDirty(): void {
  dirtySnapshot = [...dirtySources];
  dirtyListeners.forEach((l) => l());
}

export function setDirtySource(id: string, dirty: boolean): void {
  if (dirty === dirtySources.has(id)) return;
  if (dirty) dirtySources.add(id);
  else dirtySources.delete(id);
  emitDirty();
}

/**
 * Library paths with unsaved edits. Source ids look like "editor:<path>" or "evals:<path>",
 * so the path is everything after the first colon.
 */
export function useDirtyPaths(): readonly string[] {
  const ids = useSyncExternalStore(
    (cb) => {
      dirtyListeners.add(cb);
      return () => dirtyListeners.delete(cb);
    },
    () => dirtySnapshot,
  );
  return ids.map((id) => id.slice(id.indexOf(':') + 1));
}

/** True when `path` or anything inside it has unsaved edits. */
export const hasDirtyUnder = (dirty: readonly string[], path: string) => dirty.some((d) => d === path || d.startsWith(`${path}/`));
const isDirty = () => dirtySources.size > 0;
const confirmDiscard = () => window.confirm('You have unsaved changes. Discard them?');

/** Mark an editor as dirty while mounted; clears automatically on unmount. */
export function useDirtyGuard(id: string, dirty: boolean): void {
  useEffect(() => {
    setDirtySource(id, dirty);
    return () => setDirtySource(id, false);
  }, [id, dirty]);
}

const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
};
const getSearch = () => window.location.search;

export interface LocationState {
  path: string;
  tab: string | null;
  /** An eval run to preselect (the Revise tab uses it to pick the run's failed cases). */
  run: string | null;
}

export function useLocationState(): LocationState {
  const search = useSyncExternalStore(subscribe, getSearch, () => '');
  const sp = new URLSearchParams(search);
  return { path: sp.get('path') ?? '', tab: sp.get('tab'), run: sp.get('run') };
}

/** Navigate to a library path (optionally a tab). Returns false if the user declined to discard edits. */
export function navigate(path: string, opts?: { tab?: string; run?: string; replace?: boolean; force?: boolean }): boolean {
  if (!opts?.force && isDirty() && !confirmDiscard()) return false;
  if (isDirty()) {
    dirtySources.clear();
    emitDirty();
  }
  const sp = new URLSearchParams();
  if (path) sp.set('path', path);
  if (opts?.tab) sp.set('tab', opts.tab);
  if (opts?.run) sp.set('run', opts.run);
  const url = sp.size ? `/?${sp.toString()}` : '/';
  if (opts?.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(NAV_EVENT));
  return true;
}

/** Change only the tab, keeping the current path. */
export function setTab(tab: string): void {
  const path = new URLSearchParams(window.location.search).get('path') ?? '';
  navigate(path, { tab, replace: true });
}

/** Warn on tab close / reload while edits are unsaved, and guard browser back/forward. */
export function useNavigationGuards(): void {
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty()) return;
      e.preventDefault();
    };
    let lastUrl = window.location.href;
    const onPop = () => {
      if (isDirty() && !confirmDiscard()) {
        window.history.pushState(null, '', lastUrl);
        window.dispatchEvent(new Event(NAV_EVENT));
        return;
      }
      dirtySources.clear();
      emitDirty();
      lastUrl = window.location.href;
    };
    const onNav = () => {
      lastUrl = window.location.href;
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', onPop);
    window.addEventListener(NAV_EVENT, onNav);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener(NAV_EVENT, onNav);
    };
  }, []);
}

export function useNavigate() {
  return useCallback(navigate, []);
}
