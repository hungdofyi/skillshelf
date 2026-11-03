/** Aggregate per-arm numbers for an eval run. Pure so the math is easy to test. */
import type { EvalArm, EvalArmSummary, EvalCaseArmResult } from '@b2s/shared';

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * - cases / passRate / meanScore: over graded results (passed or failed) of should-trigger cases only, in
 *   both arms, so the with_skill vs baseline delta compares the same cases. Errors and skipped are excluded.
 *   Near-miss cases (should_trigger=false) are scored by trigger alone and count only in triggerAccuracy.
 * - triggerAccuracy (with_skill only): over results that ran without error; a case counts as right when
 *   should_trigger=true fired the skill or should_trigger=false did not.
 * - meanDurationMs: over results that report a duration.
 * `shouldTrigger` maps caseId -> expected trigger (missing = true).
 */
export function summarizeRun(results: EvalCaseArmResult[], shouldTrigger: Record<string, boolean>): Partial<Record<EvalArm, EvalArmSummary>> {
  const summary: Partial<Record<EvalArm, EvalArmSummary>> = {};
  for (const arm of ['with_skill', 'baseline'] as const) {
    const armResults = results.filter((r) => r.arm === arm);
    if (armResults.length === 0) continue;
    const graded = armResults.filter((r) => (r.status === 'passed' || r.status === 'failed') && (shouldTrigger[r.caseId] ?? true));
    const entry: EvalArmSummary = {
      cases: graded.length,
      passRate: graded.length ? round(graded.filter((r) => r.status === 'passed').length / graded.length) : 0,
      meanScore: round(mean(graded.map((r) => r.score))),
    };
    if (arm === 'with_skill') {
      const ran = armResults.filter((r) => r.status !== 'error' && r.status !== 'skipped' && r.triggered !== undefined);
      const right = ran.filter((r) => r.triggered === (shouldTrigger[r.caseId] ?? true));
      entry.triggerAccuracy = ran.length ? round(right.length / ran.length) : 0;
    }
    const durations = armResults.map((r) => r.durationMs).filter((d): d is number => typeof d === 'number');
    if (durations.length) entry.meanDurationMs = Math.round(mean(durations));
    summary[arm] = entry;
  }
  return summary;
}
