import { type EvalArm, type EvalCaseArmResult, type EvalRun, type Tally, isGraded } from '@b2s/shared';
import { Pill, Spinner } from '../../components/ui/misc';

export const ARM_LABEL: Record<EvalArm, string> = { with_skill: 'With skill', baseline: 'Baseline' };

export const tallyText = (t: Tally): string => `${t.passed}/${t.total}`;

/**
 * Short line for chips and lists: in how many cases the skill's answer beat the baseline's, or, for a run
 * without a baseline, how many checks passed. Null when the run has no graded results yet.
 */
export function runHeadline(summary: EvalRun['summary']): string | null {
  const s = summary.with_skill;
  if (!s) return null;
  const v = s.vsBaseline;
  const compared = v ? v.better + v.tied + v.worse : 0;
  if (v && compared) return `Better in ${v.better}/${compared}`;
  return s.checks?.total ? `${tallyText(s.checks)} checks` : null;
}

/** Checks passed in one result, when the judge graded expectations (near-miss cases have none). */
export function checksOf(r: EvalCaseArmResult): Tally | null {
  if (!isGraded(r) || !r.expectations.length) return null;
  return { passed: r.expectations.filter((e) => e.passed).length, total: r.expectations.length };
}

export function RunStatusPill({ status }: { status: EvalRun['status'] }) {
  if (status === 'running') return <Pill tone="accent"><Spinner size={10} className="text-accent" />Running</Pill>;
  if (status === 'succeeded') return <Pill tone="ok">Complete</Pill>;
  if (status === 'failed') return <Pill tone="danger">Failed</Pill>;
  return <Pill>Cancelled</Pill>;
}

/** Pending, error or skipped state of a result; graded results use ResultPill. */
export function CaseStatusPill({ result, runActive }: { result?: EvalCaseArmResult; runActive: boolean }) {
  if (!result) return runActive ? <Pill tone="accent"><Spinner size={10} className="text-accent" />Pending</Pill> : <Pill>Not run</Pill>;
  switch (result.status) {
    case 'passed': return <Pill tone="ok">Passed</Pill>;
    case 'failed': return <Pill tone="danger">Failed</Pill>;
    case 'error': return <Pill tone="warn">Error</Pill>;
    case 'skipped': return <Pill>Skipped</Pill>;
  }
}

/**
 * One arm's outcome for a case: checks passed ("5/6 checks") for a graded case, whether the skill stayed out
 * of a near-miss prompt, otherwise the pending/error state.
 */
export function ResultPill({ result, runActive }: { result?: EvalCaseArmResult; runActive: boolean }) {
  if (!result || !isGraded(result)) return <CaseStatusPill result={result} runActive={runActive} />;
  const c = checksOf(result);
  if (!c) return result.status === 'passed' ? <Pill tone="ok">Left alone</Pill> : <Pill tone="danger">Used by mistake</Pill>;
  return <Pill tone={c.passed === c.total ? 'ok' : 'neutral'}><span className="tnum">{tallyText(c)}</span> checks</Pill>;
}
