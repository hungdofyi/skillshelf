import { BookPlus, Copy, Download, FilePlus, FlaskConical, FolderPlus, Pencil, PlugZap, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Job, TreeNode } from '@b2s/shared';
import type { QueryClient } from '@tanstack/react-query';
import type { MenuItemSpec } from '../ui/menu';
import type { TreeDialogState } from './tree-dialogs';
import { nodeKind } from './tree-model';
import { api } from '../../api/client';
import { keys, upsertJob } from '../../api/queries';
import { copyText } from '../../lib/format';
import { dirname } from '../../lib/route';
import { navigate } from '../../lib/location-state';
import { openCreateSkill, openJob } from '../../lib/ui-store';

export interface MenuContext {
  libraryDir: string;
  setDialog: (d: TreeDialogState) => void;
  qc: QueryClient;
}

const copy = async (text: string, what: string) => (await copyText(text)) ? toast.success(`${what} copied`, { duration: 1500 }) : toast.error('Clipboard is not available');

/** Right-click actions: generic file operations plus book / skill specific ones. */
export function buildMenuItems(node: TreeNode, ctx: MenuContext): MenuItemSpec[] {
  const kind = nodeKind(node);
  const dir = node.type === 'dir' ? node.path : dirname(node.path);
  const items: MenuItemSpec[] = [];
  const slug = node.name;

  if (kind === 'book') {
    items.push({ label: 'Create skill…', icon: <Wand2 size={14} />, onSelect: () => openCreateSkill(slug) });
    items.push({
      label: 'Re-convert',
      icon: <RefreshCw size={14} />,
      onSelect: async () => {
        try {
          const { job } = await api<{ job: Job }>(`/api/books/${encodeURIComponent(slug)}/convert`, { method: 'POST', json: {} });
          ctx.qc.setQueryData<Job[]>(keys.jobs, (l) => upsertJob(l, job));
          openJob(job.id);
        } catch (e) {
          toast.error('Could not start conversion', { description: e instanceof Error ? e.message : String(e) });
        }
      },
    });
  }
  if (kind === 'skill') {
    items.push({ label: 'Run evals', icon: <FlaskConical size={14} />, onSelect: () => navigate(node.path, { tab: 'evals' }) });
    items.push({
      label: 'Install to Claude Code',
      icon: <PlugZap size={14} />,
      onSelect: async () => {
        try {
          const r = await api<{ linkPath: string }>(`/api/skills/${encodeURIComponent(slug)}/install`, { method: 'POST', json: { target: 'user' } });
          void ctx.qc.invalidateQueries({ queryKey: keys.skill(slug) });
          toast.success('Installed', { description: r.linkPath });
        } catch (e) {
          toast.error('Install failed', { description: e instanceof Error ? e.message : String(e) });
        }
      },
    });
    items.push({ label: 'Export .zip', icon: <Download size={14} />, onSelect: () => { window.location.href = `/api/skills/${encodeURIComponent(slug)}/export`; } });
  }
  if (items.length) items[0] = { ...items[0]!, separated: false };

  const base: MenuItemSpec[] = [
    { label: 'New file…', icon: <FilePlus size={14} />, onSelect: () => ctx.setDialog({ type: 'new-file', dir }), separated: items.length > 0 },
    { label: 'New folder…', icon: <FolderPlus size={14} />, onSelect: () => ctx.setDialog({ type: 'new-folder', dir }) },
    { label: 'Rename…', icon: <Pencil size={14} />, onSelect: () => ctx.setDialog({ type: 'rename', node }), separated: true },
    { label: 'Copy path', icon: <Copy size={14} />, onSelect: () => copy(node.path, 'Path') },
    { label: 'Copy absolute path', icon: <Copy size={14} />, onSelect: () => copy(`${ctx.libraryDir}/${node.path}`, 'Absolute path') },
    { label: 'Delete…', icon: <Trash2 size={14} />, danger: true, separated: true, onSelect: () => ctx.setDialog({ type: 'delete', node }) },
  ];
  return [...items, ...base];
}

export const importIcon = <BookPlus size={14} />;
