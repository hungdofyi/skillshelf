import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertNoApiKey, buildClaudeEnv, findApiKeyLeaks } from '../src/claude/claude-env.js';
import { clearClaudeStatusCache, getClaudeStatus } from '../src/claude/claude-status.js';
import { FAKE_CLAUDE } from './fixtures/fake-claude/test-kit.js';
import { chmodSync } from 'node:fs';

describe('buildClaudeEnv', () => {
  it('drops ANTHROPIC_*, CLAUDECODE and CLAUDE_CODE_* but keeps config dir, PATH, HOME', () => {
    const env = buildClaudeEnv({
      ANTHROPIC_API_KEY: 'sk-x',
      ANTHROPIC_BASE_URL: 'u',
      CLAUDECODE: '1',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CONFIG_DIR: '/c',
      PATH: '/bin',
      HOME: '/h',
    });
    expect(Object.keys(env).sort()).toEqual(['CLAUDE_CONFIG_DIR', 'HOME', 'PATH']);
    expect(findApiKeyLeaks(env)).toEqual([]);
  });

  it('assertNoApiKey throws naming the variable but never its value', () => {
    expect(() => assertNoApiKey({ ANTHROPIC_API_KEY: 'sk-secret' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => assertNoApiKey({ ANTHROPIC_API_KEY: 'sk-secret' })).not.toThrow(/sk-secret/);
  });
});

describe('getClaudeStatus', () => {
  beforeEach(() => {
    chmodSync(FAKE_CLAUDE, 0o755);
    clearClaudeStatusCache();
  });
  afterEach(() => {
    delete process.env.FAKE_CLAUDE_AUTH;
    clearClaudeStatusCache();
  });

  it('is ready on the claude.ai login', async () => {
    const s = await getClaudeStatus({ claudeBin: FAKE_CLAUDE });
    expect(s).toMatchObject({ installed: true, loggedIn: true, authMethod: 'claude.ai', ready: true, apiKeyLeak: false, version: '2.1.317 (Claude Code)' });
  });

  it('refuses the api-key auth method', async () => {
    process.env.FAKE_CLAUDE_AUTH = 'api-key';
    const s = await getClaudeStatus({ claudeBin: FAKE_CLAUDE });
    expect(s.ready).toBe(false);
    expect(s.reason).toMatch(/claude\.ai/);
  });

  it('reports logged-out and missing binaries', async () => {
    process.env.FAKE_CLAUDE_AUTH = 'logged-out';
    expect((await getClaudeStatus({ claudeBin: FAKE_CLAUDE })).ready).toBe(false);
    const missing = await getClaudeStatus({ claudeBin: '/nonexistent/claude' });
    expect(missing).toMatchObject({ installed: false, ready: false });
  });

  it('caches for a short time', async () => {
    await getClaudeStatus({ claudeBin: FAKE_CLAUDE });
    process.env.FAKE_CLAUDE_AUTH = 'api-key';
    expect((await getClaudeStatus({ claudeBin: FAKE_CLAUDE })).ready).toBe(true);
    expect((await getClaudeStatus({ claudeBin: FAKE_CLAUDE }, { force: true })).ready).toBe(false);
  });
});
