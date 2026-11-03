import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/library/frontmatter.js';
import { renderTemplate } from '../src/generation/render-prompt.js';
import { startGenerateSkill } from '../src/generation/generate-skill-job.js';
import { makeTestApp, waitForJob } from './fixtures/fake-claude/test-kit.js';

afterEach(() => {
  delete process.env.FAKE_CLAUDE_GENERATE;
  delete process.env.FAKE_CLAUDE_AUTH;
});

const request = { books: ['demo'], goal: 'Audit the onboarding flow of a SaaS app', notes: 'Be terse' };

describe('generate skill job', () => {
  it('writes the skill, stamps metadata, scopes tools, and passes lint', async () => {
    const app = makeTestApp();
    const job = await startGenerateSkill(app.ctx, request);
    expect(job.target).toBe('skills/audit-the-onboarding-flow-of-a-saas-app');
    const done = await waitForJob(app.ctx, job.id);
    expect(done.status).toBe('succeeded');
    const name = 'audit-the-onboarding-flow-of-a-saas-app';
    expect(done.result).toEqual({ skill: name });

    const doc = app.ctx.skills.read(name);
    expect(doc.summary.lint.filter((i) => i.level === 'error')).toEqual([]);
    expect(doc.summary.frontmatter.metadata).toMatchObject({ generator: 'skillshelf', goal: request.goal, source: 'Demo Book — Ada Author', model: 'sonnet' });
    expect(doc.summary.frontmatter.metadata?.['generated-at']).toMatch(/^\d{4}-/);
    // evals.json skill_name is pinned to the folder name.
    expect(JSON.parse(readFileSync(path.join(app.ctx.skills.skillDir(name), 'evals/evals.json'), 'utf8')).skill_name).toBe(name);

    const [call] = app.calls();
    expect(call!.cwd).toContain('library');
    expect(call!.argv).toContain('--allowedTools');
    expect(call!.argv[call!.argv.indexOf('--allowedTools') + 1]).toBe(`Read(books/**) Read(skills/${name}/**) Edit(skills/${name}/**)`);
    expect(call!.argv[call!.argv.indexOf('--disallowedTools') + 1]).toBe('Bash WebFetch WebSearch');
    expect(call!.prompt).toContain(`Output directory: skills/${name}/`);
    expect(call!.prompt).toContain('| 1 | Activation | books/demo/markdown/01-activation.md | 200 |');
    expect(call!.prompt).toContain('Intro / basics');
    expect(call!.prompt).toContain('Be terse');
    expect(call!.prompt).toContain('evals/evals.json');
    expect(call!.prompt).not.toMatch(/\{\{/);
    // Job log carries Claude's tool activity.
    expect(app.ctx.jobs.getLog(job.id).some((l) => l.message.startsWith('Write skills/'))).toBe(true);
  });

  it('runs one lint fix pass when the first draft has errors', async () => {
    process.env.FAKE_CLAUDE_GENERATE = 'bad-first';
    const app = makeTestApp();
    const job = await startGenerateSkill(app.ctx, { ...request, name: 'onboarding-audit' });
    expect((await waitForJob(app.ctx, job.id)).status).toBe('succeeded');
    expect(app.calls()).toHaveLength(2);
    expect(app.calls()[1]!.prompt).toContain('link-broken');
    expect(app.ctx.skills.read('onboarding-audit').summary.lint.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('fails the job when lint errors remain, or SKILL.md is missing', async () => {
    const app = makeTestApp();
    process.env.FAKE_CLAUDE_GENERATE = 'always-bad';
    const bad = await waitForJob(app.ctx, (await startGenerateSkill(app.ctx, { ...request, name: 'bad-skill' })).id);
    expect(bad.status).toBe('failed');
    expect(bad.error).toMatch(/link-broken/);

    process.env.FAKE_CLAUDE_GENERATE = 'none';
    const none = await waitForJob(app.ctx, (await startGenerateSkill(app.ctx, { ...request, name: 'none-skill' })).id);
    expect(none.status).toBe('failed');
    expect(none.error).toMatch(/without writing/);
  });

  it('validates input at the boundary', async () => {
    const app = makeTestApp();
    const reject = (body: unknown, status: number, msg: RegExp) => expect(startGenerateSkill(app.ctx, body)).rejects.toMatchObject({ status, message: expect.stringMatching(msg) });
    await reject({ ...request, goal: '  ' }, 400, /Goal/);
    await reject({ ...request, books: [] }, 400, /book/);
    await reject({ ...request, books: ['nope'] }, 404, /not found/i);
    await reject({ ...request, name: 'Bad Name' }, 400, /lowercase/);
    await reject({ ...request, name: 'my-claude-skill' }, 400, /reserved/);
    await reject({ ...request, chapters: { demo: [9] } }, 400, /chapter index 9/);
    await reject({ ...request, model: '--bad' }, 400, /model/i);
    process.env.FAKE_CLAUDE_AUTH = 'api-key';
    await reject(request, 503, /claude\.ai/);
    expect(app.calls()).toHaveLength(0);
  });

  it('returns 409 when the skill exists or a job is running for it', async () => {
    const app = makeTestApp();
    const first = await startGenerateSkill(app.ctx, { ...request, name: 'dup-skill' });
    await expect(startGenerateSkill(app.ctx, { ...request, name: 'dup-skill' })).rejects.toMatchObject({ status: 409 });
    await waitForJob(app.ctx, first.id);
    expect(existsSyncSkill(app, 'dup-skill')).toBe(true);
    await expect(startGenerateSkill(app.ctx, { ...request, name: 'dup-skill' })).rejects.toMatchObject({ status: 409 });
  });

  it('limits the chapter table to the selected chapters', async () => {
    const app = makeTestApp();
    const job = await startGenerateSkill(app.ctx, { ...request, name: 'limited', chapters: { demo: [1] } });
    await waitForJob(app.ctx, job.id);
    const prompt = app.calls()[0]!.prompt;
    expect(prompt).toContain('01-activation.md');
    expect(prompt).not.toContain('00-intro.md');
  });
});

function existsSyncSkill(app: ReturnType<typeof makeTestApp>, name: string): boolean {
  return existsSync(path.join(app.ctx.skills.skillDir(name), 'SKILL.md'));
}

describe('renderTemplate', () => {
  it('handles if-blocks, variables, and never re-expands values', () => {
    expect(renderTemplate('a {{x}} b\n{{#if on}}\nyes {{x}}\n{{/if}}\n{{#if off}}no{{/if}}end', { x: '{{y}}', on: '1', off: '' })).toBe('a {{y}} b\nyes {{y}}\nend');
    expect(() => renderTemplate('{{missing}}', {})).toThrow(/missing/);
  });
  it('real prompts render without leftovers', async () => {
    const { renderPromptFile } = await import('../src/generation/render-prompt.js');
    const dir = makeTestApp().ctx.config.promptsDir;
    const common = { skill_name: 's', output_dir: 'skills/s/', today: '2026-01-01' };
    const vars: Record<string, Record<string, string>> = {
      'generate-skill.md': { ...common, goal: 'g', notes: 'n', books_section: 'b', with_evals: 'yes' },
      'revise-skill.md': { ...common, feedback: 'f', failed_cases: 'fc', books_available: 'b' },
      'fix-skill-lint.md': { ...common, lint_errors: 'e' },
      'grade-answer.md': { prompt: 'p', expected_output: 'e', answer: 'a', files_produced: '', expectations_json: '[]' },
    };
    for (const [file, v] of Object.entries(vars)) expect(renderPromptFile(dir, file, v)).not.toMatch(/\{\{/);
    expect(renderPromptFile(dir, 'generate-skill.md', { ...vars['generate-skill.md']!, with_evals: '' })).not.toContain('evals.json');
  });
});

describe('frontmatter round trip', () => {
  it('keeps the body intact after stamping', () => {
    expect(parseFrontmatter('---\nname: a\n---\n\nbody').body.trim()).toBe('body');
  });
});

describe('provenance stamping', () => {
  it('leaves SKILL.md untouched when its frontmatter does not parse', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const os = await import('node:os');
    const { stampSkillFile } = await import('../src/generation/skill-authoring.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'b2s-stamp-'));
    const broken = '---\nname: x\ndescription: Audits. Use when: the user asks\n---\n\nbody\n';
    writeFileSync(path.join(dir, 'SKILL.md'), broken);
    stampSkillFile(dir, 'x', { generator: 'skillshelf' });
    expect(readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).toBe(broken);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('skill names', () => {
  it('rejects names outside the skill name pattern', async () => {
    const app = makeTestApp();
    for (const bad of ['a b', 'a)', 'A', '*', 'a--b', '..', '']) expect(() => app.ctx.skills.skillDir(bad), bad).toThrow(/Invalid skill name/);
    expect(app.ctx.skills.exists('a b')).toBe(false);
  });
});

describe('duplicate submits', () => {
  it('refuses the second of two concurrent generate requests for the same name', async () => {
    const app = makeTestApp();
    const results = await Promise.allSettled([
      startGenerateSkill(app.ctx, { ...request, name: 'twin' }),
      startGenerateSkill(app.ctx, { ...request, name: 'twin' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    for (const r of results) if (r.status === 'fulfilled') await waitForJob(app.ctx, r.value.id);
  });
});
