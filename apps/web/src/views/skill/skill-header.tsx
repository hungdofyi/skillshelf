import type { SkillSummary } from '@b2s/shared';
import { Pill } from '../../components/ui/misc';
import { formatPercent } from '../../lib/format';
import { navigate } from '../../lib/location-state';

export function PassRates({ rates, runId, skill }: { rates: Partial<Record<'with_skill' | 'baseline', number>>; runId?: string; skill: string }) {
  const entries = Object.entries(rates) as Array<['with_skill' | 'baseline', number]>;
  if (!entries.length) return <span className="text-muted">No eval runs yet</span>;
  return (
    <button onClick={() => runId && navigate(`evals/${skill}/${runId}`)} className="fx -mx-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-hover" title="Open the latest eval run">
      {entries.map(([arm, v]) => (
        <Pill key={arm} tone={arm === 'with_skill' ? 'accent' : 'neutral'}>
          {arm === 'with_skill' ? 'With skill' : 'Baseline'} <span className="tnum">{formatPercent(v)}</span>
        </Pill>
      ))}
    </button>
  );
}

/**
 * Name, latest pass rates and the first two lines of the description. The header sits above every
 * tab (editors included), so it stays short; the full description and metadata are in the inspector.
 */
export function SkillHeader({ skill }: { skill: SkillSummary }) {
  return (
    <header className="mx-auto w-full max-w-4xl shrink-0 px-8 pb-3 pt-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-heading font-semibold tracking-[-0.015em]">{skill.name}</h1>
        <PassRates rates={skill.latestRun?.passRate ?? {}} runId={skill.latestRun?.id} skill={skill.name} />
      </div>
      <p className="mt-1.5 line-clamp-2 max-w-[75ch] text-pretty text-muted" title={skill.description}>
        {skill.description || 'No description yet.'}
      </p>
    </header>
  );
}
