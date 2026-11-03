import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClaudeStatus, EvalRun, Job, SkillSummary } from '@b2s/shared';
import { createApp } from '../src/app.js';
import { makeTestApp, waitForJob } from './fixtures/fake-claude/test-kit.js';

afterEach(() => {
  delete process.env.FAKE_CLAUDE_AUTH;
});

function api() {
  const t = makeTestApp();
  const app: Hono = createApp(t.ctx);
  const call = (method: string, url: string, body?: unknown) =>
    app.request(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { ...t, call };
}

describe('skills, evals and claude routes', () => {
  it('generates, lists, installs, exports, evaluates and revises over HTTP', async () => {
    const { ctx, root, call } = api();
    process.env.HOME = path.join(root, 'home'); // user installs land in the temp home
    delete process.env.CLAUDE_CONFIG_DIR;
    mkdirSync(process.env.HOME);

    const gen = await call('POST', '/api/skills/generate', { books: ['demo'], goal: 'Audit things', name: 'auditor' });
    expect(gen.status).toBe(200);
    await waitForJob(ctx, ((await gen.json()) as { job: Job }).job.id);
    expect((await call('POST', '/api/skills/generate', { books: ['demo'], goal: 'Audit things', name: 'auditor' })).status).toBe(409);
    expect((await call('POST', '/api/skills/generate', { books: ['demo'], goal: '' })).status).toBe(400);

    const list = (await (await call('GET', '/api/skills')).json()) as SkillSummary[];
    expect(list.map((s) => s.name)).toEqual(['auditor']);
    expect((await call('GET', '/api/skills/nope')).status).toBe(404);

    const inst = await call('POST', '/api/skills/auditor/install', { target: 'user' });
    expect(inst.status).toBe(200);
    expect(((await (await call('GET', '/api/skills/auditor')).json()) as SkillSummary).installs).toHaveLength(1);
    expect((await call('POST', '/api/skills/auditor/install', { target: 'project' })).status).toBe(400);
    expect((await call('DELETE', '/api/skills/auditor/install?target=user')).status).toBe(200);
    expect(((await (await call('GET', '/api/skills/auditor')).json()) as SkillSummary).installs).toBeUndefined();
    expect((await call('DELETE', '/api/skills/auditor/install?target=user')).status).toBe(404);

    const zip = await call('GET', '/api/skills/auditor/export');
    expect(zip.headers.get('content-type')).toBe('application/zip');
    expect(zip.headers.get('content-disposition')).toContain('auditor.zip');
    expect(Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer()))).sort()).toEqual(['auditor/SKILL.md', 'auditor/references/topic.md']);

    const run = (await (await call('POST', '/api/evals/auditor/run', {})).json()) as { job: Job; runId: string };
    await waitForJob(ctx, run.job.id);
    const runs = (await (await call('GET', '/api/evals/auditor/runs')).json()) as EvalRun[];
    expect(runs.map((r) => r.id)).toEqual([run.runId]);
    expect(runs[0]!.results).toEqual([]);
    const full = (await (await call('GET', `/api/evals/auditor/runs/${run.runId}`)).json()) as EvalRun;
    expect(full.results.length).toBe(6);
    expect((await call('GET', '/api/evals/auditor/runs/nope')).status).toBe(404);
    expect(((await (await call('GET', '/api/skills/auditor')).json()) as SkillSummary).latestRun?.summary).toMatchObject({ with_skill: { passRate: 1 }, baseline: { passRate: 0 } });

    const rev = await call('POST', '/api/skills/auditor/revise', { feedback: 'More', evalRunId: run.runId });
    expect(rev.status).toBe(200);
    expect((await waitForJob(ctx, ((await rev.json()) as { job: Job }).job.id)).status).toBe('succeeded');
  });

  it('serves claude status and refuses non-subscription auth', async () => {
    const { call } = api();
    expect(((await (await call('GET', '/api/claude/status')).json()) as ClaudeStatus).ready).toBe(true);
    process.env.FAKE_CLAUDE_AUTH = 'api-key';
    const status = (await (await call('GET', '/api/claude/status?refresh=1')).json()) as ClaudeStatus;
    expect(status).toMatchObject({ ready: false, authMethod: 'api-key' });
    expect((await call('POST', '/api/skills/generate', { books: ['demo'], goal: 'x' })).status).toBe(503);
  });
});
