import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Job, JobLogLine } from '@b2s/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createAppContext } from '../src/app-context.js';
import { createApp } from '../src/app.js';
import { json, makeTestApp, waitJob, type TestApp } from './fixtures/make-test-app.js';

let t: TestApp;
beforeEach(() => (t = makeTestApp()));
afterEach(() => t.cleanup());

function seedBook(slug: string, file: string): string {
  const dir = path.join(t.libraryDir, 'books', slug, 'source');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), '%PDF-1.4');
  return path.join(t.libraryDir, 'books', slug);
}
async function convert(slug: string, body: object = { ocr: 'off', images: true }): Promise<Job> {
  const res = await t.app.request(`/api/books/${slug}/convert`, json(body));
  expect(res.status).toBe(200);
  return ((await res.json()) as { job: Job }).job;
}
const logOf = async (id: string): Promise<JobLogLine[]> => (await (await t.app.request(`/api/jobs/${id}/log`)).json()) as JobLogLine[];

describe('convert job', () => {
  it('succeeds: progress, warnings, debug lines, manifest written', async () => {
    seedBook('ok', 'ok.pdf');
    const events: string[] = [];
    t.ctx.bus.subscribe((e) => events.push(e.type));
    const job = await waitJob(t, (await convert('ok')).id);
    expect(job.status).toBe('succeeded');
    expect(job.result).toEqual({ manifest: 'book.json' });
    expect(job.progress?.current).toBe(2);
    expect(job.progress?.total).toBe(4);
    const log = await logOf(job.id);
    expect(log.some((l) => l.level === 'warn' && l.message === 'low text density')).toBe(true);
    expect(log.some((l) => l.level === 'debug' && l.message === 'not json line')).toBe(true);
    expect(events).toContain('job');
    expect(events).toContain('job-log');
    expect(existsSync(path.join(t.libraryDir, 'books/ok/.convert-failed'))).toBe(false);
  });

  it('passes --ocr to the converter and never an --engine flag', async () => {
    seedBook('ocr-off', 'ok.pdf');
    const job = await waitJob(t, (await convert('ocr-off', { ocr: 'off' })).id);
    const argv = (await logOf(job.id)).find((l) => l.message.startsWith('argv '))?.message ?? '';
    expect(argv).toContain('--ocr off');
    expect(argv).not.toContain('--engine');
  });

  it('failure writes .convert-failed; a later success clears it', async () => {
    const dir = seedBook('bad-fail', 'fail.pdf');
    const job = await waitJob(t, (await convert('bad-fail')).id);
    expect(job.status).toBe('failed');
    expect(job.error).toContain('boom: cannot parse');
    expect(readFileSync(path.join(dir, '.convert-failed'), 'utf8')).toContain('boom');
    const summary = await (await t.app.request('/api/books/bad-fail')).json();
    expect(summary).toMatchObject({ status: 'failed' });

    writeFileSync(path.join(dir, 'source', 'ok2.pdf'), '%PDF-1.4'); // second source; first alphabetical is fail.pdf
    // Replace the failing source so the retry succeeds.
    const { rmSync } = await import('node:fs');
    rmSync(path.join(dir, 'source', 'fail.pdf'));
    const retry = await waitJob(t, (await convert('bad-fail')).id);
    expect(retry.status).toBe('succeeded');
    expect(existsSync(path.join(dir, '.convert-failed'))).toBe(false);
  });

  it('non-zero exit without events reports stderr and the install hint', async () => {
    seedBook('crashy', 'crash.pdf');
    const job = await waitJob(t, (await convert('crashy')).id);
    expect(job.status).toBe('failed');
    expect(job.error).toContain('Converter not installed: run `pnpm bootstrap`');
    expect(job.error).toContain('code 3');
  });

  it('missing converter binary gives the install hint', async () => {
    const ctx = createAppContext(loadConfig({ libraryDir: t.libraryDir, dataDir: t.dataDir, converterCommand: ['definitely-not-a-real-binary-b2s'] }));
    const app = createApp(ctx);
    seedBook('nobin', 'ok.pdf');
    const res = await app.request('/api/books/nobin/convert', json({}));
    const { job } = (await res.json()) as { job: Job };
    const start = Date.now();
    while (ctx.jobs.get(job.id).status === 'running' || ctx.jobs.get(job.id).status === 'queued') {
      if (Date.now() - start > 5000) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(ctx.jobs.get(job.id).error).toBe('Converter not installed: run `pnpm bootstrap`');
    await ctx.shutdown();
  });

  it('cancel kills the child and marks the job cancelled without a failure marker', async () => {
    const dir = seedBook('slowpoke', 'slow.pdf');
    const job = await convert('slowpoke');
    const start = Date.now();
    while (!t.ctx.jobs.get(job.id).progress) {
      if (Date.now() - start > 5000) throw new Error('converter never reported progress');
      await new Promise((r) => setTimeout(r, 25));
    }
    expect((await t.app.request(`/api/jobs/${job.id}/cancel`, { method: 'POST' })).status).toBe(200);
    const done = await waitJob(t, job.id);
    expect(done.status).toBe('cancelled');
    expect(existsSync(path.join(dir, '.convert-failed'))).toBe(false);
  });

  it('jobs routes: list, get, 404', async () => {
    seedBook('listed', 'ok.pdf');
    const job = await waitJob(t, (await convert('listed')).id);
    const list = (await (await t.app.request('/api/jobs')).json()) as Job[];
    expect(list.map((j) => j.id)).toContain(job.id);
    expect(((await (await t.app.request(`/api/jobs/${job.id}`)).json()) as Job).status).toBe('succeeded');
    expect((await t.app.request('/api/jobs/nope')).status).toBe(404);
    expect((await t.app.request('/api/jobs/nope/log')).status).toBe(404);
  });
});
