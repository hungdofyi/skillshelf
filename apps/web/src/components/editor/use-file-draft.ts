import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '../../api/client';
import { keys, useFile, useWriteFile } from '../../api/queries';
import { useDirtyGuard } from '../../lib/location-state';

/**
 * Local edit buffer over a server file. Saves send `expectedMtimeMs` (the mtime the edit started from);
 * a 409 offers reload or overwrite. While clean, the buffer follows server changes.
 */
export function useFileDraft(path: string, validate?: (text: string) => string | null) {
  const qc = useQueryClient();
  const query = useFile(path);
  const write = useWriteFile();
  const [draft, setDraft] = useState<string | null>(null);
  const baseMtime = useRef<number | undefined>(undefined);

  // Switching files discards the buffer (navigation already asked for confirmation).
  useEffect(() => {
    setDraft(null);
    baseMtime.current = undefined;
  }, [path]);

  const serverText = query.data?.content ?? '';
  const text = draft ?? serverText;
  const dirty = draft !== null && draft !== serverText;
  const validationError = validate && dirty ? validate(text) : null;
  useDirtyGuard(`editor:${path}`, dirty);

  const edit = useCallback(
    (next: string) => {
      // While the previous file is still shown (placeholder during a switch), edits would land on the wrong path.
      if (query.isPlaceholderData) return;
      if (draft === null) baseMtime.current = query.data?.mtimeMs;
      setDraft(next);
    },
    [draft, query.data?.mtimeMs, query.isPlaceholderData],
  );

  const revert = useCallback(() => {
    setDraft(null);
    baseMtime.current = undefined;
  }, []);

  const doSave = useCallback(
    (force: boolean) => {
      if (draft === null) return;
      const err = validate?.(draft);
      if (err) {
        toast.error('Not saved', { description: err });
        return;
      }
      write.mutate(
        { path, content: draft, expectedMtimeMs: force ? undefined : baseMtime.current },
        {
          onSuccess: (file) => {
            setDraft(null);
            baseMtime.current = file.mtimeMs;
            toast.success('Saved', { duration: 1500 });
          },
          onError: (e) => {
            if (e instanceof ApiError && e.status === 409) {
              toast.warning('This file changed on disk', {
                description: 'Someone or something else saved it after you started editing.',
                duration: 15_000,
                action: { label: 'Overwrite', onClick: () => doSave(true) },
                cancel: {
                  label: 'Reload',
                  onClick: () => {
                    revert();
                    void qc.invalidateQueries({ queryKey: keys.file(path) });
                  },
                },
              });
            } else toast.error('Could not save', { description: e instanceof Error ? e.message : String(e) });
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, path, validate, write, revert, qc],
  );

  const save = useCallback(() => doSave(false), [doSave]);

  // Cmd/Ctrl+S outside CodeMirror (e.g. while the preview pane has focus).
  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, save]);

  const changedOnDisk = dirty && query.data !== undefined && baseMtime.current !== undefined && query.data.mtimeMs !== baseMtime.current;

  return { query, text, edit, dirty, save, revert, saving: write.isPending, validationError, changedOnDisk };
}
