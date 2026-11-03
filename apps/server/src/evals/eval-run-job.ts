/**
 * POST /api/evals/:skill/run: for every eval case, run a headless agent with the skill installed in
 * a sandbox (with_skill) and without it (baseline), grade each answer with a judge, and persist
 * library/evals/<skill>/<runId>/run.json after every result so the UI can follow along.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { EFFORTS, type EvalArm, type EvalCase, type EvalCaseArmResult, type EvalRun, type Job } from '@b2s/shared';
import { z } from 'zod';
import type { AppContext } from '../app-context.js';
import { ClaudeAbortedError, runClaude } from '../claude/claude-runner.js';
import { assertClaudeReady } from '../claude/claude-status.js';
import { detectSkillTrigger } from '../claude/detect-skill-trigger.js';
import type { JobContext } from '../jobs/job-manager.js';
import { logClaudeEvent } from '../generation/skill-authoring.js';
import { AGENT_EFFORT, JUDGE_EFFORT, resolveEffort } from '../generation/effort-option.js';
import { resolveModel } from '../generation/model-option.js';
import { HttpError } from '../http-error.js';
import { gradeAnswer } from './eval-judge.js';
import { caseDirName, evalRunDir, writeEvalRun } from './eval-paths.js';
import { collectProducedFiles, createSandbox } from './eval-sandbox.js';
import { summarizeRun } from './eval-summary.js';

const requestSchema = z.object({
  arms: z.array(z.enum(['with_skill', 'baseline'])).min(1).optional(),
  caseIds: z.array(z.union([z.string(), z.number()])).optional(),
  model: z.string().optional(),
  judgeModel: z.string().optional(),
  effort: z.enum(EFFORTS).optional(),
  // Out-of-range values are clamped to 1..MAX_CONCURRENCY rather than rejected.
  concurrency: z.number().finite().optional(),
});

const MAX_CONCURRENCY = 4;

/** `YYYYMMDD-HHmmss-xxxx` in UTC, so ids sort chronologically. */
export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

export async function startEvalRun(ctx: AppContext, skill: string, body: unknown): Promise<{ job: Job; runId: string }> {
  const parsed = requestSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  const req = parsed.data;
  if (!ctx.skills.exists(skill)) throw new HttpError(404, `Skill not found: ${skill}`);
  const evalFile = ctx.skills.readEvals(skill); // 404 when missing, 422 when invalid
  if (!Array.isArray(evalFile.evals) || evalFile.evals.length === 0) throw new HttpError(422, `Skill "${skill}" has no eval cases`);
  const ids = evalFile.evals.map((c) => String(c.id));
  if (new Set(ids).size !== ids.length) throw new HttpError(422, 'Eval case ids must be unique');

  const wanted = req.caseIds ? new Set(req.caseIds.map(String)) : undefined;
  const cases = evalFile.evals.filter((c) => !wanted || wanted.has(String(c.id)));
  if (cases.length === 0) throw new HttpError(400, 'None of the requested case ids exist in evals.json');

  if (ctx.jobs.isBusy(`evals/${skill}`) || ctx.jobs.isBusy(`skills/${skill}`)) throw new HttpError(409, `Another job is already working on "${skill}"`);
  try {
    await assertClaudeReady(ctx.config);
  } catch (err) {
    throw new HttpError(503, err instanceof Error ? err.message : String(err));
  }
  // The status check awaited: another request may have started a job on this skill meanwhile.
  if (ctx.jobs.isBusy(`evals/${skill}`) || ctx.jobs.isBusy(`skills/${skill}`)) throw new HttpError(409, `Another job is already working on "${skill}"`);

  const arms: EvalArm[] = req.arms ? [...new Set(req.arms)] : ['with_skill', 'baseline'];
  const model = resolveModel(req.model, ctx.config.models.eval);
  const judgeModel = resolveModel(req.judgeModel, ctx.config.models.judge);
  const effort = resolveEffort(req.effort, AGENT_EFFORT);
  const runId = newRunId();
  const runDir = evalRunDir(ctx.config.libraryDir, skill, runId);
  mkdirSync(runDir, { recursive: true });

  const run: EvalRun = {
    id: runId,
    skill,
    skillHash: ctx.skills.hash(skill),
    model,
    judgeModel,
    effort,
    judgeEffort: JUDGE_EFFORT,
    arms,
    caseIds: cases.map((c) => String(c.id)),
    status: 'running',
    startedAt: new Date().toISOString(),
    results: [],
    summary: {},
  };
  writeEvalRun(runDir, run);

  const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(req.concurrency ?? 2)));
  const job = ctx.jobs.create(
    {
      kind: 'eval',
      title: `Evaluate skill ${skill}`,
      target: `evals/${skill}`,
      // Cancelled while still queued: the runner never starts, so close the run record here.
      onCancelledBeforeStart: () => closeRun(runDir, run, 'cancelled'),
    },
    (jobCtx) => executeEvalRun(ctx, jobCtx, { run, runDir, cases, concurrency }),
  );
  return { job, runId };
}

interface ExecuteInput {
  run: EvalRun;
  runDir: string;
  cases: EvalCase[];
  concurrency: number;
}

/** Persist a terminal status so run.json never stays "running" after its job is over. */
function closeRun(runDir: string, run: EvalRun, status: 'failed' | 'cancelled'): void {
  run.status = status;
  run.finishedAt = new Date().toISOString();
  try {
    writeEvalRun(runDir, run);
  } catch (err) {
    console.warn(`eval run ${run.id}: could not write final status: ${err instanceof Error ? err.message : err}`);
  }
}

async function executeEvalRun(ctx: AppContext, job: JobContext, input: ExecuteInput) {
  try {
    return await executeEvalRunUnsafe(ctx, job, input);
  } catch (err) {
    // run.json may already be final (every unit errored); only fix up a run that is still open.
    if (input.run.status === 'running') closeRun(input.runDir, input.run, job.signal.aborted ? 'cancelled' : 'failed');
    throw err;
  }
}

async function executeEvalRunUnsafe(ctx: AppContext, job: JobContext, { run, runDir, cases, concurrency }: ExecuteInput) {
  const shouldTrigger: Record<string, boolean> = Object.fromEntries(cases.map((c) => [String(c.id), c.should_trigger !== false]));
  const skillDir = ctx.skills.skillDir(run.skill);
  const tasks = cases.flatMap((c) => run.arms.map((arm) => ({ evalCase: c, arm })));
  let done = 0;
  job.progress(0, tasks.length, 'starting');

  const record = (result: EvalCaseArmResult) => {
    run.results.push(result);
    run.summary = summarizeRun(run.results, shouldTrigger);
    writeEvalRun(runDir, run);
    job.progress(++done, tasks.length, `${result.caseId} / ${result.arm}: ${result.status}`);
    job.log(`Case ${result.caseId} [${result.arm}] ${result.status} (score ${result.score})`, { level: result.status === 'error' ? 'warn' : 'info' });
  };

  const queue = [...tasks];
  const worker = async () => {
    for (let task = queue.shift(); task && !job.signal.aborted; task = queue.shift()) {
      try {
        record(await runUnit(ctx, job, run, runDir, skillDir, task.evalCase, task.arm));
      } catch (err) {
        if (err instanceof ClaudeAbortedError || job.signal.aborted) return;
        record(errorResult(task.evalCase, task.arm, err));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));

  run.finishedAt = new Date().toISOString();
  const everyUnitErrored = run.results.length > 0 && run.results.every((r) => r.status === 'error');
  run.status = job.signal.aborted ? 'cancelled' : everyUnitErrored ? 'failed' : 'succeeded';
  run.summary = summarizeRun(run.results, shouldTrigger);
  writeEvalRun(runDir, run);
  if (run.status === 'failed') throw new Error(`Every eval run errored: ${run.results[0]?.error ?? 'unknown error'}`);
  return { runId: run.id };
}

function errorResult(evalCase: EvalCase, arm: EvalArm, err: unknown): EvalCaseArmResult {
  return { caseId: String(evalCase.id), arm, status: 'error', expectations: [], score: 0, error: err instanceof Error ? err.message : String(err) };
}

async function runUnit(ctx: AppContext, job: JobContext, run: EvalRun, runDir: string, skillDir: string, evalCase: EvalCase, arm: EvalArm): Promise<EvalCaseArmResult> {
  const caseId = String(evalCase.id);
  const expectTrigger = evalCase.should_trigger !== false;
  if (arm === 'baseline' && !expectTrigger) return { caseId, arm, status: 'skipped', expectations: [], score: 0, judgeSummary: 'Near-miss case: baseline not needed.' };

  const relDir = `cases/${caseDirName(evalCase.id)}/${arm}`;
  const outDir = path.join(runDir, relDir);
  mkdirSync(outDir, { recursive: true });
  const sandbox = createSandbox({ skillName: run.skill, skillDir: arm === 'with_skill' ? skillDir : undefined, caseFiles: evalCase.files, skillRootForFiles: skillDir });
  const transcriptFile = path.join(outDir, 'transcript.jsonl');
  try {
    const agent = await runClaude(ctx.config, {
      cwd: sandbox.dir,
      prompt: evalCase.prompt,
      model: run.model,
      effort: run.effort ?? AGENT_EFFORT,
      tools: ['Skill', 'Read', 'Glob', 'Grep', 'Write', 'Edit'],
      // Read/Edit are scoped to the sandbox cwd; Read rules also govern Glob and Grep.
      allowedTools: ['Skill', 'Read(./**)', 'Edit(./**)'],
      disallowedTools: ['Bash', 'WebFetch', 'WebSearch'],
      permissionMode: 'dontAsk',
      transcriptFile,
      signal: job.signal,
      onEvent: logClaudeEvent(job),
    });
    writeFileSync(path.join(outDir, 'answer.md'), agent.text);
    const base = {
      caseId,
      arm,
      answerFile: `${relDir}/answer.md`,
      transcriptFile: `${relDir}/transcript.jsonl`,
      durationMs: agent.durationMs,
      numTurns: agent.numTurns,
      triggered: arm === 'with_skill' ? detectSkillTrigger(agent.toolUses, run.skill) : undefined,
    };
    if (agent.isError) return { ...base, status: 'error', expectations: [], score: 0, error: agent.text.slice(0, 500) || 'Claude reported an error' };

    if (!expectTrigger) {
      const passed = base.triggered !== true;
      return { ...base, status: passed ? 'passed' : 'failed', expectations: [], score: passed ? 1 : 0, judgeSummary: passed ? 'Skill correctly not used.' : 'Skill was used on a near-miss prompt.' };
    }
    if (evalCase.expectations.length === 0) return { ...base, status: 'skipped', expectations: [], score: 0, error: 'Case has no expectations to grade' };

    const judgeDir = createSandbox({ skillName: run.skill, skillRootForFiles: skillDir });
    const verdict = await gradeAnswer({
      config: ctx.config,
      promptsDir: ctx.config.promptsDir,
      cwd: judgeDir.dir,
      model: run.judgeModel,
      effort: JUDGE_EFFORT,
      prompt: evalCase.prompt,
      expectedOutput: evalCase.expected_output,
      answer: agent.text,
      filesProduced: collectProducedFiles(sandbox),
      expectations: evalCase.expectations,
      signal: job.signal,
      transcriptFile: path.join(outDir, 'judge-transcript.jsonl'),
    }).catch((err: unknown) => {
      if (err instanceof ClaudeAbortedError) throw err;
      return err instanceof Error ? err : new Error(String(err));
    }).finally(() => judgeDir.dispose());
    if (verdict instanceof Error) return { ...base, status: 'error', expectations: [], score: 0, error: verdict.message };
    const passedCount = verdict.expectations.filter((e) => e.passed).length;
    return {
      ...base,
      status: passedCount === verdict.expectations.length ? 'passed' : 'failed',
      expectations: verdict.expectations,
      score: Math.round((passedCount / verdict.expectations.length) * 1000) / 1000,
      judgeSummary: verdict.summary,
    };
  } finally {
    sandbox.dispose();
  }
}
