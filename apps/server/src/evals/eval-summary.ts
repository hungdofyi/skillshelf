/** Aggregate per-arm numbers for an eval run. Pure so the math is easy to test. */
import { type EvalArm, type EvalArmSummary, type EvalCaseArmResult, type EvalRun, type Tally, inferShouldTrigger, isGraded } from '@b2s/shared';

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number): number => Math.round(n * 1000) / 1000;
const tally = <T>(items: T[], ok: (item: T) => boolean): Tally => ({ passed: items.filter(ok).length, total: items.length });

/**
 * - cases / passRate / meanScore / checks: over graded results (passed or failed) of should-trigger cases only,
 *   in both arms, so with_skill and baseline compare the same cases. Errors and skipped are excluded.
 *   Near-miss cases (should_trigger=false) are decided by trigger alone and count only in the trigger numbers.
 * - triggerAccuracy, usedWhenNeeded, skippedWhenNotNeeded (with_skill only): over results that ran without error.
 * - vsBaseline (with_skill only): per should-trigger case graded in both arms, did the skill's answer score
 *   higher, the same or lower than the baseline's. Both arms grade the same expectations, so scores compare directly.
 * - meanDurationMs: over results that report a duration.
 * `shouldTrigger` maps caseId -> expected trigger (missing = true); by default it is read back from the results.
 */
export function summarizeRun(results: EvalCaseArmResult[], shouldTrigger: Record<string, boolean> = inferShouldTrigger(results)): Partial<Record<EvalArm, EvalArmSummary>> {
  const expects = (caseId: string) => shouldTrigger[caseId] ?? true;
  const gradedOf = (arm: EvalArm) => results.filter((r) => r.arm === arm && isGraded(r) && expects(r.caseId));
  const summary: Partial<Record<EvalArm, EvalArmSummary>> = {};
  for (const arm of ['with_skill', 'baseline'] as const) {
    const armResults = results.filter((r) => r.arm === arm);
    if (armResults.length === 0) continue;
    const graded = gradedOf(arm);
    const checks = graded.flatMap((r) => r.expectations);
    const entry: EvalArmSummary = {
      cases: graded.length,
      passRate: graded.length ? round(graded.filter((r) => r.status === 'passed').length / graded.length) : 0,
      meanScore: round(mean(graded.map((r) => r.score))),
      checks: tally(checks, (e) => e.passed),
    };
    if (arm === 'with_skill') {
      const ran = armResults.filter((r) => r.status !== 'error' && r.status !== 'skipped' && r.triggered !== undefined);
      const right = ran.filter((r) => r.triggered === expects(r.caseId));
      entry.triggerAccuracy = ran.length ? round(right.length / ran.length) : 0;
      entry.usedWhenNeeded = tally(ran.filter((r) => expects(r.caseId)), (r) => r.triggered === true);
      entry.skippedWhenNotNeeded = tally(ran.filter((r) => !expects(r.caseId)), (r) => r.triggered !== true);
      const baseline = new Map(gradedOf('baseline').map((r) => [r.caseId, r.score]));
      if (baseline.size) {
        const vs = { better: 0, tied: 0, worse: 0 };
        for (const r of graded) {
          const b = baseline.get(r.caseId);
          if (b === undefined) continue;
          const d = r.score - b;
          if (Math.abs(d) < 1e-9) vs.tied++;
          else if (d > 0) vs.better++;
          else vs.worse++;
        }
        entry.vsBaseline = vs;
      }
    }
    const durations = armResults.map((r) => r.durationMs).filter((d): d is number => typeof d === 'number');
    if (durations.length) entry.meanDurationMs = Math.round(mean(durations));
    summary[arm] = entry;
  }
  return summary;
}

/** A stored run with its summary computed from its results, so runs saved before a summary field existed show it too. */
export function withFreshSummary(run: EvalRun): EvalRun {
  return { ...run, summary: summarizeRun(run.results ?? []) };
}
