import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, qs } from '../../api/client';
import { keys } from '../../api/queries';
import { navigate } from '../../lib/location-state';

/** File-system mutations behind the tree's context menu. */
export function useTreeActions(selectedPath: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.tree });

  const createFile = useMutation({
    // createOnly: the server refuses (409) instead of emptying an existing file with the same name.
    mutationFn: (path: string) => api('/api/file', { method: 'PUT', json: { path, content: '', createOnly: true } }),
    onSuccess: (_r, path) => { void refresh(); navigate(path, { force: true }); },
  });
  const createFolder = useMutation({
    mutationFn: (path: string) => api('/api/folder', { method: 'POST', json: { path } }),
    onSuccess: () => void refresh(),
  });
  const rename = useMutation({
    mutationFn: (v: { from: string; to: string }) => api('/api/file/rename', { method: 'POST', json: v }),
    onSuccess: (_r, v) => {
      void refresh();
      if (selectedPath === v.from || selectedPath.startsWith(`${v.from}/`)) navigate(v.to + selectedPath.slice(v.from.length), { replace: true, force: true });
      toast.success('Renamed');
    },
  });
  const remove = useMutation({
    mutationFn: (path: string) => api(`/api/file?${qs({ path })}`, { method: 'DELETE' }),
    onSuccess: (_r, path) => {
      void refresh();
      if (selectedPath === path || selectedPath.startsWith(`${path}/`)) navigate('', { replace: true, force: true });
      toast.success('Moved to trash');
    },
  });
  return { createFile, createFolder, rename, remove, busy: rename.isPending || remove.isPending || createFile.isPending || createFolder.isPending };
}
