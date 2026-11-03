import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { FileResponse, SkillSummary } from '@b2s/shared';
import { api, qs } from '../../api/client';
import { keys } from '../../api/queries';
import { FileEditor } from '../../components/editor/file-editor';
import { EmptyState } from '../../components/ui/misc';
import { isMarkdownPath } from '../../lib/route';

/**
 * Reference files share the page structure of every other document: the content sits in the centred page
 * column and the file list floats on the left edge like the outline on the right (a toolbar menu when the
 * pane is narrow). One editor stays mounted across files, so switching keeps the view mode and never flickers.
 */
export function ReferencesTab({ skill }: { skill: SkillSummary }) {
  const qc = useQueryClient();
  const refs = skill.files.filter((f) => f.startsWith('references/'));
  const [pick, setPick] = useState<string | null>(null);
  const current = pick && refs.includes(pick) ? pick : refs[0];

  // Reference files are small: warm the cache so switching between them is instant.
  useEffect(() => {
    for (const f of refs) {
      const path = `${skill.path}/${f}`;
      void qc.prefetchQuery({ queryKey: keys.file(path), queryFn: () => api<FileResponse>(`/api/file?${qs({ path })}`) });
    }
  }, [qc, skill.path, refs.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!refs.length) return <EmptyState title="No reference files">References hold the condensed book knowledge the skill loads on demand. Revise the skill to add some.</EmptyState>;
  return (
    <FileEditor
      path={`${skill.path}/${current}`}
      kind={current && isMarkdownPath(current) ? 'markdown' : 'none'}
      toolbarInColumn
      sideNav={{
        label: 'References',
        items: refs.map((f) => ({ key: f, label: f.replace('references/', ''), current: f === current, onSelect: () => setPick(f) })),
      }}
    />
  );
}
