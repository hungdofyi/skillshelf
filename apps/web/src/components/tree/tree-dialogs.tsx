import { useEffect, useState } from 'react';
import type { TreeNode } from '@b2s/shared';
import { Dialog, ConfirmDialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/misc';

export type TreeDialogState =
  | { type: 'new-file'; dir: string }
  | { type: 'new-folder'; dir: string }
  | { type: 'rename'; node: TreeNode }
  | { type: 'delete'; node: TreeNode }
  | null;

/** Library paths must stay relative and inside the library. */
export function validateLibraryPath(p: string): string | null {
  const v = p.trim();
  if (!v) return 'Enter a path.';
  if (v.startsWith('/') || v.includes('\\')) return 'Use a relative path with forward slashes.';
  if (v.split('/').some((s) => s === '..' || s === '' || s === '.')) return 'Path segments cannot be empty, "." or "..".';
  return null;
}

function PathPrompt({ title, description, initial, confirmLabel, onSubmit, onClose }: {
  title: string; description?: string; initial: string; confirmLabel: string; onSubmit: (path: string) => void; onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  const error = value === initial ? null : validateLibraryPath(value);
  const submit = () => { if (!validateLibraryPath(value) && value.trim() !== initial) onSubmit(value.trim()); };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      width="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={!!validateLibraryPath(value) || value.trim() === initial}>{confirmLabel}</Button></>}
    >
      <Field label="Path in library" error={error} htmlFor="path-prompt">
        <Input
          id="path-prompt"
          autoFocus
          value={value}
          className="font-mono"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => {
            // Select only the last path segment so renames keep the folder.
            const i = e.target.value.lastIndexOf('/') + 1;
            e.target.setSelectionRange(i, e.target.value.length);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </Field>
    </Dialog>
  );
}

export function TreeDialogs({ state, onClose, onCreateFile, onCreateFolder, onRename, onDelete, busy }: {
  state: TreeDialogState;
  onClose: () => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (path: string) => void;
  busy: boolean;
}) {
  if (!state) return null;
  const prefix = (dir: string) => (dir ? `${dir}/` : '');
  if (state.type === 'new-file') return <PathPrompt title="New file" initial={prefix(state.dir)} confirmLabel="Create file" onSubmit={onCreateFile} onClose={onClose} />;
  if (state.type === 'new-folder') return <PathPrompt title="New folder" initial={prefix(state.dir)} confirmLabel="Create folder" onSubmit={onCreateFolder} onClose={onClose} />;
  if (state.type === 'rename') {
    return <PathPrompt title={`Rename ${state.node.name}`} description="Change the name, or the folder to move it." initial={state.node.path} confirmLabel="Rename" onSubmit={(to) => onRename(state.node.path, to)} onClose={onClose} />;
  }
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete ${state.node.name}?`}
      description={<>It moves to the library trash (<span className="font-mono text-caption">.data/trash</span>) and can be restored from there.{state.node.type === 'dir' && ' Everything inside the folder goes with it.'}</>}
      confirmLabel="Delete"
      destructive
      loading={busy}
      onConfirm={() => onDelete(state.node.path)}
    />
  );
}
