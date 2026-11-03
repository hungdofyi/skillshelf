import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvalFile, EvalRun } from '@b2s/shared';
import { clearClaudeStatusCache } from '../src/claude/claude-status.js';
import { startEvalRun } from '../src/evals/eval-run-job.js';
import { startGenerateSkill } from '../src/generation/generate-skill-job.js';
import { makeTestApp, waitForJob, type TestApp } from './fixtures/fake-claude/test-kit.js';

afterEach(() => {
  for (const k of ['FAKE_CLAUDE_SLEEP_MS', 'FAKE_CLAUDE_JUDGE', 'FAKE_CLAUDE_AUTH']) delete process.env[k];
});

async function skillApp(evals?: EvalFile): Promise<TestApp> {
  const app = makeTestApp();
  await waitForJob(app.ctx, (await startGenerateSkill(app.ctx, { books: ['demo'], goal: 'Audit things', name: 'auditor' })).id);
  if (evals) writeFileSync(path.join(app.ctx.skills.skillDir('auditor'), 'evals/evals.json'), JSON.stringify(evals));
  app.resetCalls();
  return app;
}
const readRun = (app: TestApp, runId: string): EvalRun => JSON.parse(readFileSync(path.join(app.ctx.config.libraryDir, 'evals/auditor', runId, 'run.json'), 'utf8'));

describe('eval run job', () => {
  it('runs with_skill and baseline arms, grades, and summarises', async () => {
    const app = await skillApp();
    const { job, runId } = await startEvalRun(app.ctx, 'auditor', { concurrency: 2 });
    expect(runId).toMatch(/^\d{8}-\d{6}-[0-9a-f]{4}$/);
    expect(readRun(app, runId).status).toBe('running'); // visible immediately
    const done = await waitForJob(app.ctx, job.id);
    expect(done.status).toBe('succeeded');
    expect(done.result).toEqual({ runId });

    const run = readRun(app, runId);
    expect(run).toMatchObject({ status: 'succeeded', model: 'sonnet', judgeModel: 'sonnet', arms: ['with_skill', 'baseline'], caseIds: ['1', '2', '3'] });
    expect(run.skillHash).toBe(app.ctx.skills.hash('auditor'));
    const by = (c: string, a: string) => run.results.find((x) => x.caseId === c && x.arm === a)!;

    expect(by('1', 'with_skill')).toMatchObject({ status: 'passed', triggered: true, score: 1, answerFile: 'cases/1/with_skill/answer.md', transcriptFile: 'cases/1/with_skill/transcript.jsonl' });
    expect(by('1', 'with_skill').expectations).toEqual([
      { text: 'Mentions a thing', passed: true, evidence: 'USED_SKILL' },
      { text: 'Mentions another', passed: true, evidence: 'USED_SKILL' },
    ]);
    expect(by('1', 'baseline')).toMatchObject({ status: 'failed', score: 0 });
    // near miss: skill not used => passed; baseline skipped
    expect(by('3', 'with_skill')).toMatchObject({ status: 'passed', triggered: false, expectations: [] });
    expect(by('3', 'baseline').status).toBe('skipped');
    expect(run.summary.with_skill).toMatchObject({ cases: 2, passRate: 1, meanScore: 1, triggerAccuracy: 1, meanDurationMs: 42 });
    expect(run.summary.baseline).toMatchObject({ cases: 2, passRate: 0 });

    const runDir = path.join(app.ctx.config.libraryDir, 'evals/auditor', runId);
    expect(readFileSync(path.join(runDir, 'cases/1/with_skill/answer.md'), 'utf8')).toContain('USED_SKILL');
    expect(existsSync(path.join(runDir, 'cases/1/baseline/transcript.jsonl'))).toBe(true);
    expect(readdirSync(path.join(runDir, 'cases/1/with_skill')).sort()).toEqual(['answer.md', 'judge-transcript.jsonl', 'transcript.jsonl']);

    // Sandbox contents: skill installed without evals/ for with_skill, nothing for baseline.
    const agentCalls = app.calls().filter((c) => c.argv[c.argv.indexOf('--tools') + 1] !== '');
    expect(agentCalls).toHaveLength(5);
    for (const c of agentCalls) {
      expect(c.argv[c.argv.indexOf('--tools') + 1]).toBe('Skill,Read,Glob,Grep,Write,Edit');
      expect(c.argv[c.argv.indexOf('--allowedTools') + 1]).toBe('Skill Read(./**) Edit(./**)');
      expect(c.cwd).not.toContain(app.ctx.config.libraryDir);
    }
    const judgeCalls = app.calls().filter((c) => c.argv[c.argv.indexOf('--tools') + 1] === '');
    expect(judgeCalls).toHaveLength(4);
    expect(judgeCalls[0]!.argv).toContain('--json-schema');
  });

  it('does not expose evals/ to the agent but does expose the skill', async () => {
    const app = await skillApp({ skill_name: 'auditor', evals: [{ id: 'a', prompt: 'Audit it', expectations: ['Mentions a thing'] }] });
    const { job } = await startEvalRun(app.ctx, 'auditor', { arms: ['with_skill'] });
    expect((await waitForJob(app.ctx, job.id)).status).toBe('succeeded');
    // The fake only triggers the skill when .claude/skills/<name> exists in the sandbox.
    expect(app.calls().some((c) => c.prompt.includes('USED_SKILL'))).toBe(true);
    const { createSandbox } = await import('../src/evals/eval-sandbox.js');
    const skillDir = app.ctx.skills.skillDir('auditor');
    const sb = createSandbox({ skillName: 'auditor', skillDir, skillRootForFiles: skillDir });
    expect(existsSync(path.join(sb.dir, '.claude/skills/auditor/SKILL.md'))).toBe(true);
    expect(existsSync(path.join(sb.dir, '.claude/skills/auditor/references/topic.md'))).toBe(true);
    expect(existsSync(path.join(sb.dir, '.claude/skills/auditor/evals'))).toBe(false);
    sb.dispose();
    expect(existsSync(sb.dir)).toBe(false);
  });

  it('copies case files and hands files the agent wrote to the judge', async () => {
    const app = await skillApp({ skill_name: 'auditor', evals: [{ id: 1, prompt: 'Audit it WRITEFILE', expectations: ['ok'], files: ['references/topic.md'] }] });
    const { job } = await startEvalRun(app.ctx, 'auditor', { arms: ['with_skill'] });
    await waitForJob(app.ctx, job.id);
    const judge = app.calls().find((c) => c.argv[c.argv.indexOf('--tools') + 1] === '')!;
    expect(judge.prompt).toContain('### report.md');
    expect(judge.prompt).not.toContain('### references/topic.md'); // input files are not "produced"
  });

  it('honours caseIds and records judge failures as errors without failing the run', async () => {
    const app = await skillApp();
    process.env.FAKE_CLAUDE_JUDGE = 'garbage';
    const { job, runId } = await startEvalRun(app.ctx, 'auditor', { caseIds: [1, '3'], arms: ['with_skill'] });
    const done = await waitForJob(app.ctx, job.id);
    const run = readRun(app, runId);
    expect(run.caseIds).toEqual(['1', '3']);
    expect(run.results.find((x) => x.caseId === '1')).toMatchObject({ status: 'error' });
    expect(run.results.find((x) => x.caseId === '1')!.error).toMatch(/not valid verdict JSON/);
    expect(run.results.find((x) => x.caseId === '3')!.status).toBe('passed');
    expect(done.status).toBe('succeeded');
    // the only graded result is a near-miss, which counts in triggerAccuracy only
    expect(run.summary.with_skill).toMatchObject({ cases: 0, passRate: 0, triggerAccuracy: 1 });
  });

  it('cancel keeps partial results and marks the run cancelled', async () => {
    const app = await skillApp();
    const { job, runId } = await startEvalRun(app.ctx, 'auditor', { arms: ['with_skill'], concurrency: 1 });
    // let the first unit finish quickly, then slow everything else down
    for (let i = 0; i < 400 && readRun(app, runId).results.length < 1; i++) await new Promise((r) => setTimeout(r, 25));
    process.env.FAKE_CLAUDE_SLEEP_MS = '30000';
    app.ctx.jobs.cancel(job.id);
    const done = await waitForJob(app.ctx, job.id);
    const run = readRun(app, runId);
    expect(done.status).toBe('cancelled');
    expect(run.status).toBe('cancelled');
    expect(run.finishedAt).toBeTruthy();
    expect(run.results.length).toBeGreaterThanOrEqual(1);
    expect(run.results.length).toBeLessThan(3);
  });

  it('clamps concurrency instead of rejecting it', async () => {
    const app = await skillApp({ skill_name: 'auditor', evals: [{ id: 'a', prompt: 'Audit it', expectations: ['Mentions a thing'] }] });
    const { job } = await startEvalRun(app.ctx, 'auditor', { arms: ['with_skill'], concurrency: 99 });
    expect((await waitForJob(app.ctx, job.id)).status).toBe('succeeded');
    const { job: job2 } = await startEvalRun(app.ctx, 'auditor', { arms: ['with_skill'], concurrency: 0 });
    expect((await waitForJob(app.ctx, job2.id)).status).toBe('succeeded');
  });

  it('fails orphaned running records at startup', async () => {
    const app = await skillApp({ skill_name: 'auditor', evals: [{ id: 'a', prompt: 'Audit it', expectations: ['Mentions a thing'] }] });
    // orphaned "running" record with no live job is failed on startup
    const lib = app.ctx.config.libraryDir;
    const dir = path.join(lib, 'evals/auditor/20260101-000000-dead');
    mkdirSync(dir, { recursive: true });
    const orphan: EvalRun = { id: '20260101-000000-dead', skill: 'auditor', skillHash: 'h', model: 'm', judgeModel: 'm', arms: ['with_skill'], caseIds: ['a'], status: 'running', startedAt: '', results: [], summary: {} };
    writeFileSync(path.join(dir, 'run.json'), JSON.stringify(orphan));
    const { failOrphanedEvalRuns } = await import('../src/evals/eval-run-recovery.js');
    expect(failOrphanedEvalRuns(lib, () => false)).toEqual(['auditor/20260101-000000-dead']);
    const fixed = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')) as EvalRun;
    expect(fixed.status).toBe('failed');
    expect(fixed.finishedAt).toBeTruthy();
    // a run whose skill still has a live job is left alone
    writeFileSync(path.join(dir, 'run.json'), JSON.stringify(orphan));
    expect(failOrphanedEvalRuns(lib, (t) => t === 'evals/auditor')).toEqual([]);
  });

  it('closes the run record when the eval job is cancelled before it starts', async () => {
    const app = await skillApp({ skill_name: 'auditor', evals: [{ id: 'a', prompt: 'Audit it', expectations: ['Mentions a thing'] }] });
    // Fill both queue slots so the eval stays queued.
    const hold = () => app.ctx.jobs.create({ kind: 'convert', title: 'h', target: `hold-${Math.random()}` }, (c) => new Promise((r) => c.signal.addEventListener('abort', () => r())));
    hold();
    hold();
    const { job, runId } = await startEvalRun(app.ctx, 'auditor', { arms: ['with_skill'] });
    expect(app.ctx.jobs.get(job.id).status).toBe('queued');
    app.ctx.jobs.cancel(job.id);
    const run = readRun(app, runId);
    expect(run.status).toBe('cancelled');
    expect(run.finishedAt).toBeTruthy();
    await app.ctx.shutdown();
  });

  it('refuses case files that could plant settings or escape the skill folder', async () => {
    const { resolveCaseFile, createSandbox } = await import('../src/evals/eval-sandbox.js');
    const { mkdtempSync, symlinkSync, readdirSync: ls } = await import('node:fs');
    const os = await import('node:os');
    const root = mkdtempSync(path.join(os.tmpdir(), 'b2s-case-'));
    const skill = path.join(root, 'skill');
    mkdirSync(path.join(skill, '.claude'), { recursive: true });
    mkdirSync(path.join(skill, 'data'), { recursive: true });
    writeFileSync(path.join(skill, '.claude/settings.json'), '{"hooks":{}}');
    writeFileSync(path.join(skill, 'CLAUDE.md'), 'x');
    writeFileSync(path.join(skill, 'data/CLAUDE.md'), 'x');
    writeFileSync(path.join(skill, 'data/ok.txt'), 'fine');
    writeFileSync(path.join(root, 'secret.txt'), 'secret');
    symlinkSync(path.join(root, 'secret.txt'), path.join(skill, 'data/link.txt'));
    const box = path.join(root, 'box');
    mkdirSync(box);
    for (const bad of ['.claude/settings.json', 'CLAUDE.md', 'data/CLAUDE.md', '../secret.txt', 'data/../../secret.txt', '/etc/passwd', 'data/link.txt', 'data/.hidden', 'a\\b']) {
      expect(() => resolveCaseFile(skill, box, bad), bad).toThrow(/Eval file/);
    }
    expect(resolveCaseFile(skill, box, 'data/ok.txt').to).toBe(path.join(box, 'data/ok.txt'));

    // A bad case file also cleans up the temp sandbox it created.
    const before = ls(os.tmpdir()).filter((n) => n.startsWith('b2s-eval-')).length;
    expect(() => createSandbox({ skillName: 's', skillDir: skill, caseFiles: ['.claude/settings.json'], skillRootForFiles: skill })).toThrow();
    expect(ls(os.tmpdir()).filter((n) => n.startsWith('b2s-eval-')).length).toBe(before);
  });

  it('validates the request', async () => {
    const app = await skillApp();
    await expect(startEvalRun(app.ctx, 'ghost', {})).rejects.toMatchObject({ status: 404 });
    await expect(startEvalRun(app.ctx, 'auditor', { caseIds: ['zzz'] })).rejects.toMatchObject({ status: 400 });
    await expect(startEvalRun(app.ctx, 'auditor', { arms: ['nope'] })).rejects.toMatchObject({ status: 400 });
    process.env.FAKE_CLAUDE_AUTH = 'api-key';
    clearClaudeStatusCache();
    await expect(startEvalRun(app.ctx, 'auditor', {})).rejects.toMatchObject({ status: 503 });
    const noEvals = makeTestApp();
    mkdirSync(path.join(noEvals.ctx.skills.skillsDir, 's'), { recursive: true });
    writeFileSync(path.join(noEvals.ctx.skills.skillsDir, 's/SKILL.md'), '---\nname: s\ndescription: Use when x\n---\nbody');
    await expect(startEvalRun(noEvals.ctx, 's', {})).rejects.toMatchObject({ status: 404 });
  });
});

const effortOf = (argv: string[]) => (argv.includes('--effort') ? argv[argv.indexOf('--effort') + 1] : undefined);
const argAt = (argv: string[], flag: string) => argv[argv.indexOf(flag) + 1];

describe('eval effort', () => {
  it('effort: agent arms default to medium, the judge is always low and not configurable', async () => {
    const app = await skillApp();
    const { job, runId } = await startEvalRun(app.ctx, 'auditor', {});
    await waitForJob(app.ctx, job.id);
    const split = () => {
      const calls = app.calls();
      return { agents: calls.filter((c) => argAt(c.argv, '--tools') !== ''), judges: calls.filter((c) => argAt(c.argv, '--tools') === '') };
    };
    let { agents, judges } = split();
    expect(agents.length).toBeGreaterThan(0);
    expect(judges.length).toBeGreaterThan(0);
    expect(agents.every((c) => effortOf(c.argv) === 'medium')).toBe(true);
    expect(judges.every((c) => effortOf(c.argv) === 'low')).toBe(true);
    const runFile = path.join(app.ctx.config.libraryDir, 'evals/auditor', runId, 'run.json');
    expect(JSON.parse(readFileSync(runFile, 'utf8'))).toMatchObject({ effort: 'medium', judgeEffort: 'low' });

    app.resetCalls();
    const second = await startEvalRun(app.ctx, 'auditor', { effort: 'max', judgeEffort: 'max' });
    await waitForJob(app.ctx, second.job.id);
    ({ agents, judges } = split());
    expect(agents.every((c) => effortOf(c.argv) === 'max')).toBe(true);
    expect(judges.every((c) => effortOf(c.argv) === 'low')).toBe(true);
  });
  it('rejects an unknown effort with 400', async () => {
    const app = await skillApp();
    await expect(startEvalRun(app.ctx, 'auditor', { effort: 'ludicrous' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/effort/) });
    expect(app.calls()).toHaveLength(0);
  });
});
