import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { BookSummary, Job } from '@b2s/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { clearClaudeStatusCache } from '../src/claude/claude-status.js';
import { createApp } from '../src/app.js';
import { renderPromptFile } from '../src/generation/render-prompt.js';
import { startSummarizeBook } from '../src/generation/summarize-book-job.js';
import { stripBrokenChapterLinks } from '../src/generation/summary-links.js';
import { parseFrontmatter } from '../src/library/frontmatter.js';
import { makeTestApp, waitForJob } from './fixtures/fake-claude/test-kit.js';

afterEach(() => {
  delete process.env.FAKE_CLAUDE_SUMMARY;
  delete process.env.FAKE_CLAUDE_AUTH;
  delete process.env.FAKE_CLAUDE_SLEEP_MS;
});

const arg = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];

describe('summarize book job', () => {
  it('writes the summary, stamps frontmatter, scopes tools and lists it on the book', async () => {
    const app = makeTestApp();
    const { job, path: out } = await startSummarizeBook(app.ctx, 'demo', { length: 'brief', structure: 'chapters', focus: 'I am a PM improving onboarding' });
    expect(out).toMatch(/^books\/demo\/summaries\/\d{8}-\d{4}-brief-chapters\.md$/);
    expect(job).toMatchObject({ kind: 'summarize', target: 'books/demo/summaries' });
    const done = await waitForJob(app.ctx, job.id);
    expect(done.status).toBe('succeeded');
    expect(done.result).toEqual({ path: out });

    const text = readFileSync(path.join(app.ctx.config.libraryDir, out), 'utf8');
    const { data, body } = parseFrontmatter<Record<string, unknown>>(text);
    expect(data).toMatchObject({
      title: 'Fake summary',
      book: 'demo',
      generator: 'skillshelf',
      model: 'sonnet',
      effort: 'medium',
      settings: { length: 'brief', structure: 'chapters', focus: 'I am a PM improving onboarding' },
    });
    expect(String(data['generated-at'])).toMatch(/^\d{4}-/);
    expect(body).toContain('## [Intro / basics](../markdown/00-intro.md)');
    expect(body).toContain('## [Activation](../markdown/01-activation.md)');

    const [call] = app.calls();
    expect(call!.cwd).toContain('library');
    expect(arg(call!.argv, '--tools')).toBe('Read,Glob,Grep,Write,Edit');
    expect(arg(call!.argv, '--allowedTools')).toBe('Read(books/demo/**) Edit(books/demo/summaries/**)');
    expect(arg(call!.argv, '--disallowedTools')).toBe('Bash WebFetch WebSearch');
    expect(arg(call!.argv, '--permission-mode')).toBe('dontAsk');
    expect(arg(call!.argv, '--effort')).toBe('medium');
    expect(call!.prompt).toContain(`Output file: ${out}`);
    expect(call!.prompt).toContain('| 1 | Activation | ../markdown/01-activation.md | books/demo/markdown/01-activation.md | 200 |');
    expect(call!.prompt).toContain('Intro / basics');
    expect(call!.prompt).toContain('I am a PM improving onboarding');
    expect(call!.prompt).toContain('Suggested reading path');
    expect(call!.prompt).toContain('**Brief.**');
    expect(call!.prompt).not.toContain('## Key ideas across the book');
    expect(call!.prompt).not.toMatch(/\{\{/);

    const book: BookSummary = app.ctx.books.get('demo');
    expect(book.summaries).toEqual([
      { path: out, title: 'Fake summary', createdAt: expect.any(String), settings: { length: 'brief', structure: 'chapters', focus: 'I am a PM improving onboarding' } },
    ]);
  });

  it('limits the chapter table and omits the reading path without a focus', async () => {
    const app = makeTestApp();
    const { job } = await startSummarizeBook(app.ctx, 'demo', { chapters: [1], structure: 'ideas', length: 'detailed' });
    await waitForJob(app.ctx, job.id);
    const prompt = app.calls()[0]!.prompt;
    expect(prompt).toContain('01-activation.md');
    expect(prompt).not.toContain('00-intro.md');
    expect(prompt).not.toContain('Suggested reading path');
    expect(prompt).toContain('**Detailed.**');
    expect(prompt).toContain('## Key ideas across the book');
    expect(prompt).not.toContain('### Chapter sections');
  });

  it('turns broken chapter links into plain text and keeps valid and external ones', async () => {
    process.env.FAKE_CLAUDE_SUMMARY = 'broken-link';
    const app = makeTestApp();
    const { job, path: out } = await startSummarizeBook(app.ctx, 'demo', {});
    const done = await waitForJob(app.ctx, job.id);
    expect(done.status).toBe('succeeded');
    const body = parseFrontmatter(readFileSync(path.join(app.ctx.config.libraryDir, out), 'utf8')).body;
    expect(body).toContain('See Ghost and outside and [web](https://example.com/a.md).');
    expect(body).toContain('(../markdown/01-activation.md)');
    expect(app.ctx.jobs.getLog(job.id).some((l) => l.level === 'warn' && l.message.includes('broken chapter link'))).toBe(true);
  });

  it('replaces unparsable frontmatter, adds it when missing, and fails on an empty body or no file', async () => {
    const app = makeTestApp();
    for (const mode of ['bad-frontmatter', 'no-frontmatter']) {
      process.env.FAKE_CLAUDE_SUMMARY = mode;
      const { job, path: out } = await startSummarizeBook(app.ctx, 'demo', { length: mode === 'bad-frontmatter' ? 'brief' : 'detailed' });
      expect((await waitForJob(app.ctx, job.id)).status).toBe('succeeded');
      const parsed = parseFrontmatter<Record<string, unknown>>(readFileSync(path.join(app.ctx.config.libraryDir, out), 'utf8'));
      expect(parsed.error).toBeUndefined();
      expect(parsed.data.title).toBe('Summary: Demo Book');
      expect(parsed.data.generator).toBe('skillshelf');
    }
    process.env.FAKE_CLAUDE_SUMMARY = 'empty';
    const empty = await startSummarizeBook(app.ctx, 'demo', { structure: 'ideas', length: 'brief' });
    const emptyDone = await waitForJob(app.ctx, empty.job.id);
    expect(emptyDone).toMatchObject({ status: 'failed', error: expect.stringMatching(/is empty/) });
    process.env.FAKE_CLAUDE_SUMMARY = 'none';
    const none = await startSummarizeBook(app.ctx, 'demo', { structure: 'chapters', length: 'detailed' });
    expect(await waitForJob(app.ctx, none.job.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/without writing/) });
  });

  it('gives each summary of the same settings and minute its own file', async () => {
    const app = makeTestApp();
    const a = await startSummarizeBook(app.ctx, 'demo', {});
    await waitForJob(app.ctx, a.job.id);
    const b = await startSummarizeBook(app.ctx, 'demo', {});
    await waitForJob(app.ctx, b.job.id);
    expect(a.path).not.toBe(b.path);
    expect(existsSync(path.join(app.ctx.config.libraryDir, a.path))).toBe(true);
    expect(existsSync(path.join(app.ctx.config.libraryDir, b.path))).toBe(true);
    expect(app.ctx.books.get('demo').summaries).toHaveLength(2);
  });

  it('validates at the boundary: 400 / 404 / 409 / 503', async () => {
    const app = makeTestApp();
    const http = createApp(app.ctx);
    const post = (slug: string, body: unknown) => http.request(`/api/books/${slug}/summarize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const bad = async (body: unknown, re: RegExp) => {
      const res = await post('demo', body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(re);
    };
    await bad({ length: 'huge' }, /length/);
    await bad({ structure: 'nope' }, /structure/);
    await bad({ focus: 'x'.repeat(501) }, /500/);
    await bad({ chapters: [] }, /at least one chapter/);
    await bad({ chapters: [7] }, /chapter index 7/);
    await bad({ chapters: [-1] }, /chapters/);
    await bad({ model: '--bad' }, /model/i);
    await bad({ effort: 'ludicrous' }, /effort/);
    expect((await post('missing', {})).status).toBe(404);
    mkdirSync(path.join(app.ctx.config.libraryDir, 'books/raw'), { recursive: true });
    expect((await post('raw', {})).status).toBe(409);

    process.env.FAKE_CLAUDE_AUTH = 'api-key';
    const unready = await post('demo', {});
    expect(unready.status).toBe(503);
    expect(((await unready.json()) as { error: string }).error).toMatch(/claude\.ai/);
    delete process.env.FAKE_CLAUDE_AUTH;
    clearClaudeStatusCache();
    expect(app.calls()).toHaveLength(0);

    // Busy: a second request while the first still runs.
    process.env.FAKE_CLAUDE_SLEEP_MS = '400';
    const first = (await (await post('demo', {})).json()) as { job: Job; path: string };
    expect((await post('demo', {})).status).toBe(409);
    await waitForJob(app.ctx, first.job.id);
    expect((await post('demo', {})).status).toBe(200);
  });

  it('returns the job and output path from the route', async () => {
    const app = makeTestApp();
    const res = await createApp(app.ctx).request('/api/books/demo/summarize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = (await res.json()) as { job: Job; path: string };
    expect(res.status).toBe(200);
    expect(body.path).toMatch(/-standard-both\.md$/);
    await waitForJob(app.ctx, body.job.id);
  });
});

describe('book summaries listing', () => {
  it('lists newest first, falls back to H1 and filename, and ignores non-markdown files', () => {
    const app = makeTestApp();
    const dir = path.join(app.ctx.config.libraryDir, 'books/demo/summaries');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'a.md'), '---\ntitle: Old\ngenerated-at: 2026-01-01T00:00:00.000Z\nsettings:\n  length: brief\n  structure: both\n---\n\nbody');
    writeFileSync(path.join(dir, 'b.md'), '---\ngenerated-at: 2026-06-01T00:00:00.000Z\n---\n\n# Heading title\n');
    writeFileSync(path.join(dir, 'c.md'), 'no frontmatter');
    writeFileSync(path.join(dir, 'notes.txt'), 'x');
    const list = app.ctx.books.get('demo').summaries!;
    expect(list.map((s) => s.title)).toEqual(['c', 'Heading title', 'Old'].sort((x, y) => list.map((s) => s.title).indexOf(x) - list.map((s) => s.title).indexOf(y)));
    expect(list.find((s) => s.title === 'Old')).toMatchObject({ createdAt: '2026-01-01T00:00:00.000Z', settings: { length: 'brief', structure: 'both' } });
    expect(list.find((s) => s.title === 'Heading title')!.createdAt).toBe('2026-06-01T00:00:00.000Z');
    expect(list).toHaveLength(3);
    expect(list[0]!.path).toBe('books/demo/summaries/c.md'); // mtime (now) is newest
  });
});

describe('stripBrokenChapterLinks', () => {
  const valid = new Set(['books/x/markdown/01-a.md']);
  it('keeps resolving links (with anchors), strips the rest, skips code fences and images', () => {
    const md = ['[A](../markdown/01-a.md#top) [B](../markdown/02-b.md) ![i](../markdown/img.md)', '```', '[C](../markdown/03-c.md)', '```', '[D](../../../etc/passwd.md) [E](#x) [F](https://e.com/z.md) [G](../source/s.pdf)'].join('\n');
    const out = stripBrokenChapterLinks(md, 'books/x/summaries', valid);
    expect(out.broken).toEqual(['../markdown/02-b.md', '../../../etc/passwd.md']);
    expect(out.valid).toBe(1);
    expect(out.body).toBe(['[A](../markdown/01-a.md#top) B ![i](../markdown/img.md)', '```', '[C](../markdown/03-c.md)', '```', 'D [E](#x) [F](https://e.com/z.md) [G](../source/s.pdf)'].join('\n'));
  });
});

describe('summarize prompt', () => {
  it('renders every structure and length without leftovers', () => {
    const dir = makeTestApp().ctx.config.promptsDir;
    for (const structure of ['chapters', 'ideas', 'both']) {
      for (const focus of ['', 'PM']) {
        const out = renderPromptFile(dir, 'summarize-book.md', {
          today: '2026-01-01', output_path: 'books/s/summaries/a.md', book_title: 'T', authors: 'A', book_slug: 's', chapter_count: '2', chapters_table: 'tbl',
          length: 'standard', structure, focus, relevance_line: focus ? 'REL' : '', relevance_instruction: 'RI ',
          len_brief: '', len_standard: '1', len_detailed: '',
          has_ideas: structure !== 'chapters' ? '1' : '', has_chapters: structure !== 'ideas' ? '1' : '',
          both: structure === 'both' ? '1' : '', chapters_only: structure === 'chapters' ? '1' : '', ideas_only: structure === 'ideas' ? '1' : '',
        });
        expect(out).not.toMatch(/\{\{|\}\}/);
        expect(out.startsWith('# Summarize a book')).toBe(true);
      }
    }
  });
});
