import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createAppContext, type AppContext } from '../src/app-context.js';
import { loadConfig } from '../src/config.js';
import { makeLibrary } from './mcp-fixture.js';

let lib: string;
let data: string;
let ctx: AppContext;
let app: ReturnType<typeof createApp>;
let token: string;

const rpc = (method: string, params: unknown, id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const init = rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });

beforeAll(async () => {
  lib = makeLibrary();
  data = `${lib}-data`;
  ctx = createAppContext(loadConfig({ libraryDir: lib, dataDir: data, mcpToken: undefined }));
  app = createApp(ctx);
  token = ((await (await app.request('/api/mcp/info')).json()) as { localUrl: string }).localUrl.split('/mcp/')[1]!;
});
afterAll(async () => {
  await ctx.shutdown();
  rmSync(lib, { recursive: true, force: true });
  rmSync(data, { recursive: true, force: true });
});

describe('MCP HTTP endpoint', () => {
  it('initialize + tools/list over /mcp/:token as plain JSON', async () => {
    const res = await app.request(`/mcp/${token}`, { method: 'POST', headers, body: init });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as any).result.serverInfo.name).toBe('skillshelf');
    const list = await app.request(`/mcp/${token}`, { method: 'POST', headers, body: rpc('tools/list', {}, 2) });
    expect(list.status).toBe(200);
    expect(((await list.json()) as any).result.tools.length).toBe(8);
    const call = await app.request(`/mcp/${token}`, { method: 'POST', headers, body: rpc('tools/call', { name: 'search', arguments: { query: 'zebrafish' } }, 3) });
    expect(((await call.json()) as any).result.structuredContent.results[0].id).toBe('chapter:onboarding-book/0');
  });

  it('accepts Bearer on /mcp', async () => {
    const res = await app.request('/mcp', { method: 'POST', headers: { ...headers, authorization: `Bearer ${token}` }, body: init });
    expect(res.status).toBe(200);
  });

  it('answers 404 (not 401) for wrong or missing token', async () => {
    expect((await app.request('/mcp/wrong', { method: 'POST', headers, body: init })).status).toBe(404);
    expect((await app.request('/mcp', { method: 'POST', headers, body: init })).status).toBe(404);
    expect((await app.request('/mcp', { method: 'POST', headers: { ...headers, authorization: 'Bearer nope' }, body: init })).status).toBe(404);
    expect((await app.request(`/mcp/${token}x`, { method: 'POST', headers, body: init })).status).toBe(404);
  });

  it('GET/DELETE are 405 JSON-RPC errors', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await app.request(`/mcp/${token}`, { method, headers: { accept: 'text/event-stream' } });
      expect(res.status).toBe(405);
      expect(((await res.json()) as any).error.code).toBe(-32000);
    }
  });

  it('info + rotate', async () => {
    const info = (await (await app.request('/api/mcp/info')).json()) as any;
    expect(info.localUrl).toBe(`http://localhost:${ctx.config.port}/mcp/${token}`);
    expect(info.tokenPreview).toBe(`${token.slice(0, 4)}…`);
    expect(info.tunnel.status).toBe('stopped');
    expect(info.claudeCodeCommand).toMatch(/^claude mcp add --scope user skillshelf -- \/.*tsx \/.*mcp-stdio-entry\.ts$/);
    expect(info.tools.length).toBe(8);
    const events: unknown[] = [];
    ctx.bus.subscribe((e) => events.push(e));
    const rotated = (await (await app.request('/api/mcp/token/rotate', { method: 'POST' })).json()) as any;
    expect(rotated.localUrl).not.toContain(token);
    expect(events).toHaveLength(1);
    expect((await app.request(`/mcp/${token}`, { method: 'POST', headers, body: init })).status).toBe(404);
  });
});
