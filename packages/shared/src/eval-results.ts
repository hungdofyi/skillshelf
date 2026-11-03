import type { EvalCaseArmResult } from './library-types.js';

/** A result the judge graded (or, for a near-miss case, the trigger check decided). */
export const isGraded = (r: EvalCaseArmResult): boolean => r.status === 'passed' || r.status === 'failed';

/**
 * Expected trigger per case, read back from a run's results. A near-miss case is decided by triggering
 * alone, so its graded results carry no expectations; a should-trigger case always grades at least one.
 * This lets a stored run be summarized again without its evals.json, which may have changed since.
 * Cases with no graded result are absent (callers treat a missing entry as should-trigger).
 */
export function inferShouldTrigger(results: EvalCaseArmResult[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const r of results) if (isGraded(r)) map[r.caseId] = r.expectations.length > 0;
  return map;
}
