import type { SkillSummary } from '@b2s/shared';
import { Pill } from '../../components/ui/misc';
import { runHeadline, tallyText } from '../eval/eval-bits';
import { navigate } from '../../lib/location-state';

/** The latest finished eval run as one chip ("Better in 6/7"); opens the run. */
export function LatestRunChip({ skill }: { skill: SkillSummary }) {
  const run = skill.latestRun;
  const headline = run && runHeadline(run.summary);
  if (!run || !headline) return <span className="text-muted">No eval runs yet</span>;
  const s = run.summary.with_skill;
  const v = s?.vsBaseline;
  const detail = [v && `answers scored higher with the skill in ${v.better} of ${v.better + v.tied + v.worse} cases`, s?.checks.total && `${tallyText(s.checks)} checks passed`].filter(Boolean).join(', ');
  return (
    <button onClick={() => navigate(`evals/${skill.name}/${run.id}`)} className="fx -mx-1 flex items-center rounded-md px-1 py-0.5 hover:bg-hover" title={`Latest eval run${detail ? `: ${detail}` : ''}`}>
      <Pill tone="accent"><span className="tnum">{headline}</span></Pill>
    </button>
  );
}

/**
 * Name, latest eval result and the first two lines of the description. The header sits above every
 * tab (editors included), so it stays short; the full description and metadata are in the inspector.
 */
export function SkillHeader({ skill }: { skill: SkillSummary }) {
  return (
    <header className="page-column shrink-0 pb-3 pt-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-heading font-semibold tracking-[-0.015em]">{skill.name}</h1>
        <LatestRunChip skill={skill} />
      </div>
      <p className="mt-1.5 line-clamp-2 max-w-[75ch] text-pretty text-muted" title={skill.description}>
        {skill.description || 'No description yet.'}
      </p>
    </header>
  );
}
