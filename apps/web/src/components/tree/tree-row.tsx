import { memo } from 'react';
import clsx from 'clsx';
import {
  BookOpen, Braces, ChevronRight, File as FileIcon, FileImage, FileText, FileType, FlaskConical, Folder, FolderOpen, Zap,
} from 'lucide-react';
import type { TreeNode } from '@b2s/shared';
import { GIT_LETTER, GIT_TINT, nodeKind } from './tree-model';
import { extname } from '../../lib/route';

export function NodeIcon({ node, open }: { node: TreeNode; open: boolean }) {
  const kind = nodeKind(node);
  const cls = 'shrink-0';
  if (kind === 'book') return <BookOpen size={16} className={clsx(cls, 'text-accent')} aria-hidden />;
  if (kind === 'skill') return <Zap size={16} className={clsx(cls, 'text-accent')} aria-hidden />;
  if (kind === 'eval-run') return <FlaskConical size={16} className={clsx(cls, 'text-muted')} aria-hidden />;
  if (node.type === 'dir') return open ? <FolderOpen size={16} className={clsx(cls, 'text-muted')} aria-hidden /> : <Folder size={16} className={clsx(cls, 'text-muted')} aria-hidden />;
  if (kind === 'json') return <Braces size={16} className={clsx(cls, 'text-muted')} aria-hidden />;
  const ext = extname(node.name);
  if (ext === 'pdf') return <FileType size={16} className={clsx(cls, 'text-muted')} aria-hidden />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return <FileImage size={16} className={clsx(cls, 'text-muted')} aria-hidden />;
  if (kind === 'binary' || kind === 'other') return <FileIcon size={16} className={clsx(cls, 'text-muted')} aria-hidden />;
  return <FileText size={16} className={clsx(cls, 'text-muted')} aria-hidden />;
}

const INDENT = 22;

export interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  focused: boolean;
  hasChanges: boolean;
  onActivate: (node: TreeNode) => void;
  onToggle: (node: TreeNode) => void;
  onFocusRow: (path: string) => void;
}

export const TreeRow = memo(function TreeRow({ node, depth, expanded, selected, focused, hasChanges, onActivate, onToggle, onFocusRow }: TreeRowProps) {
  const isDir = node.type === 'dir';
  const top = depth === 0;
  const git = node.git;
  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={isDir ? expanded : undefined}
      data-path={node.path}
      tabIndex={focused ? 0 : -1}
      onFocus={() => onFocusRow(node.path)}
      onClick={() => onActivate(node)}
      className={clsx(
        'group relative flex h-7 cursor-default items-center gap-1.5 rounded-md pr-2 outline-offset-[-2px]',
        selected ? 'bg-accent-soft text-fg' : 'hover:bg-hover',
        top && 'mt-2 first:mt-0',
      )}
      // One indent step = chevron (16) + gap (6), so a child's chevron sits under its parent's icon
      // and a child's icon sits under its parent's name.
      style={{ paddingLeft: 6 + depth * INDENT }}
    >
      {isDir ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => { e.stopPropagation(); onToggle(node); }}
          // The visual chevron is 16px; the ::before strip makes the whole row-height slice clickable.
          className="relative -ml-0.5 flex size-4 shrink-0 items-center justify-center rounded text-faint before:absolute before:-inset-x-1 before:-inset-y-1.5 hover:text-fg"
        >
          {/* No rotation tween: tree folding is a 100+/day action, often from the keyboard. */}
          <ChevronRight size={13} className={clsx(expanded && 'rotate-90')} aria-hidden />
        </button>
      ) : (
        <span className="-ml-0.5 size-4 shrink-0" aria-hidden />
      )}
      {top ? null : <NodeIcon node={node} open={expanded} />}
      <span
        className={clsx(
          'min-w-0 flex-1 truncate',
          top && 'text-caption font-semibold capitalize text-muted',
          git && GIT_TINT[git],
        )}
        title={node.path}
      >
        {node.name}
      </span>
      {/* Only a closed folder hides its changes; an open one shows them on its children. */}
      {isDir && !top && !expanded && hasChanges && <span className="size-1.5 shrink-0 rounded-full bg-faint" title="Contains uncommitted changes" aria-label="Contains uncommitted changes" />}
      {git && GIT_LETTER[git] && <span className={clsx('w-3 shrink-0 text-center font-mono text-micro', GIT_TINT[git])} aria-label={git}>{GIT_LETTER[git]}</span>}
    </div>
  );
});
