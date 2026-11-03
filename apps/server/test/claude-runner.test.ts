import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildClaudeArgs, ClaudeAbortedError, runClaude, type ClaudeEvent } from '../src/claude/claude-runner.js';
import { ClaudeNotReadyError } from '../src/claude/claude-status.js';
import { detectSkillTrigger } from '../src/claude/detect-skill-trigger.js';
import { StreamJsonParser } from '../src/claude/stream-json-parser.js';
import { makeTestApp } from './fixtures/fake-claude/test-kit.js';

afterEach(() => {
  for (const k of ['FAKE_CLAUDE_AUTH', 'FAKE_CLAUDE_SLEEP_MS', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_ENTRYPOINT']) delete process.env[k];
});

describe('buildClaudeArgs', () => {
  it('always isolates settings, MCP and prompts', () => {
    const args = buildClaudeArgs({ model: 'sonnet', tools: ['Read'], allowedTools: ['Read', 'Edit(skills/x/**)'], disallowedTools: ['Bash'] });
    expect(args).toEqual([
      '-p', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--setting-sources', 'project,local', '--strict-mcp-config',
      '--permission-prompts', 'none', '--permission-mode', 'dontAsk', '--no-session-persistence', '--tools', 'Read',
      '--allowedTools', 'Read Edit(skills/x/**)', '--disallowedTools', 'Bash',
    ]);
  });
  it('emits an empty --tools for the tool-less judge and rejects flag-like models', () => {
    const args = buildClaudeArgs({ model: 'opus', tools: [], jsonSchema: '{}' });
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).toContain('--json-schema');
    expect(() => buildClaudeArgs({ model: '--dangerously-skip-permissions', tools: [] })).toThrow(/Invalid model/);
  });
});

describe('runClaude', () => {
  it('parses stream-json, writes the transcript, strips API env from the child', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-not-real';
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
    const app = makeTestApp();
    const events: ClaudeEvent[] = [];
    const transcript = path.join(app.root, 't', 'transcript.jsonl');
    const result = await runClaude(app.ctx.config, {
      cwd: app.root,
      prompt: 'hello there',
      model: 'sonnet',
      tools: ['Skill', 'Read'],
      transcriptFile: transcript,
      onEvent: (e) => events.push(e),
    });
    expect(result).toMatchObject({ isError: false, numTurns: 3, durationMs: 42, sessionId: 'fake-session' });
    expect(result.text).toContain('Answer to: hello there');
    expect(events.map((e) => e.kind)).toEqual(['init', 'text', 'result']);
    expect(readFileSync(transcript, 'utf8').trim().split('\n').length).toBe(3);

    const [call] = app.calls();
    expect(call!.prompt).toBe('hello there');
    expect(call!.envKeys.filter((k) => k.startsWith('ANTHROPIC_') || k.startsWith('CLAUDE_CODE_'))).toEqual([]);
  });

  it('refuses to spawn unless the login is claude.ai', async () => {
    const app = makeTestApp();
    process.env.FAKE_CLAUDE_AUTH = 'api-key';
    await expect(runClaude(app.ctx.config, { cwd: app.root, prompt: 'x', model: 'sonnet', tools: [] })).rejects.toThrow(ClaudeNotReadyError);
    expect(app.calls()).toHaveLength(0);
  });

  it('kills the child on abort', async () => {
    const app = makeTestApp();
    process.env.FAKE_CLAUDE_SLEEP_MS = '30000';
    const ac = new AbortController();
    const started = Date.now();
    const run = runClaude(app.ctx.config, { cwd: app.root, prompt: 'x', model: 'sonnet', tools: [], signal: ac.signal, onEvent: (e) => e.kind === 'init' && ac.abort() });
    await expect(run).rejects.toBeInstanceOf(ClaudeAbortedError);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe('runClaude lifecycle', () => {
  it('never spawns when cancelled during the status check', async () => {
    const app = makeTestApp();
    const ac = new AbortController();
    const run = runClaude(app.ctx.config, { cwd: app.root, prompt: 'x', model: 'sonnet', tools: [], signal: ac.signal });
    ac.abort();
    await expect(run).rejects.toBeInstanceOf(ClaudeAbortedError);
    await new Promise((r) => setTimeout(r, 200));
    expect(app.calls()).toHaveLength(0);
  });

  it('never spawns when already aborted', async () => {
    const app = makeTestApp();
    const ac = new AbortController();
    ac.abort();
    await expect(runClaude(app.ctx.config, { cwd: app.root, prompt: 'x', model: 'sonnet', tools: [], signal: ac.signal })).rejects.toBeInstanceOf(ClaudeAbortedError);
    expect(app.calls()).toHaveLength(0);
  });

  it('survives the transcript folder disappearing mid-run', async () => {
    const app = makeTestApp();
    const dir = path.join(app.root, 'gone');
    const transcript = path.join(dir, 'transcript.jsonl');
    const result = await runClaude(app.ctx.config, {
      cwd: app.root,
      prompt: 'x',
      model: 'sonnet',
      tools: [],
      transcriptFile: transcript,
      onEvent: (e) => e.kind === 'init' && rmSync(dir, { recursive: true, force: true }),
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain('Answer to');
  });

  it.each([
    ['settings.json', { env: { ANTHROPIC_API_KEY: 'x' } }],
    ['settings.local.json', { hooks: { PreToolUse: [] } }],
    ['settings.json', { apiKeyHelper: 'echo x' }],
  ])('refuses to run when %s defines billing or hook keys', async (file, content) => {
    const app = makeTestApp();
    mkdirSync(path.join(app.root, '.claude'), { recursive: true });
    writeFileSync(path.join(app.root, '.claude', file), JSON.stringify(content));
    await expect(runClaude(app.ctx.config, { cwd: app.root, prompt: 'x', model: 'sonnet', tools: [] })).rejects.toThrow(/Refusing to run Claude/);
    expect(app.calls()).toHaveLength(0);
  });

  it('allows project settings without risky keys', async () => {
    const app = makeTestApp();
    mkdirSync(path.join(app.root, '.claude'), { recursive: true });
    writeFileSync(path.join(app.root, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: [] } }));
    await expect(runClaude(app.ctx.config, { cwd: app.root, prompt: 'x', model: 'sonnet', tools: [] })).resolves.toMatchObject({ isError: false });
  });
});

describe('StreamJsonParser', () => {
  it('summarises tool calls with cwd-relative paths and records tool uses', () => {
    const p = new StreamJsonParser('/lib');
    const events = p.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/lib/books/x/markdown/03-a.md' } }, { type: 'tool_use', name: 'Skill', input: { skill: 'foo' } }] } }));
    expect(events.map((e) => e.message)).toEqual(['Read books/x/markdown/03-a.md', 'Skill foo']);
    expect(p.state().toolUses).toHaveLength(2);
    expect(p.push('not json')).toEqual([]);
  });
  it('reads structured_output and is_error from the result line', () => {
    const p = new StreamJsonParser();
    p.push(JSON.stringify({ type: 'result', is_error: true, result: 'boom', structured_output: { a: 1 } }));
    expect(p.state()).toMatchObject({ finished: true, isError: true, text: 'boom', structured: { a: 1 } });
  });
});

describe('detectSkillTrigger', () => {
  it('matches Skill tool calls and reads of the installed skill, by whole name', () => {
    expect(detectSkillTrigger([{ name: 'Skill', input: { skill: 'onboarding-audit' } }], 'onboarding-audit')).toBe(true);
    expect(detectSkillTrigger([{ name: 'Skill', input: { skill: 'onboarding-audit-v2' } }], 'onboarding-audit')).toBe(false);
    expect(detectSkillTrigger([{ name: 'Read', input: { file_path: '/tmp/x/.claude/skills/onboarding-audit/references/a.md' } }], 'onboarding-audit')).toBe(true);
    expect(detectSkillTrigger([{ name: 'Read', input: { file_path: '/tmp/x/notes.md' } }, { name: 'Grep', input: {} }], 'onboarding-audit')).toBe(false);
  });
});
