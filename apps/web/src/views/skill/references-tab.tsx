import { useState } from 'react';
import clsx from 'clsx';
import type { SkillSummary } from '@b2s/shared';
import { FileEditor } from '../../components/editor/file-editor';
import { EmptyState } from '../../components/ui/misc';
import { isMarkdownPath } from '../../lib/route';

export function ReferencesTab({ skill }: { skill: SkillSummary }) {
  const refs = skill.files.filter((f) => f.startsWith('references/'));
  const [pick, setPick] = useState<string | null>(null);
  const current = pick && refs.includes(pick) ? pick : refs[0];
  if (!refs.length) return <EmptyState title="No reference files">References hold the condensed book knowledge the skill loads on demand. Revise the skill to add some.</EmptyState>;
  return (
    <div className="grid h-full grid-cols-[220px_1fr] divide-x divide-line">
      <ul className="overflow-y-auto p-1.5" aria-label="Reference files">
        {refs.map((f) => (
          <li key={f}>
            <button onClick={() => setPick(f)} className={clsx('fx block w-full truncate rounded-md px-2.5 py-1.5 text-left', f === current ? 'bg-accent-soft' : 'hover:bg-hover')} title={f}>{f.replace('references/', '')}</button>
          </li>
        ))}
      </ul>
      <div className="min-w-0">{current && <FileEditor key={current} path={`${skill.path}/${current}`} kind={isMarkdownPath(current) ? 'markdown' : 'none'} />}</div>
    </div>
  );
}
