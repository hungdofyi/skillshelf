/**
 * POST /api/books/:slug/summarize: validate the request, then run a background job that has Claude
 * read the chosen chapters and write books/<slug>/summaries/<stamp>-<length>-<structure>.md with a
 * link to every chapter. Afterwards broken links are turned into plain text and provenance is stamped.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EFFORTS, type BookManifest, type Job, type SummarizeBookRequest } from '@b2s/shared';
import { z } from 'zod';
import type { AppContext } from '../app-context.js';
import { runClaude } from '../claude/claude-runner.js';
import { assertClaudeReady } from '../claude/claude-status.js';
import { HttpError } from '../http-error.js';
import { parseFrontmatter, stringifyFrontmatter } from '../library/frontmatter.js';
import { SUMMARY_EFFORT, resolveEffort } from './effort-option.js';
import { resolveModel } from './model-option.js';
import { renderPromptFile } from './render-prompt.js';
import { logClaudeEvent } from './skill-authoring.js';
import { stripBrokenChapterLinks } from './summary-links.js';

const requestSchema = z.object({
  length: z.enum(['brief', 'standard', 'detailed']).optional(),
  structure: z.enum(['chapters', 'ideas', 'both']).optional(),
  focus: z.string().trim().max(500, 'Focus must be at most 500 characters').optional(),
  chapters: z.array(z.number().int().min(0)).min(1, 'Pick at least one chapter').optional(),
  model: z.string().optional(),
  effort: z.enum(EFFORTS).optional(),
});

/** Tools for the summary agent: read this book, write only inside its summaries folder. */
export function summaryToolScope(slug: string) {
  return {
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
    allowedTools: [`Read(books/${slug}/**)`, `Edit(books/${slug}/summaries/**)`],
    disallowedTools: ['Bash', 'WebFetch', 'WebSearch'],
    permissionMode: 'dontAsk' as const,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYYMMDD-HHmm` in local time, so files sort chronologically and read as the user's clock. */
export function summaryStamp(now = new Date()): string {
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function uniqueSummaryPath(ctx: AppContext, slug: string, base: string): string {
  const dir = path.join(ctx.books.bookDir(slug), 'summaries');
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!existsSync(path.join(dir, `${name}.md`))) return `books/${slug}/summaries/${name}.md`;
  }
}

/** Chapter table with the exact relative link from the summaries folder to each chapter file. */
function renderChapterTable(manifest: BookManifest, wanted: Set<number> | undefined): string {
  const rows = manifest.chapters
    .filter((c) => !wanted || wanted.has(c.index))
    .map((c) => `| ${c.index} | ${c.title.replace(/\|/g, '/')} | ../${c.file} | books/${manifest.slug}/${c.file} | ${c.words} |`);
  return ['| Ch | Title | Link | File | Words |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

export async function startSummarizeBook(ctx: AppContext, slug: string, body: unknown): Promise<{ job: Job; path: string }> {
  const parsed = requestSchema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  const req: SummarizeBookRequest = parsed.data;
  const manifest = ctx.books.manifest(slug); // 404 unknown, 409 not converted
  const length = req.length ?? 'standard';
  const structure = req.structure ?? 'both';
  const focus = req.focus?.trim() || undefined;
  const model = resolveModel(req.model, ctx.config.models.generate);
  const effort = resolveEffort(req.effort, SUMMARY_EFFORT);

  const known = new Set(manifest.chapters.map((c) => c.index));
  const wanted = req.chapters ? new Set(req.chapters) : undefined;
  if (wanted) {
    const missing = [...wanted].filter((i) => !known.has(i));
    if (missing.length) throw new HttpError(400, `Book "${slug}" has no chapter index ${missing.join(', ')}`);
  }
  const selected = manifest.chapters.filter((c) => !wanted || wanted.has(c.index));
  if (selected.length === 0) throw new HttpError(400, `Book "${slug}" has no chapters to summarize`);

  const target = `books/${slug}/summaries`;
  if (ctx.jobs.isBusy(target)) throw new HttpError(409, `Another summary is already being written for "${slug}"`);
  try {
    await assertClaudeReady(ctx.config);
  } catch (err) {
    throw new HttpError(503, err instanceof Error ? err.message : String(err));
  }
  // The status check awaited: a double submit may have queued a job meanwhile.
  if (ctx.jobs.isBusy(target)) throw new HttpError(409, `Another summary is already being written for "${slug}"`);

  const outputPath = uniqueSummaryPath(ctx, slug, `${summaryStamp()}-${length}-${structure}`);
  const authors = manifest.authors.length ? manifest.authors.join(', ') : 'unknown author';
  const job = ctx.jobs.create({ kind: 'summarize', title: `Summarize ${manifest.title}`, target }, async (jobCtx) => {
    jobCtx.log(`Summarizing "${slug}" (${selected.length} chapters, ${length}, ${structure}) with ${model} (effort ${effort})`);
    const prompt = renderPromptFile(ctx.config.promptsDir, 'summarize-book.md', {
      today: new Date().toISOString().slice(0, 10),
      output_path: outputPath,
      book_title: manifest.title,
      authors,
      book_slug: slug,
      chapter_count: String(selected.length),
      chapters_table: renderChapterTable(manifest, wanted),
      length,
      structure,
      focus,
      relevance_line: focus ? '**Relevance: High|Medium|Low.** One line saying why, tied to the reader focus.\n\n' : '',
      relevance_instruction: structure === 'ideas'
        ? 'Tag every key idea with `**Relevance: High|Medium|Low.**` and a one-line reason tied to the reader focus. '
        : 'Rate every chapter section High, Medium or Low for the reader focus, with a one-line reason that names what in the chapter matters (or does not) for them. ',
      len_brief: length === 'brief' ? '1' : '',
      len_standard: length === 'standard' ? '1' : '',
      len_detailed: length === 'detailed' ? '1' : '',
      has_ideas: structure !== 'chapters' ? '1' : '',
      has_chapters: structure !== 'ideas' ? '1' : '',
      both: structure === 'both' ? '1' : '',
      chapters_only: structure === 'chapters' ? '1' : '',
      ideas_only: structure === 'ideas' ? '1' : '',
    });
    const result = await runClaude(ctx.config, {
      cwd: ctx.config.libraryDir,
      prompt,
      model,
      effort,
      ...summaryToolScope(slug),
      signal: jobCtx.signal,
      onEvent: logClaudeEvent(jobCtx),
    });
    if (result.isError) throw new Error(`Claude reported an error: ${result.text.slice(0, 500) || '(no message)'}`);
    const file = path.join(ctx.config.libraryDir, outputPath);
    if (!existsSync(file)) throw new Error(`Claude finished without writing ${outputPath}`);

    finalizeSummary({ ctx, log: jobCtx.log.bind(jobCtx), file, slug, manifest, outputPath, length, structure, focus, model, effort });
    jobCtx.log(`Summary ready: ${outputPath}`);
    return { path: outputPath };
  });
  return { job, path: outputPath };
}

interface FinalizeInput {
  ctx: AppContext;
  log: (message: string, opts?: { level?: 'warn' | 'info' }) => void;
  file: string;
  slug: string;
  manifest: BookManifest;
  outputPath: string;
  length: string;
  structure: string;
  focus?: string;
  model: string;
  effort: string;
}

/** Plain-text broken chapter links, then stamp provenance. Throws when the file has no usable body. */
function finalizeSummary(i: FinalizeInput): void {
  const parsed = parseFrontmatter(readFileSync(i.file, 'utf8'));
  if (parsed.error) i.log(`Summary frontmatter did not parse (${parsed.error}); it was replaced`, { level: 'warn' });
  if (!parsed.body.trim()) throw new Error(`${i.outputPath} is empty`);

  const chapterFiles = new Set(i.manifest.chapters.map((c) => `books/${i.slug}/${c.file}`));
  const existing = new Set([...chapterFiles].filter((f) => existsSync(path.join(i.ctx.config.libraryDir, f))));
  const check = stripBrokenChapterLinks(parsed.body, `books/${i.slug}/summaries`, existing);
  if (check.broken.length) i.log(`Turned ${check.broken.length} broken chapter link(s) into plain text: ${[...new Set(check.broken)].join(', ')}`, { level: 'warn' });
  if (check.valid === 0) i.log('The summary has no working chapter links', { level: 'warn' });

  const prior = parsed.error ? {} : parsed.data;
  const title = typeof prior.title === 'string' && prior.title.trim() ? prior.title.trim() : `Summary: ${i.manifest.title}`;
  const data = {
    title,
    book: i.slug,
    generator: 'skillshelf',
    settings: { length: i.length, structure: i.structure, ...(i.focus ? { focus: i.focus } : {}) },
    model: i.model,
    effort: i.effort,
    'generated-at': new Date().toISOString(),
  };
  writeFileSync(i.file, stringifyFrontmatter(data, check.body));
}
