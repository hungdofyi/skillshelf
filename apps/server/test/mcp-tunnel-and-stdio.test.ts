import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it, vi } from 'vitest';
import { McpToken } from '../src/mcp/mcp-token.js';
import { TunnelManager } from '../src/mcp/tunnel-manager.js';
import { makeLibrary } from './mcp-fixture.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeBinary(script: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'b2s-fake-'));
  const file = path.join(dir, 'fake-tunnel');
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('tunnel manager', () => {
  it('parses a trycloudflare URL and stop kills the process', async () => {
    const bin = fakeBinary('echo "INF Requesting new quick Tunnel" >&2\necho "|  https://random-words-here.trycloudflare.com  |" >&2\nexec sleep 60');
    const tm = new TunnelManager({ provider: 'cloudflared', port: 4317, binary: bin });
    const s = await tm.start();
    expect(s).toMatchObject({ status: 'running', publicBaseUrl: 'https://random-words-here.trycloudflare.com' });
    const pid = s.pid!;
    expect(alive(pid)).toBe(true);
    expect((await tm.stop()).status).toBe('stopped');
    await new Promise((r) => setTimeout(r, 100));
    expect(alive(pid)).toBe(false);
  });

  it('ignores cloudflared\'s own api host in error lines', async () => {
    const bin = fakeBinary('echo \'ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": EOF\' >&2\nexec sleep 60');
    const tm = new TunnelManager({ provider: 'cloudflared', port: 1, binary: bin, startTimeoutMs: 300 });
    const s = await tm.start();
    expect(s.publicBaseUrl).toBeUndefined();
    expect(s.status).toBe('error');
    await tm.stop();
  });

  it('parses ngrok JSON log output', async () => {
    const bin = fakeBinary('echo \'{"msg":"started tunnel","url":"https://abc.ngrok-free.app"}\'\nexec sleep 60');
    const tm = new TunnelManager({ provider: 'ngrok', port: 4317, binary: bin });
    expect((await tm.start()).publicBaseUrl).toBe('https://abc.ngrok-free.app');
    await tm.stop();
  });

  it('reports unavailable with an install hint when the binary is missing', async () => {
    const tm = new TunnelManager({ provider: 'cloudflared', port: 4317, binary: '/nonexistent/cloudflared' });
    const s = await tm.start();
    expect(s.status).toBe('unavailable');
    expect(s.error).toContain('brew install cloudflared');
  });

  it('reports error when the process exits early and when no URL appears in time', async () => {
    const early = new TunnelManager({ provider: 'cloudflared', port: 1, binary: fakeBinary('echo boom >&2\nexit 3') });
    const e = await early.start();
    expect(e.status).toBe('error');
    expect(e.error).toContain('boom');
    const silent = new TunnelManager({ provider: 'cloudflared', port: 1, binary: fakeBinary('exec sleep 60'), startTimeoutMs: 200 });
    const s = await silent.start();
    expect(s.status).toBe('error');
    expect(s.error).toContain('Timed out');
    await silent.stop();
  });
});

describe('mcp token', () => {
  it('persists with mode 0600, rotates, compares in constant time', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'b2s-token-'));
    const t = new McpToken(dir);
    expect(t.current).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(statSync(path.join(dir, 'mcp-token')).mode & 0o777).toBe(0o600);
    expect(new McpToken(dir).current).toBe(t.current);
    expect(t.matches(t.current)).toBe(true);
    expect(t.matches('x')).toBe(false);
    expect(t.matches(undefined)).toBe(false);
    const old = t.current;
    expect(t.rotate()).not.toBe(old);
    expect(readFileSync(path.join(dir, 'mcp-token'), 'utf8').trim()).toBe(t.current);
    expect(() => new McpToken(dir, 'fixed-token-value-1234567890-abc').rotate()).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores an MCP_TOKEN shorter than 24 characters', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'b2s-token-'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = new McpToken(dir, 'short');
    expect(t.current).not.toBe('short');
    expect(t.current).toHaveLength(43);
    expect(t.isFixed).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('stdio entry', () => {
  it('lists tools over stdio against a temp library with clean stdout', async () => {
    const lib = makeLibrary();
    const transport = new StdioClientTransport({
      command: path.join(serverDir, 'node_modules/.bin/tsx'),
      args: [path.join(serverDir, 'src/mcp/mcp-stdio-entry.ts')],
      env: { ...(process.env as Record<string, string>), LIBRARY_DIR: lib },
      stderr: 'ignore',
    });
    const client = new Client({ name: 'test', version: '1' });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(8);
      const r = (await client.callTool({ name: 'list_skills', arguments: {} })) as unknown as { structuredContent: { skills: unknown[] } };
      expect(r.structuredContent.skills).toHaveLength(1);
    } finally {
      await client.close();
      rmSync(lib, { recursive: true, force: true });
    }
    expect(existsSync(path.join(serverDir, 'src/mcp/mcp-stdio-entry.ts'))).toBe(true);
  }, 30_000);
});
