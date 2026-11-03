/** Shared helper: isolated library/data dirs + app wired to the fake converter. */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { createAppContext } from '../../src/app-context.js';
import { loadConfig } from '../../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_CONVERTER = path.join(here, 'converter', 'fake-converter.mjs');

export function makeTestApp() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'b2s-test-'));
  const libraryDir = path.join(root, 'library');
  const dataDir = path.join(root, 'data');
  const ctx = createAppContext(loadConfig({ libraryDir, dataDir, converterCommand: ['node', FAKE_CONVERTER] }));
  const app = createApp(ctx);
  return {
    root, libraryDir, dataDir, ctx, app,
    async cleanup() {
      await ctx.shutdown();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export type TestApp = ReturnType<typeof makeTestApp>;

export function json(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/** Poll until a job reaches a terminal status. */
export async function waitJob(app: TestApp, id: string, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const job = app.ctx.jobs.get(id);
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return job;
    if (Date.now() > end) throw new Error(`job ${id} stuck in ${job.status}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
