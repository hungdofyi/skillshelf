import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EvalRun } from '@b2s/shared';
import { startGenerateSkill } from '../src/generation/generate-skill-job.js';
import { startReviseSkill } from '../src/generation/revise-skill-job.js';
import { makeTestApp, waitForJob } from './fixtures/fake-claude/test-kit.js';

async function skillApp() {
  const app = makeTestApp();
  await waitForJob(app.ctx, (await startGenerateSkill(app.ctx, { books: ['demo'], goal: 'Audit things', name: 'auditor' })).id);
  return app;
}

describe('revise skill job', () => {
  it('backs up first, edits in place, and keeps provenance', async () => {
    const app = await skillApp();
    const before = readFileSync(path.join(app.ctx.skills.skillDir('auditor'), 'SKILL.md'), 'utf8');
    const job = await startReviseSkill(app.ctx, 'auditor', { feedback: 'Add a severity scale' });
    const done = await waitForJob(app.ctx, job.id);
    expect(done.status).toBe('succeeded');

    const backup = done.result!.backup as string;
    expect(backup).toContain(path.join('skill-backups', 'auditor'));
    expect(readFileSync(path.join(backup, 'SKILL.md'), 'utf8')).toBe(before);
    expect(existsSync(path.join(backup, 'references/topic.md'))).toBe(true);

    const doc = app.ctx.skills.read('auditor');
    expect(doc.body).toContain('Revised according to feedback.');
    expect(doc.summary.frontmatter.metadata).toMatchObject({ generator: 'skillshelf', goal: 'Audit things' });
    expect(doc.summary.frontmatter.metadata?.['revised-at']).toBeTruthy();
    const prompt = app.calls().at(-1)!.prompt;
    expect(prompt).toContain('Add a severity scale');
    expect(prompt).toContain('`demo`: Demo Book');
    expect(readdirSync(path.join(app.ctx.config.dataDir, 'skill-backups', 'auditor'))).toHaveLength(1);
  });

  it('includes failed cases from an eval run, with an answer excerpt capped at 1500 chars', async () => {
    const app = await skillApp();
    const lib = app.ctx.config.libraryDir;
    const runDir = path.join(lib, 'evals/auditor/20260101-000000-abcd');
    mkdirSync(path.join(runDir, 'cases/1/with_skill'), { recursive: true });
    writeFileSync(path.join(runDir, 'cases/1/with_skill/answer.md'), 'x'.repeat(3000));
    const run: EvalRun = {
      id: '20260101-000000-abcd', skill: 'auditor', skillHash: 'h', model: 'sonnet', judgeModel: 'sonnet', arms: ['with_skill'], caseIds: ['1', '2'], status: 'succeeded', startedAt: '', summary: {},
      results: [
        { caseId: '1', arm: 'with_skill', status: 'failed', triggered: true, score: 0.5, answerFile: 'cases/1/with_skill/answer.md', expectations: [{ text: 'Mentions a thing', passed: false, evidence: 'not found' }, { text: 'Mentions another', passed: true, evidence: 'q' }] },
        { caseId: '2', arm: 'with_skill', status: 'passed', triggered: true, score: 1, expectations: [] },
      ],
    };
    writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
    const job = await startReviseSkill(app.ctx, 'auditor', { feedback: 'fix', evalRunId: run.id });
    await waitForJob(app.ctx, job.id);
    const prompt = app.calls().at(-1)!.prompt;
    expect(prompt).toContain('Prompt: Audit my flow');
    expect(prompt).toContain('Mentions a thing');
    expect(prompt).toContain('Grader evidence: not found');
    expect(prompt).not.toContain('Mentions another');
    expect(prompt).not.toContain('Audit my other flow');
    expect(prompt).toContain('x'.repeat(1500) + '\n[...]');
    expect(prompt).not.toContain('x'.repeat(1501));
  });

  it('accepts empty feedback with an eval run, and never reads answer files outside the run folder', async () => {
    const app = await skillApp();
    const lib = app.ctx.config.libraryDir;
    const id = '20260101-000000-beef';
    const runDir = path.join(lib, 'evals/auditor', id);
    mkdirSync(path.join(runDir, 'cases'), { recursive: true });
    writeFileSync(path.join(lib, 'secret.txt'), 'TOP-SECRET-CONTENT');
    const run: EvalRun = {
      id, skill: 'auditor', skillHash: 'h', model: 'sonnet', judgeModel: 'sonnet', arms: ['with_skill'], caseIds: ['1'], status: 'succeeded', startedAt: '', summary: {},
      results: [{ caseId: '1', arm: 'with_skill', status: 'failed', triggered: true, score: 0, answerFile: '../../../secret.txt', expectations: [{ text: 'Mentions a thing', passed: false, evidence: 'no' }] }],
    };
    writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
    const done = await waitForJob(app.ctx, (await startReviseSkill(app.ctx, 'auditor', { feedback: '', evalRunId: id })).id);
    expect(done.status).toBe('succeeded');
    const prompt = app.calls().at(-1)!.prompt;
    expect(prompt).toContain('Mentions a thing');
    expect(prompt).not.toContain('TOP-SECRET-CONTENT');
    await expect(startReviseSkill(app.ctx, 'auditor', { feedback: '' })).rejects.toMatchObject({ status: 400 });
  });

  it('validates the request', async () => {
    const app = await skillApp();
    await expect(startReviseSkill(app.ctx, 'ghost', { feedback: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(startReviseSkill(app.ctx, 'auditor', { feedback: ' ' })).rejects.toMatchObject({ status: 400 });
    await expect(startReviseSkill(app.ctx, 'auditor', { feedback: 'x', evalRunId: '../x' })).rejects.toMatchObject({ status: 400 });
    await expect(startReviseSkill(app.ctx, 'auditor', { feedback: 'x', evalRunId: 'nope' })).rejects.toMatchObject({ status: 404 });
  });
});
