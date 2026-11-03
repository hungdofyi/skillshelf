/**
 * Hono app: mounts every route module. Each module exports a factory (ctx) => Hono
 * that registers its own absolute paths (/api/..., /mcp...).
 */
import { existsSync } from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import path from 'node:path';
import type { AppContext } from './app-context.js';
import { HttpError } from './http-error.js';
import { booksRoutes } from './routes/books-routes.js';
import { claudeRoutes } from './routes/claude-routes.js';
import { evalsRoutes } from './routes/evals-routes.js';
import { filesRoutes } from './routes/files-routes.js';
import { jobsRoutes } from './routes/jobs-routes.js';
import { mcpRoutes } from './routes/mcp-routes.js';
import { skillsRoutes } from './routes/skills-routes.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, details: err.details }, err.status);
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  });

  // DNS-rebinding guard: the API only answers requests addressed to this machine by a local name.
  app.use('/api/*', async (c, next) => {
    const host = (c.req.header('host') ?? new URL(c.req.url).host).replace(/:\d+$/, '').toLowerCase();
    if (!LOCAL_HOSTS.has(host)) return c.json({ error: 'Forbidden host' }, 403);
    await next();
  });

  // CSRF guard: a browser page on another site must not be able to drive state-changing endpoints.
  // Requests without an Origin (curl, tests, same-origin GET navigations) pass.
  app.use('/api/*', async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
    const site = c.req.header('sec-fetch-site');
    if (site === 'cross-site' || site === 'same-site') return c.json({ error: 'Cross-site request refused' }, 403);
    const origin = c.req.header('origin');
    if (origin !== undefined) {
      let hostname = '';
      try {
        hostname = new URL(origin).hostname.toLowerCase();
      } catch {
        // "null" or malformed origins are refused below.
      }
      if (!LOCAL_HOSTS.has(hostname)) return c.json({ error: 'Forbidden origin' }, 403);
    }
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true, libraryDir: ctx.config.libraryDir }));

  app.route('/', filesRoutes(ctx));
  app.route('/', booksRoutes(ctx));
  app.route('/', skillsRoutes(ctx));
  app.route('/', evalsRoutes(ctx));
  app.route('/', jobsRoutes(ctx));
  app.route('/', claudeRoutes(ctx));
  app.route('/', mcpRoutes(ctx));

  // Production: serve the built web UI (pnpm build) from the same port.
  const dist = ctx.config.webDistDir;
  if (existsSync(dist)) {
    const root = path.relative(process.cwd(), dist);
    app.use('/*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }

  return app;
}
