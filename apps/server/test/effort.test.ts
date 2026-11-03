import { afterEach, describe, expect, it } from 'vitest';
import { buildClaudeArgs } from '../src/claude/claude-runner.js';
import { startGenerateSkill } from '../src/generation/generate-skill-job.js';
import { startReviseSkill } from '../src/generation/revise-skill-job.js';
import { makeTestApp, waitForJob } from './fixtures/fake-claude/test-kit.js';

afterEach(() => {
  delete process.env.FAKE_CLAUDE_GENERATE;
});

const effortOf = (argv: string[]) => (argv.includes('--effort') ? argv[argv.indexOf('--effort') + 1] : undefined);
const request = { books: ['demo'], goal: 'Audit things', name: 'auditor' };

describe('effort', () => {
  it('only adds --effort when set', () => {
    expect(buildClaudeArgs({ model: 'sonnet', tools: [] })).not.toContain('--effort');
    expect(buildClaudeArgs({ model: 'sonnet', tools: [], effort: 'xhigh' }).join(' ')).toContain('--effort xhigh');
  });

  it('generate: defaults to high, passes a chosen level to the lint fix pass, and stamps metadata', async () => {
    process.env.FAKE_CLAUDE_GENERATE = 'bad-first';
    const app = makeTestApp();
    await waitForJob(app.ctx, (await startGenerateSkill(app.ctx, request)).id);
    expect(app.calls().map((c) => effortOf(c.argv))).toEqual(['high', 'high']);
    expect(app.ctx.skills.read('auditor').summary.frontmatter.metadata).toMatchObject({ model: 'sonnet', effort: 'high' });

    app.resetCalls();
    await waitForJob(app.ctx, (await startGenerateSkill(app.ctx, { ...request, name: 'auditor-two', effort: 'max' })).id);
    expect(app.calls().map((c) => effortOf(c.argv))).toEqual(['max', 'max']);
    expect(app.ctx.skills.read('auditor-two').summary.frontmatter.metadata?.effort).toBe('max');
  });

  it('revise: defaults to high and stamps the effort', async () => {
    const app = makeTestApp();
    await waitForJob(app.ctx, (await startGenerateSkill(app.ctx, request)).id);
    app.resetCalls();
    await waitForJob(app.ctx, (await startReviseSkill(app.ctx, 'auditor', { feedback: 'tighter' })).id);
    expect(effortOf(app.calls()[0]!.argv)).toBe('high');
    app.resetCalls();
    await waitForJob(app.ctx, (await startReviseSkill(app.ctx, 'auditor', { feedback: 'again', effort: 'low' })).id);
    expect(effortOf(app.calls()[0]!.argv)).toBe('low');
    expect(app.ctx.skills.read('auditor').summary.frontmatter.metadata).toMatchObject({ 'revised-effort': 'low' });
  });

  it('rejects an unknown effort with 400 and never starts Claude', async () => {
    const app = makeTestApp();
    await waitForJob(app.ctx, (await startGenerateSkill(app.ctx, request)).id);
    app.resetCalls();
    const reject = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/effort/) });
    await reject(startGenerateSkill(app.ctx, { ...request, name: 'other', effort: 'ludicrous' }));
    await reject(startReviseSkill(app.ctx, 'auditor', { feedback: 'x', effort: 'ludicrous' }));
    expect(app.calls()).toHaveLength(0);
  });
});

function arg(argv: string[], flag: string) {
  return argv[argv.indexOf(flag) + 1];
}
