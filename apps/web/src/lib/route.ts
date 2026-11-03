import type { TreeNode } from '@b2s/shared';

/** What the main pane shows for a given library path. */
export type Route =
  | { kind: 'home' }
  | { kind: 'book'; slug: string }
  | { kind: 'skill'; name: string; isSkillMd: boolean }
  | { kind: 'eval-run'; skill: string; runId: string }
  | { kind: 'folder'; path: string }
  | { kind: 'file'; path: string };

export function findNode(root: TreeNode | undefined, path: string): TreeNode | null {
  if (!root) return null;
  if (path === '' || root.path === path) return root;
  let node: TreeNode = root;
  for (const part of path.split('/')) {
    const next: TreeNode | undefined = node.children?.find((c) => c.name === part);
    if (!next) return null;
    node = next;
  }
  return node;
}

export function resolveRoute(path: string, root?: TreeNode): Route {
  if (!path) return { kind: 'home' };
  const [top, a, b, c] = path.split('/');
  if (top === 'books' && a && (!b || (b === 'book.json' && !c))) return { kind: 'book', slug: a };
  if (top === 'skills' && a && (!b || (b === 'SKILL.md' && !c))) return { kind: 'skill', name: a, isSkillMd: b === 'SKILL.md' };
  if (top === 'evals' && a && b && (!c || (c === 'run.json' && path.split('/').length === 4))) return { kind: 'eval-run', skill: a, runId: b };
  const node = findNode(root, path);
  if (node?.type === 'dir') return { kind: 'folder', path };
  return { kind: 'file', path };
}

export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const joinPath = (...parts: string[]) => parts.filter(Boolean).join('/');
export const extname = (p: string) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
};
export const isMarkdownPath = (p: string) => ['md', 'markdown', 'mdx'].includes(extname(p));

/** Path of the nearest enclosing skill folder, e.g. "skills/x/references/a.md" -> "x". */
export function skillOfPath(path: string): string | null {
  const [top, name] = path.split('/');
  return top === 'skills' && name ? name : null;
}
