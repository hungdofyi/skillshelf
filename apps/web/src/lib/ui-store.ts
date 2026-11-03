import { useSyncExternalStore } from 'react';

/** Document view mode, remembered across files and reloads (non-previewable files always open in Edit). */
export type EditorMode = 'preview' | 'edit' | 'split';
const EDITOR_MODES: readonly EditorMode[] = ['preview', 'edit', 'split'];

/** What the left rail shows in the sidebar. */
export type RailView = 'library' | 'books' | 'skills' | 'evals' | 'search' | 'activity';
export const RAIL_VIEWS: readonly RailView[] = ['library', 'books', 'skills', 'evals', 'search', 'activity'];

/** Tiny cross-component UI state (shell panels, dialogs) without a state library. */
interface UiState {
  rail: RailView;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  editorMode: EditorMode;
  jobsOpen: boolean;
  selectedJobId: string | null;
  connectOpen: boolean;
  createSkillFor: string | null | false; // book slug to preselect, null = none, false = closed
  summarizeFor: string | false; // book slug being summarized, false = closed
  /** Bumped by ⌘K / ⌘P so the quick-open field focuses even when it is already showing. */
  searchFocus: number;
  /** True when the last panel toggle came from the keyboard: keyboard toggles never animate. */
  instantPanels: boolean;
}

const STORE_KEY = 'b2s-shell';
type Persisted = Pick<UiState, 'rail' | 'sidebarOpen' | 'inspectorOpen' | 'editorMode'>;

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Partial<Persisted>;
    return {
      ...(v.rail && RAIL_VIEWS.includes(v.rail) ? { rail: v.rail } : {}),
      ...(typeof v.sidebarOpen === 'boolean' ? { sidebarOpen: v.sidebarOpen } : {}),
      ...(typeof v.inspectorOpen === 'boolean' ? { inspectorOpen: v.inspectorOpen } : {}),
      ...(v.editorMode && EDITOR_MODES.includes(v.editorMode) ? { editorMode: v.editorMode } : {}),
    };
  } catch {
    return {};
  }
}

// First run: the inspector starts open only where the main column keeps room to read.
const wide = typeof window !== 'undefined' && window.innerWidth >= 1280;
let state: UiState = {
  rail: 'library',
  sidebarOpen: true,
  inspectorOpen: wide,
  editorMode: 'preview',
  jobsOpen: false,
  selectedJobId: null,
  connectOpen: false,
  createSkillFor: false,
  summarizeFor: false,
  searchFocus: 0,
  instantPanels: false,
  ...loadPersisted(),
};
const listeners = new Set<() => void>();

export function setUi(patch: Partial<UiState>): void {
  state = { ...state, instantPanels: false, ...patch };
  listeners.forEach((l) => l());
  if ('rail' in patch || 'sidebarOpen' in patch || 'inspectorOpen' in patch || 'editorMode' in patch) {
    try {
      const { rail, sidebarOpen, inspectorOpen, editorMode } = state;
      localStorage.setItem(STORE_KEY, JSON.stringify({ rail, sidebarOpen, inspectorOpen, editorMode }));
    } catch {
      /* storage unavailable: layout just won't persist */
    }
  }
}

export function useUi<T>(select: (s: UiState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => select(state),
  );
}

export const getUi = () => state;
export const openJob = (id: string) => setUi({ jobsOpen: true, selectedJobId: id });
export const openSummarize = (bookSlug: string) => setUi({ summarizeFor: bookSlug });
export const openCreateSkill = (bookSlug: string | null = null) => setUi({ createSkillFor: bookSlug });

/** Rail click: switch the sidebar view, or collapse the sidebar when the active view is clicked again. */
export function selectRail(view: RailView, opts?: { keyboard?: boolean }): void {
  const toggleOff = state.rail === view && state.sidebarOpen;
  setUi({ rail: view, sidebarOpen: !toggleOff, instantPanels: !!opts?.keyboard });
}

export function openQuickOpen(): void {
  setUi({ rail: 'search', sidebarOpen: true, searchFocus: state.searchFocus + 1, instantPanels: true });
}
