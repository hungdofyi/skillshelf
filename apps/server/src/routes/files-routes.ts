import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { RenameRequest, TreeNode, TreeResponse, WriteFileRequest } from '@b2s/shared';
import type { AppContext } from '../app-context.js';
import { HttpError } from '../http-error.js';
import { createLibraryFolder, openRawStream, readLibraryFile, renameLibraryPath, trashLibraryPath, writeLibraryFile } from '../library/file-io.js';
import { readGitStatus } from '../library/git-status.js';
import { startLibraryWatcher } from '../library/library-watcher.js';
import { buildTree } from '../library/library-tree.js';
import { normalizeRelPath } from '../library/library-paths.js';

const HEARTBEAT_MS = 25_000;

function requirePath(value: unknown, field = 'path'): string {
  if (typeof value !== 'string') throw new HttpError(400, `"${field}" must be a string`);
  return value;
}

async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => undefined);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected a JSON body');
  return body as Record<string, unknown>;
}

/** 409 when a queued or running job targets this path or one of its ancestors. */
function assertNotBusy(ctx: AppContext, rel: string): void {
  const parts = normalizeRelPath(rel).split('/').filter(Boolean);
  for (let i = parts.length; i > 0; i--) {
    const target = parts.slice(0, i).join('/');
    if (ctx.jobs.isBusy(target)) throw new HttpError(409, `A job is working on "${target}"; wait for it or cancel it first`);
  }
}

function applyGit(node: TreeNode, files: Map<string, NonNullable<TreeNode['git']>>): void {
  if (node.type === 'file') {
    const status = files.get(node.path);
    if (status) node.git = status;
    return;
  }
  for (const child of node.children ?? []) applyGit(child, files);
}

export function filesRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  const { libraryDir, dataDir } = ctx.config;

  ctx.onShutdown(startLibraryWatcher(libraryDir, ctx.bus));

  app.get('/api/tree', async (c) => {
    const root = buildTree(libraryDir);
    const snap = await readGitStatus(libraryDir);
    applyGit(root, snap.files);
    const res: TreeResponse = { root, libraryDir, git: { isRepo: snap.isRepo, branch: snap.branch, dirty: snap.dirty } };
    return c.json(res);
  });

  app.get('/api/file', (c) => c.json(readLibraryFile(libraryDir, requirePath(c.req.query('path')))));

  app.get('/api/raw', (c) => {
    const { stream, size, contentType } = openRawStream(libraryDir, requirePath(c.req.query('path')));
    return new Response(stream, { headers: { 'content-type': contentType, 'content-length': String(size), 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' } });
  });

  app.put('/api/file', async (c) => {
    const body = (await jsonBody(c)) as Partial<WriteFileRequest>;
    if (typeof body.content !== 'string') throw new HttpError(400, '"content" must be a string');
    if (body.expectedMtimeMs !== undefined && typeof body.expectedMtimeMs !== 'number') throw new HttpError(400, '"expectedMtimeMs" must be a number');
    if (body.createOnly !== undefined && typeof body.createOnly !== 'boolean') throw new HttpError(400, '"createOnly" must be a boolean');
    return c.json(await writeLibraryFile(libraryDir, requirePath(body.path), body.content, body.expectedMtimeMs, body.createOnly === true));
  });

  app.post('/api/file/rename', async (c) => {
    const body = (await jsonBody(c)) as Partial<RenameRequest>;
    const from = requirePath(body.from, 'from');
    const to = requirePath(body.to, 'to');
    assertNotBusy(ctx, from);
    assertNotBusy(ctx, to);
    renameLibraryPath(libraryDir, from, to);
    return c.json({ ok: true });
  });

  app.delete('/api/file', (c) => {
    const rel = requirePath(c.req.query('path'));
    assertNotBusy(ctx, rel);
    trashLibraryPath(libraryDir, dataDir, rel);
    return c.json({ ok: true });
  });

  app.post('/api/folder', async (c) => {
    const body = await jsonBody(c);
    createLibraryFolder(libraryDir, requirePath(body.path));
    return c.json({ ok: true });
  });

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = ctx.bus.subscribe((event) => {
        void stream.writeSSE({ data: JSON.stringify(event) }).catch(() => undefined);
      });
      stream.onAbort(unsubscribe);
      try {
        // Initial comment flushes headers so EventSource reports "open" immediately.
        await stream.write(': connected\n\n');
        while (!stream.aborted && !stream.closed) {
          await stream.sleep(HEARTBEAT_MS);
          if (!stream.aborted) await stream.write(': ping\n\n');
        }
      } finally {
        unsubscribe();
      }
    }),
  );

  return app;
}
