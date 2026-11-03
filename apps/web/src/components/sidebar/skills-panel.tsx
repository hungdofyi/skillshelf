import { useState } from 'react';
import { Wand2, Zap } from 'lucide-react';
import { useSkills } from '../../api/queries';
import { formatPercent } from '../../lib/format';
import { navigate } from '../../lib/location-state';
import { openCreateSkill } from '../../lib/ui-store';
import { Button } from '../ui/button';
import { SidebarFilter, SidebarHeader } from '../shell/sidebar-header';
import { isWithin, SidebarListItem, SidebarNote } from './sidebar-list-item';

/** Skills with lint state and the latest with-skill pass rate. */
export function SkillsPanel({ activePath }: { activePath: string }) {
  const { data: skills, isPending, error } = useSkills();
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const shown = skills?.filter((s) => !q || s.name.includes(q) || s.description.toLowerCase().includes(q));
  return (
    <>
      <SidebarHeader title="Skills">
        <Button size="sm" icon={<Wand2 size={14} />} onClick={() => openCreateSkill(null)}>New skill</Button>
      </SidebarHeader>
      {(skills?.length ?? 0) > 6 && <SidebarFilter value={filter} onChange={setFilter} label="Filter skills" placeholder="Filter skills" />}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {isPending && <SidebarNote>Loading skills…</SidebarNote>}
        {error && <SidebarNote>Could not load skills: {error.message}</SidebarNote>}
        {skills?.length === 0 && <SidebarNote>No skills yet. Open a book and create one from it.</SidebarNote>}
        {q && shown?.length === 0 && <SidebarNote>No skill matches “{filter.trim()}”.</SidebarNote>}
        <ul>
          {shown?.map((s) => {
            const errors = s.lint.filter((i) => i.level === 'error').length;
            const warnings = s.lint.filter((i) => i.level === 'warning').length;
            const rate = s.latestRun?.passRate.with_skill;
            return (
              <SidebarListItem
                key={s.name}
                icon={<Zap size={15} />}
                title={s.name}
                meta={
                  <>
                    {errors > 0 ? <span className="text-danger">{errors} lint error{errors === 1 ? '' : 's'}</span>
                      : warnings > 0 ? <span className="text-warn">{warnings} warning{warnings === 1 ? '' : 's'}</span>
                      : <span>{s.evalCount} eval case{s.evalCount === 1 ? '' : 's'}</span>}
                    {rate !== undefined && <span className="tnum">· {formatPercent(rate)} pass</span>}
                  </>
                }
                selected={isWithin(activePath, s.path)}
                onClick={() => navigate(s.path)}
              />
            );
          })}
        </ul>
      </div>
    </>
  );
}
