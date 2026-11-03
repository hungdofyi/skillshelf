import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { Activity, BookOpen, Copy, FlaskConical, FolderTree, Monitor, Moon, Plug, RefreshCw, Search, Settings, Sun, Zap, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useClaudeStatus, useJobs, useTree } from '../../api/queries';
import { abbreviateHome, copyText } from '../../lib/format';
import { useTheme, type ThemeChoice } from '../../lib/theme';
import { selectRail, setUi, useUi, type RailView } from '../../lib/ui-store';
import { shortcutLabels } from '../../lib/use-global-shortcuts';
import { DropdownMenu } from '../ui/menu';
import { Tooltip } from '../ui/tooltip';
import { isActive } from '../jobs/job-bits';

const VIEWS: Array<{ view: RailView; label: string; Icon: LucideIcon }> = [
  { view: 'library', label: 'Library', Icon: FolderTree },
  { view: 'books', label: 'Books', Icon: BookOpen },
  { view: 'skills', label: 'Skills', Icon: Zap },
  { view: 'evals', label: 'Evals', Icon: FlaskConical },
  { view: 'search', label: 'Search', Icon: Search },
];

const THEMES: Array<{ value: ThemeChoice; label: string; Icon: LucideIcon }> = [
  { value: 'system', label: 'Match system', Icon: Monitor }, { value: 'light', label: 'Light', Icon: Sun }, { value: 'dark', label: 'Dark', Icon: Moon },
];

/** 40×40 rail control. The active view is a filled tile (shape, not just colour) and aria-pressed. */
const RailButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; current?: boolean; children: ReactNode }>(
  function RailButton({ label, shortcut, current, children, className, ...rest }, ref) {
    return (
      <Tooltip label={label} shortcut={shortcut} side="right">
        <button
          ref={ref}
          type="button"
          aria-label={label}
          className={clsx(
            'fx relative flex size-10 items-center justify-center rounded-lg',
            current ? 'bg-active text-fg' : 'text-muted hover:bg-hover hover:text-fg',
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </Tooltip>
    );
  },
);

/**
 * Settings menu: theme, the Claude account, the library folder. The account (email, organisation) is
 * shown only here, behind a click, so it never sits on screen in screenshots or screen shares; the
 * status bar keeps the plain "Claude ready" signal.
 */
function SettingsButton() {
  const { choice, set } = useTheme();
  const { data: tree } = useTree();
  const { data: s, isPending, refetch } = useClaudeStatus();
  const dir = tree?.libraryDir;
  const account = isPending
    ? { label: 'Checking Claude login' }
    : s?.ready
      ? { label: `Signed in as ${s.email ?? 'claude.ai user'}` }
      : { label: s?.reason ?? (s?.installed ? 'Not signed in to claude.ai' : 'Claude Code is not installed') };
  return (
    <DropdownMenu
      side="right"
      align="end"
      items={[
        ...THEMES.map(({ value, label, Icon }) => ({ label, icon: <Icon size={14} />, checked: choice === value, onSelect: () => set(value) })),
        { ...account, separated: true },
        ...(s?.ready && s.orgName ? [{ label: s.orgName }] : []),
        { label: 'Runs use claude.ai, never an API key' },
        { label: 'Check login again', icon: <RefreshCw size={14} />, onSelect: () => void refetch() },
        ...(dir
          ? [
              { label: `Library: ${abbreviateHome(dir)}`, separated: true },
              { label: 'Copy library path', icon: <Copy size={14} />, onSelect: async () => { if (await copyText(dir)) toast.success('Library path copied', { duration: 1500 }); } },
            ]
          : []),
      ]}
      trigger={<RailButton label="Settings"><Settings size={18} strokeWidth={1.75} /></RailButton>}
    />
  );
}

/** Left rail: sidebar views on top, activity below them, connect and settings at the bottom. */
export function AppRail() {
  const rail = useUi((s) => s.rail);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const running = useJobs().data?.filter((j) => isActive(j.status)).length ?? 0;
  const view = (v: RailView, label: string, Icon: LucideIcon, n: number, badge?: number) => (
    <RailButton key={v} label={label} shortcut={shortcutLabels.rail(n)} current={sidebarOpen && rail === v} aria-pressed={sidebarOpen && rail === v} onClick={() => selectRail(v)}>
      <Icon size={18} strokeWidth={1.75} aria-hidden />
      {!!badge && <span className="tnum absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-solid px-1 text-micro leading-none text-accent-fg">{badge}</span>}
    </RailButton>
  );
  // py-1 matches the side inset ((48px rail − 40px buttons) / 2 = 4px), so the first and last buttons sit 4px from every edge.
  // box-content keeps the divider border outside those 48px; otherwise it eats 1px and the buttons sit off-centre.
  return (
    <nav aria-label="Workspace" className="hairline-r box-content flex w-12 shrink-0 flex-col items-center gap-1 bg-panel py-1">
      {VIEWS.map(({ view: v, label, Icon }, i) => view(v, label, Icon, i + 1))}
      <span aria-hidden className="my-1 h-px w-6 bg-line" />
      {view('activity', running ? `Activity, ${running} running` : 'Activity', Activity, 6, running)}
      <span className="flex-1" />
      <RailButton label="Connect over MCP" onClick={() => setUi({ connectOpen: true })}><Plug size={18} strokeWidth={1.75} aria-hidden /></RailButton>
      <SettingsButton />
    </nav>
  );
}
