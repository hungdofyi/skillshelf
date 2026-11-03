import type { ReactNode } from 'react';
import { useRun } from '../../api/queries';
import { formatDuration, formatTime } from '../../lib/format';
import { navigate } from '../../lib/location-state';
import { ArmSummary } from '../../views/eval/arm-summary';
import { effortLabel } from '../skill/effort-select';
import { OneLine } from '../ui/one-line';
import { InspectorFacts, InspectorNote, InspectorSection } from './inspector-section';

/** Eval run: per-arm results first, then how the run was made. */
export function EvalRunInspector({ skill, runId }: { skill: string; runId: string }) {
  const { data: run, isPending } = useRun(skill, runId);
  if (isPending) return <InspectorNote>Loading…</InspectorNote>;
  if (!run) return <InspectorNote>This run could not be read.</InspectorNote>;
  return (
    <>
      <InspectorSection title="Results">
        <ArmSummary run={run} stacked />
      </InspectorSection>
      <InspectorSection title="Run">
        <InspectorFacts items={[
          ['Skill', <button className="fx text-left text-accent hover:underline" onClick={() => navigate(`skills/${skill}`, { tab: 'evals' })}>{skill}</button>],
          ['Model', run.model],
          ...(run.effort ? ([['Effort', effortLabel(run.effort)]] as Array<[string, ReactNode]>) : []),
          ['Judge', run.judgeEffort ? `${run.judgeModel}, ${effortLabel(run.judgeEffort).toLowerCase()} effort` : run.judgeModel],
          ['Started', formatTime(run.startedAt)],
          ...(run.finishedAt ? ([['Took', <span className="tnum">{formatDuration(Date.parse(run.finishedAt) - Date.parse(run.startedAt))}</span>]] as Array<[string, ReactNode]>) : []),
          ['Skill hash', <span className="font-mono text-caption" title="Hash of the skill folder at run time">{run.skillHash.slice(0, 12)}</span>],
          ['Run id', <OneLine className="font-mono text-caption">{run.id}</OneLine>],
        ]} />
      </InspectorSection>
    </>
  );
}
