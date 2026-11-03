import type { ReactNode } from 'react';
import { useRun } from '../../api/queries';
import { formatDuration, formatTime } from '../../lib/format';
import type { EvalRun } from '@b2s/shared';
import { navigate } from '../../lib/location-state';
import { RunSummary } from '../../views/eval/run-summary';
import { ARM_LABEL } from '../../views/eval/eval-bits';
import { effortLabel } from '../skill/effort-select';
import { OneLine } from '../ui/one-line';
import { InspectorFacts, InspectorNote, InspectorSection } from './inspector-section';

/** Per-arm line for the run details, e.g. "With skill 19 s · Baseline 14 s". */
function perArm(run: EvalRun, value: (s: NonNullable<EvalRun['summary']['with_skill']>) => string | undefined): ReactNode {
  const parts = run.arms.flatMap((a) => { const s = run.summary[a]; const v = s && value(s); return v ? [`${ARM_LABEL[a]} ${v}`] : []; });
  return parts.length ? <span className="tnum">{parts.join(' · ')}</span> : null;
}

/** Eval run: the summary first, then how the run was made, its timings and the strict all-checks count. */
export function EvalRunInspector({ skill, runId }: { skill: string; runId: string }) {
  const { data: run, isPending } = useRun(skill, runId);
  if (isPending) return <InspectorNote>Loading…</InspectorNote>;
  if (!run) return <InspectorNote>This run could not be read.</InspectorNote>;
  return (
    <>
      <InspectorSection title="Results">
        <RunSummary run={run} stacked />
      </InspectorSection>
      <InspectorSection title="Run">
        <InspectorFacts items={[
          ['Skill', <button className="fx text-left text-accent hover:underline" onClick={() => navigate(`skills/${skill}`, { tab: 'evals' })}>{skill}</button>],
          ['Model', run.model],
          ...(run.effort ? ([['Effort', effortLabel(run.effort)]] as Array<[string, ReactNode]>) : []),
          ['Judge', run.judgeEffort ? `${run.judgeModel}, ${effortLabel(run.judgeEffort).toLowerCase()} effort` : run.judgeModel],
          ['Started', formatTime(run.startedAt)],
          ...(run.finishedAt ? ([['Took', <span className="tnum">{formatDuration(Date.parse(run.finishedAt) - Date.parse(run.startedAt))}</span>]] as Array<[string, ReactNode]>) : []),
          ...([
            ['Time per answer', perArm(run, (s) => (s.meanDurationMs !== undefined ? formatDuration(s.meanDurationMs) : undefined))],
            ['All checks passed', perArm(run, (s) => (s.cases ? `${Math.round(s.passRate * s.cases)}/${s.cases} cases` : undefined))],
          ] as Array<[string, ReactNode]>).filter(([, v]) => v),
          ['Skill hash', <span className="font-mono text-caption" title="Hash of the skill folder at run time">{run.skillHash.slice(0, 12)}</span>],
          ['Run id', <OneLine className="font-mono text-caption">{run.id}</OneLine>],
        ]} />
      </InspectorSection>
    </>
  );
}
