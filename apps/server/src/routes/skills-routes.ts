import { Hono } from 'hono';
import { z } from 'zod';
import type { SkillSummary } from '@b2s/shared';
import type { AppContext } from '../app-context.js';
import { startGenerateSkill } from '../generation/generate-skill-job.js';
import { startReviseSkill } from '../generation/revise-skill-job.js';
import { HttpError } from '../http-error.js';
import { exportSkillZip } from '../skills/skill-export.js';
import { installSkill, listInstalls, uninstallSkill } from '../skills/skill-install.js';

const installSchema = z.object({ target: z.enum(['user', 'project']), projectDir: z.string().optional() });

async function jsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
}

export function skillsRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  const withInstalls = (s: SkillSummary): SkillSummary => {
    const installs = listInstalls(ctx.config.dataDir, s.name, ctx.skills.skillDir(s.name));
    return installs.length ? { ...s, installs } : s;
  };

  app.get('/api/skills', (c) => c.json(ctx.skills.list().map(withInstalls)));
  app.post('/api/skills/generate', async (c) => c.json({ job: await startGenerateSkill(ctx, await jsonBody(c.req.raw)) }));
  app.get('/api/skills/:name', (c) => c.json(withInstalls(ctx.skills.read(c.req.param('name')).summary)));
  app.post('/api/skills/:name/revise', async (c) => c.json({ job: await startReviseSkill(ctx, c.req.param('name'), await jsonBody(c.req.raw)) }));

  app.post('/api/skills/:name/install', async (c) => {
    const name = c.req.param('name');
    const parsed = installSchema.safeParse(await jsonBody(c.req.raw));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    ctx.skills.read(name); // 404 when missing
    return c.json(installSkill({ dataDir: ctx.config.dataDir, name, skillDir: ctx.skills.skillDir(name), ...parsed.data }));
  });

  app.delete('/api/skills/:name/install', (c) => {
    const name = c.req.param('name');
    const target = c.req.query('target');
    if (target !== 'user' && target !== 'project') throw new HttpError(400, 'target must be "user" or "project"');
    uninstallSkill({ dataDir: ctx.config.dataDir, name, skillDir: ctx.skills.skillDir(name), target, projectDir: c.req.query('projectDir') || undefined });
    return c.json({ ok: true });
  });

  app.get('/api/skills/:name/export', (c) => {
    const name = c.req.param('name');
    ctx.skills.read(name);
    const zip = exportSkillZip(ctx.skills.skillDir(name), name);
    return new Response(zip as unknown as ArrayBuffer, {
      headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name}.zip"`, 'content-length': String(zip.byteLength) },
    });
  });

  return app;
}
