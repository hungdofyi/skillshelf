/**
 * Runs one headless Claude Code session (`claude -p`) and parses its stream-json output.
 *
 * Safety properties, all enforced here so callers cannot forget them:
 *  - refuses to spawn unless `claude auth status` reports the claude.ai login;
 *  - child env has every ANTHROPIC_* / CLAUDE_CODE_* variable removed;
 *  - permission prompts are denied (never hang), only user/project settings from the cwd are read,
 *    no MCP servers are loaded, and the session is not persisted;
 *  - the prompt goes through stdin, so long prompts and variadic flags cannot collide.
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Effort } from '@b2s/shared';
import { assertNoApiKey, buildClaudeEnv } from './claude-env.js';
import { assertClaudeReady } from './claude-status.js';
import { assertNoRiskyProjectSettings } from './project-settings-guard.js';
import { type ClaudeEvent, type ClaudeToolUse, summarizeToolUse, StreamJsonParser } from './stream-json-parser.js';

export type { ClaudeEvent, ClaudeToolUse } from './stream-json-parser.js';

export interface ClaudeRunOptions {
  cwd: string;
  prompt: string;
  model: string;
  /** Reasoning effort (`--effort`); the flag is omitted when undefined. */
  effort?: Effort;
  /** Built-in tool set offered to the model (`--tools`). `[]` disables every tool. */
  tools: string[];
  /** Permission rules that pre-approve calls (`--allowedTools`), e.g. "Edit(skills/x/**)". */
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionMode?: 'dontAsk' | 'acceptEdits' | 'plan';
  addDirs?: string[];
  /** JSON Schema string; result arrives as `structured`. */
  jsonSchema?: string;
  maxBudgetUsd?: number;
  /** Raw stream-json lines are appended here (parent folders are created). */
  transcriptFile?: string;
  signal?: AbortSignal;
  onEvent?: (event: ClaudeEvent) => void;
  /** Kill the child after this long. Default 40 minutes. */
  timeoutMs?: number;
}

export interface ClaudeRunResult {
  text: string;
  structured?: unknown;
  isError: boolean;
  numTurns: number;
  durationMs: number;
  sessionId?: string;
  toolUses: ClaudeToolUse[];
  /** Last stderr lines, useful when the CLI died without a result event. */
  stderrTail: string;
}

export class ClaudeAbortedError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'ClaudeAbortedError';
  }
}

/** A model alias or id; rejects anything that could be read as another flag. */
export function assertSafeModel(model: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\-[\]]{0,99}$/.test(model)) throw new Error(`Invalid model name: ${model}`);
}

/** Pure argv builder (also used to document the exact command in reports and tests). */
export function buildClaudeArgs(opts: Omit<ClaudeRunOptions, 'cwd' | 'prompt'>): string[] {
  assertSafeModel(opts.model);
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', opts.model,
    '--setting-sources', 'project,local',
    '--strict-mcp-config',
    '--permission-prompts', 'none',
    '--permission-mode', opts.permissionMode ?? 'dontAsk',
    '--no-session-persistence',
    '--tools', opts.tools.join(','),
  ];
  if (opts.effort) args.push('--effort', opts.effort);
  if (opts.allowedTools?.length) args.push('--allowedTools', opts.allowedTools.join(' '));
  if (opts.disallowedTools?.length) args.push('--disallowedTools', opts.disallowedTools.join(' '));
  for (const dir of opts.addDirs ?? []) args.push('--add-dir', dir);
  if (opts.jsonSchema) args.push('--json-schema', opts.jsonSchema);
  if (opts.maxBudgetUsd !== undefined) args.push('--max-budget-usd', String(opts.maxBudgetUsd));
  return args;
}

const DEFAULT_TIMEOUT_MS = 40 * 60_000;

export async function runClaude(config: { claudeBin: string }, opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  if (opts.signal?.aborted) throw new ClaudeAbortedError();
  // The listener exists before the status probe is awaited, so a cancel during the probe is seen.
  let child: ChildProcessWithoutNullStreams | undefined;
  let abortedByCaller = false;
  let killTimer: NodeJS.Timeout | undefined;
  const terminate = () => {
    child?.kill('SIGTERM');
    killTimer = setTimeout(() => child?.kill('SIGKILL'), 3000);
  };
  const onAbort = () => {
    abortedByCaller = true;
    if (child) terminate();
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  let env: NodeJS.ProcessEnv;
  let args: string[];
  try {
    await assertClaudeReady(config);
    if (abortedByCaller || opts.signal?.aborted) throw new ClaudeAbortedError();
    assertNoRiskyProjectSettings(opts.cwd);
    env = buildClaudeEnv();
    assertNoApiKey(env);
    args = buildClaudeArgs(opts);
    if (opts.transcriptFile) mkdirSync(path.dirname(opts.transcriptFile), { recursive: true });
  } catch (err) {
    opts.signal?.removeEventListener('abort', onAbort);
    throw err;
  }

  return new Promise<ClaudeRunResult>((resolve, reject) => {
    child = spawn(config.claudeBin, args, { cwd: opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const proc = child;
    const parser = new StreamJsonParser(opts.cwd);
    let stderrTail = '';
    let buffer = '';
    let settled = false;
    let timedOut = false;
    let transcriptFailed = false;

    const emit = (event: ClaudeEvent) => {
      try {
        opts.onEvent?.(event);
      } catch {
        // A faulty log callback must not break the run.
      }
    };
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      if (opts.transcriptFile && !transcriptFailed) {
        // Runs inside a stream handler: a throw here would be uncaught and kill the server.
        try {
          appendFileSync(opts.transcriptFile, line + '\n');
        } catch (err) {
          transcriptFailed = true;
          console.warn(`claude transcript disabled (${opts.transcriptFile}): ${err instanceof Error ? err.message : err}`);
        }
      }
      for (const event of parser.push(line)) emit(event);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // Aborted between the checks above and here (cannot happen synchronously, but stay safe).
    if (abortedByCaller) terminate();

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000);
    });
    proc.stdin.on('error', () => {
      // The child may exit before reading the prompt; the close handler reports that.
    });
    proc.on('error', (err) => finish(() => reject(new Error(`Could not start claude: ${err.message}`))));
    proc.on('close', (code) => {
      if (buffer.trim()) handleLine(buffer);
      finish(() => {
        if (abortedByCaller) return reject(new ClaudeAbortedError());
        const state = parser.state();
        if (timedOut) return reject(new Error(`claude timed out after ${Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 60_000)} minutes`));
        if (!state.finished) {
          const detail = stderrTail.trim().split('\n').slice(-3).join(' | ');
          return reject(new Error(`claude exited (code ${code}) without a result${detail ? `: ${detail}` : ''}`));
        }
        resolve({
          text: state.text,
          structured: state.structured,
          isError: state.isError,
          numTurns: state.numTurns,
          durationMs: state.durationMs,
          sessionId: state.sessionId,
          toolUses: state.toolUses,
          stderrTail,
        });
      });
    });

    proc.stdin.end(opts.prompt);
  });
}

export { summarizeToolUse };
