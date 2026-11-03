import { useMemo } from 'react';
import { BookOpen, Folder, FileText } from 'lucide-react';
import { useTree } from '../api/queries';
import { findNode } from '../lib/route';
import { navigate } from '../lib/location-state';
import { nodeKind } from '../components/tree/tree-model';
import { EmptyState } from '../components/ui/misc';
import { formatBytes } from '../lib/format';

/** Plain folder: list its children. */
export function FolderView({ path }: { path: string }) {
  const { data } = useTree();
  const node = useMemo(() => findNode(data?.root, path), [data, path]);
  const children = node?.children ?? [];
  if (!children.length) return <EmptyState icon={<Folder size={22} />} title="This folder is empty">Right-click it in the tree to add a file or folder.</EmptyState>;
  return (
    <ul className="mx-auto w-full max-w-4xl px-8 py-6">
      {children.map((c) => (
        <li key={c.path}>
          <button onClick={() => navigate(c.path)} className="fx flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-hover">
            {c.type === 'dir' ? (nodeKind(c) === 'book' ? <BookOpen size={15} className="text-accent" /> : <Folder size={15} className="text-muted" />) : <FileText size={15} className="text-muted" />}
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            {c.size !== undefined && c.type === 'file' && <span className="tnum text-caption text-faint">{formatBytes(c.size)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
