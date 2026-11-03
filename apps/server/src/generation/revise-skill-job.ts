/**
 * POST /api/skills/:name/revise: back up the skill, then have Claude edit it in place from
 * free-text feedback and, optionally, the failed cases of an eval run.
 */
import { existsSync } from 'node:fs';
import { EFFORTS, type EvalFile, type Job } from '@b2s/shared';
import { z } from 'zod';
import type { AppContext } from '../app-context.js';
import { runClaude } from '../claude/claude-runner.js';
import { assertClaudeReady } from '../claude/claude-status.js';
import { HttpError } from '../http-error.js';
import { describeFailedCases } from './failed-cases-context.js';
import { AUTHORING_EFFORT, resolveEffort } from './effort-option.js';
import { resolveModel } from './model-option.js';
import { renderPromptFile } from './render-prompt.js';
import { authoringToolScope, finalizeSkill, logClaudeEvent } from './skill-authoring.js';
import { backupSkill } from './skill-backup.js';

const requestSchema = z
  .object({
    feedback: z.string().trim().max(10_000).default(''),
    evalRunId: z.string().optional(),
    model: z.string().optional(),
    effort: z.enum(EFFORTS).optional(),
  })
  .refine((r) => r.feedback.length > 0 || Boolean(r.evalRunId), { message: 'Feedback is required unless an eval run is selected', path: ['feedback'] });

export async function startReviseSkill(ctx: AppContext, name: string, body: unknown): Promise<Job> {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  const req = parsed.data;
  const skillDir = ctx.skills.skillDir(name);
  if (!ctx.skills.exists(name)) throw new HttpError(404, `Skill not found: ${name}`);
  const target = `skills/${name}`;
  if (ctx.jobs.isBusy(target)) throw new HttpError(409, `Another job is already working on ${target}`);
  const model = resolveModel(req.model, ctx.config.models.generate);
  const effort = resolveEffort(req.effort, AUTHORING_EFFORT);

  let evals: EvalFile | undefined;
  try {
    evals = ctx.skills.readEvals(name);
  } catch {
    evals = undefined;
  }
  const failedCases = req.evalRunId ? describeFailedCases(ctx.config.libraryDir, name, req.evalRunId, evals) : '';
  if (!req.feedback && !failedCases) throw new HttpError(400, 'That eval run has no failed cases to revise from; write some feedback instead.');
  try {
    await assertClaudeReady(ctx.config);
  } catch (err) {
    throw new HttpError(503, err instanceof Error ? err.message : String(err));
  }
  // The status check awaited: another request may have queued a job for this skill meanwhile.
  if (ctx.jobs.isBusy(target)) throw new HttpError(409, `Another job is already working on ${target}`);

  return ctx.jobs.create({ kind: 'revise', title: `Revise skill ${name}`, target }, async (job) => {
    const backup = backupSkill(ctx.config.dataDir, name, skillDir);
    job.log(`Backed up the current skill to ${backup}`);
    const books = ctx.books
      .list()
      .filter((b) => b.manifest)
      .map((b) => `- \`${b.slug}\`: ${b.manifest!.title}${b.manifest!.authors.length ? ` (${b.manifest!.authors.join(', ')})` : ''}`)
      .join('\n');
    const prompt = renderPromptFile(ctx.config.promptsDir, 'revise-skill.md', {
      skill_name: name,
      output_dir: `skills/${name}/`,
      today: new Date().toISOString().slice(0, 10),
      feedback: req.feedback || '(No written feedback. Address the evaluation evidence below.)',
      failed_cases: failedCases,
      books_available: books || '(none)',
    });
    const result = await runClaude(ctx.config, {
      cwd: ctx.config.libraryDir,
      prompt,
      model,
      effort,
      ...authoringToolScope(name),
      signal: job.signal,
      onEvent: logClaudeEvent(job),
    });
    if (result.isError) throw new Error(`Claude reported an error: ${result.text.slice(0, 500) || '(no message)'}`);
    if (!existsSync(`${skillDir}/SKILL.md`)) throw new Error('SKILL.md is missing after the revision; restore it from the backup.');

    await finalizeSkill({ ctx, job, skillName: name, model, effort, metadata: { 'revised-at': new Date().toISOString(), 'revised-with': model, 'revised-effort': effort } });
    job.log(`Revision finished: skills/${name}/ (backup: ${backup})`);
    return { skill: name, backup };
  });
}
