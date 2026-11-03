/** Turns the failed cases of an eval run into prompt context for skill revision. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { EvalFile } from '@b2s/shared';
import { evalRunDir, readEvalRun } from '../evals/eval-paths.js';

const ANSWER_EXCERPT_CHARS = 1500;
const MAX_CASES = 8;

export function describeFailedCases(libraryDir: string, skill: string, runId: string, evals: EvalFile | undefined): string {
  const run = readEvalRun(libraryDir, skill, runId);
  const runDir = evalRunDir(libraryDir, skill, runId);
  const prompts = new Map((evals?.evals ?? []).map((c) => [String(c.id), c]));
  const failed = run.results.filter((r) => r.arm === 'with_skill' && (r.status === 'failed' || (r.status === 'passed' && prompts.get(r.caseId)?.should_trigger === false && r.triggered)));
  if (failed.length === 0) return '';

  const blocks = failed.slice(0, MAX_CASES).map((r) => {
    const evalCase = prompts.get(r.caseId);
    const lines = [`### Case ${r.caseId}`, '', `Prompt: ${evalCase?.prompt ?? '(prompt not found in evals.json)'}`];
    if (evalCase?.should_trigger === false) {
      lines.push('', 'This was a near-miss prompt: the skill should NOT have been used, but it was.');
    } else {
      if (r.triggered === false) lines.push('', 'The skill was not loaded for this prompt (trigger miss).');
      const failedExpectations = r.expectations.filter((e) => !e.passed);
      if (failedExpectations.length) {
        lines.push('', 'Failed expectations:');
        for (const e of failedExpectations) lines.push(`- ${e.text}\n  Grader evidence: ${e.evidence || 'none'}`);
      }
    }
    if (r.answerFile) {
      // run.json may come from a shared library: only read answers that live inside the run folder.
      const file = path.resolve(runDir, r.answerFile);
      if (file.startsWith(path.resolve(runDir) + path.sep) && existsSync(file)) {
        const text = readFileSync(file, 'utf8');
        lines.push('', 'Start of the answer given:', '', '```', text.slice(0, ANSWER_EXCERPT_CHARS) + (text.length > ANSWER_EXCERPT_CHARS ? '\n[...]' : ''), '```');
      }
    }
    return lines.join('\n');
  });
  if (failed.length > MAX_CASES) blocks.push(`(${failed.length - MAX_CASES} more failed cases not shown)`);
  return blocks.join('\n\n');
}
