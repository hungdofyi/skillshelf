import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileResponse, ServerEvent } from '@b2s/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { json, makeTestApp, type TestApp } from './fixtures/make-test-app.js';

let t: TestApp;
beforeEach(() => (t = makeTestApp()));
afterEach(() => t.cleanup());

const q = (p: string) => encodeURIComponent(p);

describe('file routes: job guards and raw headers', () => {
  it('refuses to delete or rename paths a running job targets (or their parents)', async () => {
    mkdirSync(path.join(t.libraryDir, 'evals/demo/run1'), { recursive: true });
    mkdirSync(path.join(t.libraryDir, 'skills/demo'), { recursive: true });
    writeFileSync(path.join(t.libraryDir, 'skills/demo/SKILL.md'), 'x');
    const job = t.ctx.jobs.create({ kind: 'eval', title: 't', target: 'evals/demo' }, (c) => new Promise((resolve) => c.signal.addEventListener('abort', () => resolve())));
    expect((await t.app.request(`/api/file?path=${q('evals/demo/run1')}`, { method: 'DELETE' })).status).toBe(409);
    expect((await t.app.request('/api/file/rename', json({ from: 'evals/demo/run1', to: 'evals/demo/run2' }))).status).toBe(409);
    expect((await t.app.request(`/api/file?path=${q('skills/demo/SKILL.md')}`, { method: 'DELETE' })).status).toBe(200);
    t.ctx.jobs.cancel(job.id);
  });

  it('serves raw files sandboxed with nosniff', async () => {
    writeFileSync(path.join(t.libraryDir, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const res = await t.app.request(`/api/raw?path=pic.svg`);
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('file routes', () => {
  it('reads text, flags binary, 404s missing', async () => {
    writeFileSync(path.join(t.libraryDir, 'a.md'), '# hi');
    writeFileSync(path.join(t.libraryDir, 'b.bin'), Buffer.from([1, 0, 2]));
    writeFileSync(path.join(t.libraryDir, 'bad.txt'), Buffer.from([0xff, 0xfe, 0xfd]));
    const a = (await (await t.app.request(`/api/file?path=a.md`)).json()) as FileResponse;
    expect(a).toMatchObject({ path: 'a.md', content: '# hi', binary: false });
    const b = (await (await t.app.request(`/api/file?path=b.bin`)).json()) as FileResponse;
    expect(b.binary).toBe(true);
    expect(b.content).toBeUndefined();
    expect(((await (await t.app.request(`/api/file?path=bad.txt`)).json()) as FileResponse).binary).toBe(true);
    expect((await t.app.request(`/api/file?path=nope.md`)).status).toBe(404);
    expect((await t.app.request(`/api/file`)).status).toBe(400);
  });

  it('rejects traversal, absolute and symlink-escape paths', async () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), 'b2s-out-'));
    writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, path.join(t.libraryDir, 'link'));
    for (const p of ['../x', '/etc/passwd', 'a/../../x', 'link/secret.txt']) {
      expect((await t.app.request(`/api/file?path=${q(p)}`)).status, p).toBe(400);
      expect((await t.app.request(`/api/raw?path=${q(p)}`)).status, p).toBe(400);
    }
    const put = await t.app.request('/api/file', json({ path: 'link/new.txt', content: 'x' }, 'PUT'));
    expect(put.status).toBe(400);
    expect(existsSync(path.join(outside, 'new.txt'))).toBe(false);
  });

  it('writes atomically, creates parents, enforces expectedMtimeMs', async () => {
    const r1 = await t.app.request('/api/file', json({ path: 'skills/x/SKILL.md', content: 'v1' }, 'PUT'));
    expect(r1.status).toBe(200);
    const f1 = (await r1.json()) as FileResponse;
    expect(readFileSync(path.join(t.libraryDir, 'skills/x/SKILL.md'), 'utf8')).toBe('v1');
    expect(readdirSync(path.join(t.libraryDir, 'skills/x'))).toEqual(['SKILL.md']); // no tmp leftovers

    const stale = await t.app.request('/api/file', json({ path: 'skills/x/SKILL.md', content: 'v2', expectedMtimeMs: f1.mtimeMs - 5000 }, 'PUT'));
    expect(stale.status).toBe(409);
    expect(readFileSync(path.join(t.libraryDir, 'skills/x/SKILL.md'), 'utf8')).toBe('v1');

    const ok = await t.app.request('/api/file', json({ path: 'skills/x/SKILL.md', content: 'v2', expectedMtimeMs: f1.mtimeMs }, 'PUT'));
    expect(ok.status).toBe(200);
    expect((await t.app.request('/api/file', json({ path: 'a.md' }, 'PUT'))).status).toBe(400);
  });

  it('renames, refuses overwrite, creates folders', async () => {
    writeFileSync(path.join(t.libraryDir, 'a.md'), 'a');
    writeFileSync(path.join(t.libraryDir, 'b.md'), 'b');
    expect((await t.app.request('/api/file/rename', json({ from: 'a.md', to: 'sub/c.md' }))).status).toBe(200);
    expect(readFileSync(path.join(t.libraryDir, 'sub/c.md'), 'utf8')).toBe('a');
    expect((await t.app.request('/api/file/rename', json({ from: 'b.md', to: 'sub/c.md' }))).status).toBe(409);
    expect((await t.app.request('/api/file/rename', json({ from: 'b.md', to: '../c.md' }))).status).toBe(400);
    expect((await t.app.request('/api/folder', json({ path: 'new/deep' }))).status).toBe(200);
    expect(existsSync(path.join(t.libraryDir, 'new/deep'))).toBe(true);
  });

  it('deletes into <dataDir>/trash and protects top-level folders', async () => {
    mkdirSync(path.join(t.libraryDir, 'skills/x'), { recursive: true });
    writeFileSync(path.join(t.libraryDir, 'skills/x/SKILL.md'), 'bye');
    const res = await t.app.request('/api/file?path=skills/x', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(existsSync(path.join(t.libraryDir, 'skills/x'))).toBe(false);
    const stamps = readdirSync(path.join(t.dataDir, 'trash'));
    expect(stamps).toHaveLength(1);
    expect(readFileSync(path.join(t.dataDir, 'trash', stamps[0]!, 'skills/x/SKILL.md'), 'utf8')).toBe('bye');

    for (const p of ['', 'books', 'skills', 'evals']) {
      expect((await t.app.request(`/api/file?path=${q(p)}`, { method: 'DELETE' })).status, p).toBe(403);
    }
    expect(existsSync(path.join(t.libraryDir, 'books'))).toBe(true);
  });

  it('serves /api/raw with a content type', async () => {
    writeFileSync(path.join(t.libraryDir, 'x.pdf'), '%PDF-1.4 hello');
    const res = await t.app.request('/api/raw?path=x.pdf');
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(await res.text()).toBe('%PDF-1.4 hello');
  });

  it('streams bus events over SSE and unsubscribes on abort', async () => {
    const ac = new AbortController();
    const res = await t.app.request('/api/events', { signal: ac.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const event: ServerEvent = { type: 'fs', event: 'add', path: 'zzz.md' };
    // Publish until the subscriber (registered asynchronously) receives it.
    const pump = setInterval(() => t.ctx.bus.publish(event), 20);
    try {
      while (!text.includes('zzz.md')) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    } finally {
      clearInterval(pump);
      ac.abort();
      await reader.cancel().catch(() => undefined);
    }
    expect(text).toContain(`data: ${JSON.stringify(event)}`);
  });

  it('publishes fs events from the watcher', async () => {
    const seen: ServerEvent[] = [];
    t.ctx.bus.subscribe((e) => seen.push(e));
    await new Promise((r) => setTimeout(r, 400)); // let chokidar finish its initial scan
    writeFileSync(path.join(t.libraryDir, 'watched.md'), 'x');
    const end = Date.now() + 5000;
    while (!seen.some((e) => e.type === 'fs' && e.path === 'watched.md') && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    expect(seen.some((e) => e.type === 'fs' && e.event === 'add' && e.path === 'watched.md')).toBe(true);
  });
});

describe('New file (createOnly)', () => {
  const put = (body: Record<string, unknown>) => t.app.request('/api/file', { ...json(body), method: 'PUT' });

  it('creates a missing file', async () => {
    const res = await put({ path: 'notes/fresh.md', content: '', createOnly: true });
    expect(res.status).toBe(200);
    expect(existsSync(path.join(t.libraryDir, 'notes/fresh.md'))).toBe(true);
  });

  it('refuses to overwrite an existing file and leaves its content alone', async () => {
    mkdirSync(path.join(t.libraryDir, 'notes'), { recursive: true });
    writeFileSync(path.join(t.libraryDir, 'notes/keep.md'), 'precious');
    const res = await put({ path: 'notes/keep.md', content: '', createOnly: true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('already exists');
    expect(readFileSync(path.join(t.libraryDir, 'notes/keep.md'), 'utf8')).toBe('precious');
  });

  it('rejects a non-boolean createOnly', async () => {
    expect((await put({ path: 'notes/x.md', content: '', createOnly: 'yes' })).status).toBe(400);
  });
});
