import { Hono } from 'hono';
import type { AppContext } from '../app-context.js';

export function jobsRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  app.get('/api/jobs', (c) => c.json(ctx.jobs.list()));
  app.get('/api/jobs/:id', (c) => c.json(ctx.jobs.get(c.req.param('id'))));
  app.get('/api/jobs/:id/log', (c) => c.json(ctx.jobs.getLog(c.req.param('id'))));
  app.post('/api/jobs/:id/cancel', (c) => {
    ctx.jobs.cancel(c.req.param('id'));
    return c.json({ ok: true });
  });
  return app;
}
