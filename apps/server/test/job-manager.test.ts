import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../src/events/event-bus.js';
import { JobManager } from '../src/jobs/job-manager.js';

let dir: string;
beforeEach(() => (dir = mkdtempSync(path.join(os.tmpdir(), 'b2s-jobs-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await sleep(10);
  }
}

describe('JobManager', () => {
  it('caps concurrency and runs the queue FIFO', async () => {
    const jm = new JobManager(dir, new EventBus(), 2);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const jobs = [0, 1, 2, 3].map((i) =>
      jm.create({ kind: 'convert', title: `j${i}`, target: `t${i}` }, async () => {
        active++;
        peak = Math.max(peak, active);
        order.push(i);
        await sleep(30);
        active--;
        return { i };
      }),
    );
    await until(() => jm.list().every((j) => j.status === 'succeeded'));
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3]);
    expect(jm.get(jobs[3]!.id).result).toEqual({ i: 3 });
  });

  it('isBusy, cancel of queued job, failure capture and logs', async () => {
    const jm = new JobManager(dir, new EventBus(), 1);
    const gate = { release: () => {} };
    const first = jm.create({ kind: 'eval', title: 'a', target: 'x' }, () => new Promise<void>((r) => (gate.release = r)));
    const second = jm.create({ kind: 'eval', title: 'b', target: 'y' }, async () => {});
    await until(() => jm.get(first.id).status === 'running');
    expect(jm.isBusy('x')).toBe(true);
    expect(jm.isBusy('nothing')).toBe(false);
    jm.cancel(second.id);
    expect(jm.get(second.id).status).toBe('cancelled');
    gate.release();
    await until(() => jm.get(first.id).status === 'succeeded');
    expect(jm.isBusy('x')).toBe(false);

    const failing = jm.create({ kind: 'generate', title: 'f', target: 'z' }, async (ctx) => {
      ctx.log('hello', { level: 'warn' });
      throw new Error('nope');
    });
    await until(() => jm.get(failing.id).status === 'failed');
    expect(jm.get(failing.id).error).toBe('nope');
    expect(jm.getLog(failing.id).map((l) => l.message)).toEqual(['hello', 'nope']);
  });

  it('aborts the signal on cancel of a running job', async () => {
    const jm = new JobManager(dir, new EventBus());
    const job = jm.create({ kind: 'eval', title: 'r', target: 'r' }, (ctx) => new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('stopped')))));
    await until(() => jm.get(job.id).status === 'running');
    jm.cancel(job.id);
    await until(() => jm.get(job.id).status === 'cancelled');
  });

  it('reload marks running/queued jobs failed and keeps finished ones', () => {
    const jobsDir = path.join(dir, 'jobs');
    mkdirSync(jobsDir, { recursive: true });
    const base = { kind: 'convert', title: 't', target: 'x', createdAt: new Date().toISOString() };
    writeFileSync(path.join(jobsDir, 'a.json'), JSON.stringify({ ...base, id: 'a', status: 'running' }));
    writeFileSync(path.join(jobsDir, 'b.json'), JSON.stringify({ ...base, id: 'b', status: 'succeeded' }));
    writeFileSync(path.join(jobsDir, 'c.json'), '{broken');
    const jm = new JobManager(dir, new EventBus());
    expect(jm.get('a')).toMatchObject({ status: 'failed', error: 'Server restarted while the job was running' });
    expect(jm.get('b').status).toBe('succeeded');
    expect(jm.list()).toHaveLength(2);
    expect(jm.isBusy('x')).toBe(false);
  });
});
