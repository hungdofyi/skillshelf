import { existsSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import type { EvalRun } from '@b2s/shared';
import type { AppContext } from '../app-context.js';
import { evalSkillDir, readEvalRun } from '../evals/eval-paths.js';
import { startEvalRun } from '../evals/eval-run-job.js';
import { HttpError } from '../http-error.js';

export function evalsRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  const lib = ctx.config.libraryDir;

  app.get('/api/evals/:skill/runs', (c) => {
    const skill = c.req.param('skill');
    const dir = evalSkillDir(lib, skill);
    if (!existsSync(dir)) return c.json([]);
    const runs: EvalRun[] = [];
    for (const id of readdirSync(dir).sort().reverse()) {
      try {
        runs.push({ ...readEvalRun(lib, skill, id), results: [] });
      } catch {
        // Skip folders without a readable run.json.
      }
    }
    return c.json(runs);
  });

  app.get('/api/evals/:skill/runs/:runId', (c) => c.json(readEvalRun(lib, c.req.param('skill'), c.req.param('runId'))));

  app.post('/api/evals/:skill/run', async (c) => {
    let body: unknown = {};
    const text = await c.req.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError(400, 'Request body must be JSON');
      }
    }
    return c.json(await startEvalRun(ctx, c.req.param('skill'), body));
  });

  return app;
}
