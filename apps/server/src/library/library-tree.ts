/** Builds the library file tree (TreeResponse.root) with kind hints, natural sort and skip rules. */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { TreeNode } from '@b2s/shared';

// Internal markers (.convert-failed, .gitkeep) are state, not content; job events cover their changes.
const SKIP_NAMES = new Set(['.git', '.DS_Store', 'node_modules', '.convert-failed', '.gitkeep']);

/** True for entries the tree and the watcher never show. `rel` is library-relative POSIX. */
export function isIgnoredPath(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.some((p) => SKIP_NAMES.has(p))) return true;
  // Eval sandboxes (scratch copies of skills) live under evals/.../sandbox.
  return parts[0] === 'evals' && parts.slice(1).includes('sandbox');
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Natural sort: "02-x" < "10-x"; directories before files. */
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return collator.compare(a.name, b.name);
}

const BINARY_EXT = new Set(['.pdf', '.epub', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.zip', '.ico']);

/** Classify a node by its library-relative path. */
export function classify(rel: string, type: 'file' | 'dir'): TreeNode['kind'] {
  const seg = rel.split('/');
  const ext = path.posix.extname(rel).toLowerCase();
  if (seg[0] === 'books' && seg.length >= 2 && seg[1]) {
    if (seg.length === 2 && type === 'dir') return 'book';
    if (seg[2] === 'markdown' && type === 'file' && ext === '.md') return 'book-chapter';
  }
  if (seg[0] === 'skills' && seg.length >= 2 && seg[1]) {
    if (seg.length === 2 && type === 'dir') return 'skill';
    if (type === 'file') return 'skill-file';
  }
  if (seg[0] === 'evals' && seg.length === 3 && type === 'dir') return 'eval-run';
  if (type === 'dir') return undefined;
  if (ext === '.md') return 'markdown';
  if (ext === '.json') return 'json';
  if (BINARY_EXT.has(ext)) return 'binary';
  return 'other';
}

function walk(abs: string, rel: string, name: string): TreeNode {
  const st = statSync(abs);
  if (!st.isDirectory()) {
    const node: TreeNode = { name, path: rel, type: 'file', size: st.size, mtimeMs: st.mtimeMs };
    const kind = classify(rel, 'file');
    if (kind) node.kind = kind;
    return node;
  }
  const children: TreeNode[] = [];
  for (const entry of readdirSync(abs)) {
    const childRel = rel ? `${rel}/${entry}` : entry;
    if (isIgnoredPath(childRel)) continue;
    try {
      children.push(walk(path.join(abs, entry), childRel, entry));
    } catch {
      // Broken symlink or file removed mid-walk: skip it.
    }
  }
  children.sort(compareNodes);
  const node: TreeNode = { name, path: rel, type: 'dir', children, mtimeMs: st.mtimeMs };
  const kind = classify(rel, 'dir');
  if (kind) node.kind = kind;
  return node;
}

export function buildTree(libraryDir: string): TreeNode {
  return walk(libraryDir, '', path.basename(libraryDir));
}
