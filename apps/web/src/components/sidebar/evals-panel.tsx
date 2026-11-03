import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useRuns, useSkills } from '../../api/queries';
import { formatPercent, formatTime } from '../../lib/format';
import { navigate } from '../../lib/location-state';
import { RunStatusPill } from '../../views/eval/eval-bits';
import { SidebarFilter, SidebarHeader } from '../shell/sidebar-header';
import { isWithin, SidebarListItem, SidebarNote } from './sidebar-list-item';

function SkillRuns({ skill, query, activePath }: { skill: string; query: string; activePath: string }) {
  const { data: runs } = useRuns(skill);
  const shown = runs?.filter((r) => !query || skill.includes(query) || r.id.includes(query));
  if (!shown?.length) return null;
  return (
    <section className="mt-2 first:mt-0">
      <h3 className="truncate px-2 pb-1 pt-1.5 text-caption font-semibold text-muted">{skill}</h3>
      <ul>
        {shown.map((r) => {
          const path = `evals/${skill}/${r.id}`;
          const rate = r.summary.with_skill?.passRate;
          return (
            <SidebarListItem
              key={r.id}
              icon={<FlaskConical size={15} />}
              title={formatTime(r.startedAt)}
              meta={<><RunStatusPill status={r.status} />{rate !== undefined && <span className="tnum">{formatPercent(rate)} with skill</span>}</>}
              selected={isWithin(activePath, path)}
              onClick={() => navigate(path)}
            />
          );
        })}
      </ul>
    </section>
  );
}

/** Eval runs grouped by skill, newest first, with run status and pass rate. */
export function EvalsPanel({ activePath }: { activePath: string }) {
  const { data: skills, isPending } = useSkills();
  const [filter, setFilter] = useState('');
  return (
    <>
      <SidebarHeader title="Evals" />
      <SidebarFilter value={filter} onChange={setFilter} label="Filter eval runs" placeholder="Filter by skill or run" />
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {isPending && <SidebarNote>Loading runs…</SidebarNote>}
        {skills?.length === 0 && <SidebarNote>No skills yet, so no eval runs. Runs appear here once you run a skill's evals.</SidebarNote>}
        {skills?.map((s) => <SkillRuns key={s.name} skill={s.name} query={filter.trim().toLowerCase()} activePath={activePath} />)}
      </div>
    </>
  );
}
