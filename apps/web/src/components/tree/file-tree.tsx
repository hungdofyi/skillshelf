import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookPlus, FilePlus, FolderPlus, Upload } from 'lucide-react';
import type { TreeNode } from '@b2s/shared';
import { useTree } from '../../api/queries';
import { navigate } from '../../lib/location-state';
import { ContextMenu } from '../ui/menu';
import { Button, IconButton } from '../ui/button';
import { ErrorState, LoadingBlock } from '../ui/misc';
import { TreeRow } from './tree-row';
import { ancestorsOf, flattenTree, foldersWithChanges, nodeKind } from './tree-model';
import { buildMenuItems } from './tree-menu-items';
import { TreeDialogs, type TreeDialogState } from './tree-dialogs';
import { useTreeActions } from './use-tree-actions';
import { useImportBookPicker, useImportBooks } from './use-import-book';
import { SidebarHeader } from '../shell/sidebar-header';

const STORE_KEY = 'b2s-tree-expanded';

function loadExpanded(): Set<string> | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

/** Library explorer: keyboard navigable tree, context menu, PDF/EPUB drop target. */
export function FileTree({ selectedPath }: { selectedPath: string }) {
  const qc = useQueryClient();
  const { data, error, isPending, refetch } = useTree();
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded() ?? new Set());
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TreeDialogState>(null);
  const [dragging, setDragging] = useState(false);
  const seeded = useRef(loadExpanded() !== null);
  const treeRef = useRef<HTMLDivElement>(null);
  const actions = useTreeActions(selectedPath);
  const importBooks = useImportBooks();
  const picker = useImportBookPicker();

  // Seed: top-level sections open on first run.
  useEffect(() => {
    if (seeded.current || !data) return;
    seeded.current = true;
    // Merge, don't replace: the reveal effect may already have opened the selected item's ancestors.
    const sections = (data.root.children ?? []).filter((c) => c.type === 'dir').map((c) => c.path);
    setExpanded((prev) => new Set([...prev, ...sections]));
  }, [data]);

  // Persist (best effort).
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify([...expanded])); } catch { /* storage unavailable */ }
  }, [expanded]);

  // Reveal the selected item.
  useEffect(() => {
    if (!selectedPath) return;
    setExpanded((prev) => {
      const missing = ancestorsOf(selectedPath).filter((a) => !prev.has(a));
      return missing.length ? new Set([...prev, ...missing]) : prev;
    });
  }, [selectedPath]);

  const rows = useMemo(() => flattenTree(data?.root, expanded), [data, expanded]);
  const changed = useMemo(() => foldersWithChanges(data?.root), [data]);
  const activeFocus = focusPath && rows.some((r) => r.node.path === focusPath) ? focusPath : (rows.find((r) => r.node.path === selectedPath)?.node.path ?? rows[0]?.node.path ?? null);

  const toggle = useCallback((node: TreeNode) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
  }, []);

  const activate = useCallback((node: TreeNode) => {
    if (node.type === 'dir') {
      const k = nodeKind(node);
      const top = !node.path.includes('/');
      if (top) { toggle(node); return; } // section headers only fold
      setExpanded((p) => (p.has(node.path) ? p : new Set([...p, node.path])));
      if (k === 'book' || k === 'skill' || k === 'eval-run') { navigate(node.path); return; }
    }
    navigate(node.path);
  }, [toggle]);

  const focusRow = useCallback((path: string) => {
    setFocusPath(path);
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus());
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const i = rows.findIndex((r) => r.node.path === activeFocus);
    const row = rows[i];
    if (!row) return;
    const go = (idx: number) => { const r = rows[Math.max(0, Math.min(rows.length - 1, idx))]; if (r) focusRow(r.node.path); };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(i + 1); break;
      case 'ArrowUp': e.preventDefault(); go(i - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(rows.length - 1); break;
      case 'ArrowRight':
        e.preventDefault();
        if (row.node.type === 'dir') { if (!expanded.has(row.node.path)) toggle(row.node); else go(i + 1); }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (row.node.type === 'dir' && expanded.has(row.node.path)) toggle(row.node);
        else if (row.parentPath) focusRow(row.parentPath);
        break;
      case 'Enter': case ' ': e.preventDefault(); activate(row.node); break;
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void importBooks(files);
  };
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const menuCtx = { libraryDir: data?.libraryDir ?? '', setDialog, qc };
  const empty = data && (data.root.children?.length ?? 0) === 0;

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-panel"
      onDragEnter={(e) => hasFiles(e) && setDragging(true)}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={onDrop}
    >
      <SidebarHeader title="Library">
        <IconButton label="Import book" onClick={picker.pick}><BookPlus size={16} /></IconButton>
        <IconButton label="New file" onClick={() => setDialog({ type: 'new-file', dir: '' })}><FilePlus size={16} /></IconButton>
        <IconButton label="New folder" onClick={() => setDialog({ type: 'new-folder', dir: '' })}><FolderPlus size={16} /></IconButton>
        {picker.input}
      </SidebarHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {isPending && <LoadingBlock label="Reading library" />}
        {error && !data && <ErrorState title="Cannot read the library" error={error} action={<Button onClick={() => void refetch()}>Retry</Button>} />}
        {empty && (
          <p className="px-3 py-6 text-center text-muted">
            The library is empty. Drop a PDF or EPUB here to import it.
          </p>
        )}
        <div ref={treeRef} role="tree" aria-label="Library files" onKeyDown={onKeyDown}>
          {rows.map(({ node, depth }) => {
            const isTop = depth === 0;
            const emptySection = isTop && node.type === 'dir' && expanded.has(node.path) && !(node.children?.length);
            return (
              <div key={node.path} role="none">
                <ContextMenu items={buildMenuItems(node, menuCtx)}>
                  <div role="none">
                    <TreeRow
                      node={node}
                      depth={depth}
                      expanded={expanded.has(node.path)}
                      selected={node.path === selectedPath}
                      focused={node.path === activeFocus}
                      hasChanges={changed.has(node.path)}
                      onActivate={activate}
                      onToggle={toggle}
                      onFocusRow={setFocusPath}
                    />
                  </div>
                </ContextMenu>
                {emptySection && <SectionHint name={node.name} />}
              </div>
            );
          })}
        </div>
      </div>

      {dragging && (
        <div className="anim-fade pointer-events-none absolute inset-2 z-(--z-raised) flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-accent bg-[color-mix(in_oklab,var(--panel)_88%,var(--accent))] text-accent">
          <Upload size={20} aria-hidden />
          <span className="font-medium">Drop a PDF or EPUB to import</span>
        </div>
      )}

      <TreeDialogs
        state={dialog}
        busy={actions.busy}
        onClose={() => setDialog(null)}
        onCreateFile={(p) => actions.createFile.mutate(p, { onSuccess: () => setDialog(null) })}
        onCreateFolder={(p) => actions.createFolder.mutate(p, { onSuccess: () => setDialog(null) })}
        onRename={(from, to) => actions.rename.mutate({ from, to }, { onSuccess: () => setDialog(null) })}
        onDelete={(p) => actions.remove.mutate(p, { onSuccess: () => setDialog(null) })}
      />
    </div>
  );
}

function SectionHint({ name }: { name: string }) {
  const text = name === 'books' ? 'No books yet. Drop a PDF or EPUB.' : name === 'skills' ? 'No skills yet. Open a book and create one.' : name === 'evals' ? 'Eval runs appear here.' : 'Empty';
  return <p className="py-1 pl-[26px] pr-2 text-caption text-faint">{text}</p>;
}
