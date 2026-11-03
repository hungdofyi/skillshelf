import type { GitFileStatus, TreeNode } from '@b2s/shared';

export type NodeKind = NonNullable<TreeNode['kind']>;

/** Server `kind` hint, with a path-based fallback for older trees. */
export function nodeKind(node: TreeNode): NodeKind {
  if (node.kind) return node.kind;
  const parts = node.path.split('/');
  if (node.type === 'dir' && parts.length === 2 && parts[0] === 'books') return 'book';
  if (node.type === 'dir' && parts.length === 2 && parts[0] === 'skills') return 'skill';
  if (node.type === 'dir' && parts.length === 3 && parts[0] === 'evals') return 'eval-run';
  if (node.name.endsWith('.md')) return 'markdown';
  if (node.name.endsWith('.json')) return 'json';
  return 'other';
}

export interface FlatRow {
  node: TreeNode;
  depth: number;
  parentPath: string | null;
}

/** Visible rows in display order given the expanded set. The synthetic root is skipped. */
export function flattenTree(root: TreeNode | undefined, expanded: ReadonlySet<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (nodes: TreeNode[], depth: number, parentPath: string | null) => {
    for (const node of nodes) {
      rows.push({ node, depth, parentPath });
      if (node.type === 'dir' && expanded.has(node.path) && node.children) walk(node.children, depth + 1, node.path);
    }
  };
  walk(root?.children ?? [], 0, null);
  return rows;
}

const CHANGED: ReadonlySet<GitFileStatus> = new Set(['modified', 'added', 'untracked', 'deleted', 'renamed']);

/** Folders that contain at least one changed file (for the dot indicator). */
export function foldersWithChanges(root: TreeNode | undefined): Set<string> {
  const out = new Set<string>();
  const walk = (node: TreeNode): boolean => {
    let changed = false;
    for (const c of node.children ?? []) {
      const childChanged = c.type === 'dir' ? walk(c) : !!c.git && CHANGED.has(c.git);
      changed ||= childChanged;
    }
    if (changed && node.path) out.add(node.path);
    return changed;
  };
  if (root) walk(root);
  return out;
}

export const GIT_LETTER: Record<GitFileStatus, string> = { modified: 'M', added: 'A', untracked: 'U', deleted: 'D', renamed: 'R', ignored: '' };

export const GIT_TINT: Record<GitFileStatus, string> = {
  modified: 'text-warn',
  added: 'text-ok',
  untracked: 'text-ok',
  deleted: 'text-danger line-through',
  renamed: 'text-accent',
  ignored: 'text-faint',
};

export function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}
