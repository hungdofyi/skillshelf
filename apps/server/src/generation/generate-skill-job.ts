/**
 * POST /api/skills/generate: validate the request, then run a background job that has Claude
 * read the selected chapters and write skills/<name>/{SKILL.md, references/, evals/evals.json}.
 */
import { existsSync } from 'node:fs';
import { EFFORTS, type GenerateSkillRequest, type Job, SKILL_NAME_MAX, SKILL_NAME_PATTERN, SKILL_RESERVED_WORDS, slugify } from '@b2s/shared';
import { z } from 'zod';
import type { AppContext } from '../app-context.js';
import { assertClaudeReady } from '../claude/claude-status.js';
import { runClaude } from '../claude/claude-runner.js';
import { HttpError } from '../http-error.js';
import { type BookSelection, formatSource, renderBooksSection } from './book-context.js';
import { AUTHORING_EFFORT, resolveEffort } from './effort-option.js';
import { resolveModel } from './model-option.js';
import { renderPromptFile } from './render-prompt.js';
import { authoringToolScope, finalizeSkill, logClaudeEvent } from './skill-authoring.js';

const requestSchema = z.object({
  books: z.array(z.string().min(1)).min(1, 'Pick at least one book'),
  goal: z.string().trim().min(1, 'Goal is required').max(2000),
  name: z.string().trim().optional(),
  notes: z.string().max(5000).optional(),
  chapters: z.record(z.string(), z.array(z.number().int().min(0))).optional(),
  model: z.string().optional(),
  effort: z.enum(EFFORTS).optional(),
  withEvals: z.boolean().optional(),
});

export function resolveSkillName(goal: string, name?: string): string {
  const skillName = name?.trim() || slugify(goal, 48);
  if (skillName.length > SKILL_NAME_MAX || !SKILL_NAME_PATTERN.test(skillName)) {
    throw new HttpError(400, 'Skill name must be lowercase letters, digits and single hyphens (max 64 characters).');
  }
  const reserved = SKILL_RESERVED_WORDS.find((w) => skillName.includes(w));
  if (reserved) throw new HttpError(400, `Skill name must not contain the reserved word "${reserved}". Choose another name.`);
  return skillName;
}

export async function startGenerateSkill(ctx: AppContext, body: unknown): Promise<Job> {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  const req: GenerateSkillRequest = parsed.data;
  const goal = req.goal.trim();
  const name = resolveSkillName(goal, req.name);
  const model = resolveModel(req.model, ctx.config.models.generate);
  const effort = resolveEffort(req.effort, AUTHORING_EFFORT);

  const slugs = [...new Set(req.books)];
  const selection: BookSelection[] = slugs.map((slug) => {
    const manifest = ctx.books.manifest(slug); // 404 unknown, 409 not converted
    const chapters = req.chapters?.[slug];
    if (chapters) {
      const known = new Set(manifest.chapters.map((c) => c.index));
      const missing = chapters.filter((i) => !known.has(i));
      if (missing.length) throw new HttpError(400, `Book "${slug}" has no chapter index ${missing.join(', ')}`);
      if (chapters.length === 0) throw new HttpError(400, `Chapter selection for "${slug}" is empty`);
    }
    return { slug, manifest, chapters };
  });
  for (const slug of Object.keys(req.chapters ?? {})) if (!slugs.includes(slug)) throw new HttpError(400, `Chapter selection given for "${slug}", which is not in "books"`);

  const target = `skills/${name}`;
  if (existsSync(ctx.skills.skillDir(name))) throw new HttpError(409, `Skill "${name}" already exists. Choose another name or revise it.`);
  if (ctx.jobs.isBusy(target)) throw new HttpError(409, `Another job is already working on ${target}`);
  try {
    await assertClaudeReady(ctx.config);
  } catch (err) {
    throw new HttpError(503, err instanceof Error ? err.message : String(err));
  }
  // The status check awaited: a double submit may have created the skill or job meanwhile.
  if (existsSync(ctx.skills.skillDir(name))) throw new HttpError(409, `Skill "${name}" already exists. Choose another name or revise it.`);
  if (ctx.jobs.isBusy(target)) throw new HttpError(409, `Another job is already working on ${target}`);

  const withEvals = req.withEvals !== false;
  return ctx.jobs.create({ kind: 'generate', title: `Generate skill ${name}`, target }, async (job) => {
    job.log(`Generating "${name}" from ${slugs.join(', ')} with ${model} (effort ${effort})`);
    const prompt = renderPromptFile(ctx.config.promptsDir, 'generate-skill.md', {
      goal,
      notes: req.notes?.trim() || '(none)',
      skill_name: name,
      output_dir: `skills/${name}/`,
      today: new Date().toISOString().slice(0, 10),
      books_section: renderBooksSection(selection),
      with_evals: withEvals ? 'yes' : '',
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
    if (!ctx.skills.exists(name)) throw new Error(`Claude finished without writing skills/${name}/SKILL.md`);

    await finalizeSkill({
      ctx,
      job,
      skillName: name,
      model,
      effort,
      metadata: {
        generator: 'skillshelf',
        goal,
        source: formatSource(selection.map((s) => s.manifest)),
        'generated-at': new Date().toISOString(),
        model,
        effort,
      },
    });
    job.log(`Skill ready: skills/${name}/`);
    return { skill: name };
  });
}
