import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import type { TreeNode } from '@b2s/shared';
import { useTree } from '../../api/queries';
import { navigate } from '../../lib/location-state';
import { dirname } from '../../lib/route';
import { useUi } from '../../lib/ui-store';
import { shortcutLabels } from '../../lib/use-global-shortcuts';
import { NodeIcon } from '../tree/tree-row';
import { SidebarHeader } from '../shell/sidebar-header';
import { SidebarNote } from './sidebar-list-item';

const LIMIT = 60;

function allNodes(root: TreeNode | undefined): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => { for (const c of n.children ?? []) { out.push(c); walk(c); } };
  if (root) walk(root);
  return out;
}

/**
 * Rank: name starts with the query, then name contains it, then path contains it, then the query's
 * letters appear in order in the name. Letters-in-order over the whole path matches nearly everything.
 */
function score(node: TreeNode, q: string): number {
  const name = node.name.toLowerCase();
  if (name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  if (node.path.toLowerCase().includes(q)) return 2;
  let i = 0;
  for (const ch of name) if (ch === q[i]) i++;
  return i === q.length ? 3 : -1;
}

/** Client-side quick open over every file and folder name in the tree. Opened by the rail, ⌘K or ⌘P. */
export function QuickOpenPanel() {
  const { data } = useTree();
  const focusTick = useUi((s) => s.searchFocus);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const nodes = useMemo(() => allNodes(data?.root), [data]);
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return nodes
      .map((n) => ({ n, s: score(n, q) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => a.s - b.s || a.n.path.length - b.n.path.length)
      .slice(0, LIMIT)
      .map((r) => r.n);
  }, [nodes, q]);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, [focusTick]);
  useEffect(() => setCursor(0), [q]);

  const open = (n: TreeNode) => navigate(n.path);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(results.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter' && results[cursor]) { e.preventDefault(); open(results[cursor]); }
    else if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); }
  };

  return (
    <>
      <SidebarHeader title="Search" />
      <div className="shrink-0 px-2 pb-2">
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Find a file or folder by name"
          aria-expanded={results.length > 0}
          aria-controls="quick-open-results"
          aria-activedescendant={results[cursor] ? `qo-${cursor}` : undefined}
          value={query}
          placeholder="File or folder name"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          className="fx h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-ui text-fg placeholder:text-faint"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {!q && <SidebarNote>Type part of a name. {shortcutLabels.quickOpen} opens this from anywhere; ↑ ↓ to move, Enter to open.</SidebarNote>}
        {q && results.length === 0 && <SidebarNote>Nothing in the library matches “{query.trim()}”.</SidebarNote>}
        <ul id="quick-open-results" role="listbox" aria-label="Matches">
          {results.map((n, i) => (
            <li key={n.path} id={`qo-${i}`} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                tabIndex={-1}
                onMouseMove={() => setCursor(i)}
                onClick={() => open(n)}
                className={clsx('flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left', i === cursor ? 'bg-hover' : '')}
              >
                <NodeIcon node={n} open={false} />
                <span className="min-w-0 truncate text-fg">{n.name}</span>
                <span className="min-w-16 flex-1 truncate text-caption text-muted">{dirname(n.path)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
