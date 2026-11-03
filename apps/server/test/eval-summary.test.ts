import { describe, expect, it } from 'vitest';
import type { EvalCaseArmResult } from '@b2s/shared';
import { extractFirstJsonObject, parseVerdict } from '../src/evals/eval-judge.js';
import { summarizeRun } from '../src/evals/eval-summary.js';

const r = (caseId: string, arm: EvalCaseArmResult['arm'], status: EvalCaseArmResult['status'], score: number, extra: Partial<EvalCaseArmResult> = {}): EvalCaseArmResult => ({ caseId, arm, status, score, expectations: [], ...extra });

describe('summarizeRun', () => {
  it('computes pass rate over graded cases, trigger accuracy and durations', () => {
    const results = [
      r('1', 'with_skill', 'passed', 1, { triggered: true, durationMs: 100 }),
      r('2', 'with_skill', 'failed', 0.5, { triggered: false, durationMs: 300 }), // should trigger but did not
      r('3', 'with_skill', 'passed', 1, { triggered: false, durationMs: 200 }), // near miss, correctly silent
      r('4', 'with_skill', 'error', 0, { durationMs: 999 }),
      r('1', 'baseline', 'failed', 0),
      r('2', 'baseline', 'failed', 0.25),
      r('3', 'baseline', 'skipped', 0),
    ];
    const s = summarizeRun(results, { '1': true, '2': true, '3': false, '4': true });
    // near-miss case 3 is excluded from passRate/meanScore/checks (only the trigger numbers see it)
    expect(s.with_skill).toEqual({
      cases: 2, passRate: 0.5, meanScore: 0.75, checks: { passed: 0, total: 0 }, triggerAccuracy: 0.667,
      usedWhenNeeded: { passed: 1, total: 2 }, skippedWhenNotNeeded: { passed: 1, total: 1 },
      vsBaseline: { better: 2, tied: 0, worse: 0 }, meanDurationMs: 400,
    });
    expect(s.baseline).toEqual({ cases: 2, passRate: 0, meanScore: 0.125, checks: { passed: 0, total: 0 } });
  });

  const exp = (...passed: boolean[]) => passed.map((p, i) => ({ text: `check ${i}`, passed: p, evidence: '' }));
  it('counts checks per arm and compares each case with the baseline', () => {
    const results = [
      r('1', 'with_skill', 'passed', 1, { triggered: true, expectations: exp(true, true) }),
      r('1', 'baseline', 'failed', 0.5, { expectations: exp(true, false) }),
      r('2', 'with_skill', 'failed', 0.5, { triggered: true, expectations: exp(true, false) }),
      r('2', 'baseline', 'failed', 0.5, { expectations: exp(false, true) }),
      r('3', 'with_skill', 'failed', 0, { triggered: true, expectations: exp(false, false) }),
      r('3', 'baseline', 'failed', 0.5, { expectations: exp(true, false) }),
    ];
    const s = summarizeRun(results, {});
    expect(s.with_skill).toMatchObject({ checks: { passed: 3, total: 6 }, vsBaseline: { better: 1, tied: 1, worse: 1 }, passRate: 0.333 });
    expect(s.baseline).toMatchObject({ checks: { passed: 3, total: 6 } });
  });
  it('reads near-miss cases back from the results when no trigger map is given', () => {
    const results = [
      r('1', 'with_skill', 'passed', 1, { triggered: true, expectations: exp(true) }),
      r('1', 'baseline', 'failed', 0, { expectations: exp(false) }),
      r('9', 'with_skill', 'passed', 1, { triggered: false }), // near miss: decided by trigger, no expectations
      r('9', 'baseline', 'skipped', 0),
    ];
    expect(summarizeRun(results)).toEqual(summarizeRun(results, { '1': true, '9': false }));
    expect(summarizeRun(results).with_skill).toMatchObject({ cases: 1, skippedWhenNotNeeded: { passed: 1, total: 1 }, vsBaseline: { better: 1, tied: 0, worse: 0 } });
  });
  it('omits arms with no results', () => {
    expect(summarizeRun([r('1', 'with_skill', 'passed', 1, { triggered: true })], {})).toMatchObject({ with_skill: { passRate: 1, triggerAccuracy: 1 } });
  });
});

describe('judge output parsing', () => {
  it('extracts the first balanced JSON object from prose and fences', () => {
    expect(extractFirstJsonObject('Sure!\n```json\n{"a":{"b":"}"},"c":1}\n```\n{"x":2}')).toEqual({ a: { b: '}' }, c: 1 });
    expect(extractFirstJsonObject('no json')).toBeUndefined();
  });
  it('aligns verdict items to expectations, failing anything missing', () => {
    const v = parseVerdict(undefined, '{"expectations":[{"text":"B","passed":true,"evidence":"q"},{"text":"A","passed":"yes","evidence":"z"}],"summary":"s"}', ['A', 'B', 'C']);
    expect(v?.expectations).toEqual([
      { text: 'A', passed: false, evidence: 'z' }, // "yes" is not boolean true
      { text: 'B', passed: true, evidence: 'q' },
      { text: 'C', passed: false, evidence: 'not graded' },
    ]);
    expect(parseVerdict(undefined, 'garbage', ['A'])).toBeUndefined();
  });
});
