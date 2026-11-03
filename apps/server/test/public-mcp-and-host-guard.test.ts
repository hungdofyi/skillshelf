/** The public (tunnelled) app must expose only MCP; the local API must refuse foreign Host headers. */
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createAppContext, type AppContext } from '../src/app-context.js';
import { loadConfig } from '../src/config.js';
import { getMcpServices } from '../src/mcp/mcp-services.js';
import { createPublicMcpApp } from '../src/routes/public-mcp-app.js';
import { makeLibrary } from './mcp-fixture.js';

let lib: string;
let ctx: AppContext;
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });

beforeAll(() => {
  lib = makeLibrary();
  ctx = createAppContext(loadConfig({ libraryDir: lib, dataDir: `${lib}-data`, mcpToken: undefined }));
});
afterAll(async () => {
  await ctx.shutdown();
  rmSync(lib, { recursive: true, force: true });
  rmSync(`${lib}-data`, { recursive: true, force: true });
});

describe('public MCP app (tunnel target)', () => {
  it('serves MCP with the token and shares it with the local app', async () => {
    const local = createApp(ctx);
    const pub = createPublicMcpApp(ctx);
    const token = getMcpServices(ctx).token.current;
    const res = await pub.request(`https://abc.trycloudflare.com/mcp/${token}`, { method: 'POST', headers, body: init });
    expect(res.status).toBe(200);
    const alt = await pub.request(`https://abc.trycloudflare.com/${token}/mcp`, { method: 'POST', headers, body: init });
    expect(alt.status).toBe(200);
    const info = (await (await local.request('/api/mcp/info')).json()) as { localUrl: string };
    expect(info.localUrl.endsWith(`/mcp/${token}`)).toBe(true);
  });

  it('never exposes /api routes or the web UI', async () => {
    const pub = createPublicMcpApp(ctx);
    for (const p of ['/api/mcp/info', '/api/tree', '/api/file?path=x', '/', '/index.html']) {
      expect((await pub.request(`https://abc.trycloudflare.com${p}`)).status).toBe(404);
    }
    expect((await pub.request('https://abc.trycloudflare.com/mcp/wrong-token', { method: 'POST', headers, body: init })).status).toBe(404);
  });
});

describe('local API host guard', () => {
  it('accepts localhost and refuses other hosts (DNS rebinding)', async () => {
    const app = createApp(ctx);
    expect((await app.request('http://localhost:4317/api/health')).status).toBe(200);
    expect((await app.request('http://127.0.0.1:4317/api/health')).status).toBe(200);
    expect((await app.request('http://evil.example/api/health')).status).toBe(403);
    expect((await app.request('http://localhost/api/health', { headers: { host: 'attacker.test' } })).status).toBe(403);
  });
});

describe('local API CSRF guard', () => {
  const post = (app: ReturnType<typeof createApp>, hdrs: Record<string, string>) =>
    app.request('http://localhost:4317/api/folder', { method: 'POST', headers: { 'content-type': 'text/plain', ...hdrs }, body: JSON.stringify({ path: 'tmp/csrf-probe' }) });

  it('refuses unsafe requests from foreign origins or cross-site fetches', async () => {
    const app = createApp(ctx);
    expect((await post(app, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(app, { origin: 'null' })).status).toBe(403);
    expect((await post(app, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post(app, { 'sec-fetch-site': 'same-site', origin: 'http://localhost:5317' })).status).toBe(403);
  });

  it('allows local origins on any port and requests without an Origin', async () => {
    const app = createApp(ctx);
    expect((await post(app, { origin: 'http://127.0.0.1:5317' })).status).toBe(200);
    expect((await post(app, { origin: 'http://localhost:4317', 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    expect((await post(app, { origin: 'http://[::1]:5317' })).status).toBe(200);
    expect((await post(app, {})).status).toBe(200);
  });

  it('does not restrict safe methods', async () => {
    const app = createApp(ctx);
    expect((await app.request('http://localhost:4317/api/health', { headers: { origin: 'https://evil.example' } })).status).toBe(200);
  });
});
