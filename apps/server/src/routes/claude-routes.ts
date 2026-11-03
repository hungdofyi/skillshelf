import { Hono } from 'hono';
import type { AppContext } from '../app-context.js';
import { getClaudeStatus } from '../claude/claude-status.js';

/** GET /api/claude/status (add ?refresh=1 to bypass the 30 s cache). */
export function claudeRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  app.get('/api/claude/status', async (c) => c.json(await getClaudeStatus(ctx.config, { force: c.req.query('refresh') === '1' })));
  return app;
}
