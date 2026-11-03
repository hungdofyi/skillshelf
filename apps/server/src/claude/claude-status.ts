/**
 * Is the Claude Code CLI installed and logged in with the claude.ai subscription?
 * `ready` gates every headless run. Results are cached briefly because the UI polls it.
 */
import { spawn } from 'node:child_process';
import type { ClaudeStatus } from '@b2s/shared';
import { assertNoApiKey, buildClaudeEnv, findApiKeyLeaks } from './claude-env.js';

const CACHE_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 20_000;
const cache = new Map<string, { at: number; status: ClaudeStatus }>();

export class ClaudeNotReadyError extends Error {
  constructor(readonly status: ClaudeStatus) {
    super(`Claude Code is not ready: ${status.reason ?? 'unknown reason'}`);
    this.name = 'ClaudeNotReadyError';
  }
}

export function clearClaudeStatusCache(): void {
  cache.clear();
}

/** Run a short probe command with the stripped env; resolves stdout even on non-zero exit. */
function probe(bin: string, args: string[]): Promise<{ ok: boolean; stdout: string; spawnError?: string }> {
  return new Promise((resolve) => {
    const env = buildClaudeEnv();
    assertNoApiKey(env);
    let stdout = '';
    let settled = false;
    const done = (value: { ok: boolean; stdout: string; spawnError?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({ ok: false, stdout, spawnError: 'timed out' });
    }, PROBE_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.on('error', (err) => done({ ok: false, stdout, spawnError: err.message }));
    child.on('close', (code) => done({ ok: code === 0, stdout }));
  });
}

export async function getClaudeStatus(config: { claudeBin: string }, opts: { force?: boolean } = {}): Promise<ClaudeStatus> {
  const hit = cache.get(config.claudeBin);
  if (!opts.force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.status;
  const status = await computeStatus(config.claudeBin);
  cache.set(config.claudeBin, { at: Date.now(), status });
  return status;
}

async function computeStatus(bin: string): Promise<ClaudeStatus> {
  const apiKeyLeak = findApiKeyLeaks(buildClaudeEnv()).length > 0;
  const base: ClaudeStatus = { installed: false, loggedIn: false, apiKeyLeak, ready: false };

  const version = await probe(bin, ['--version']);
  if (!version.ok) return { ...base, reason: `Claude Code CLI not found or not runnable (${bin}${version.spawnError ? `: ${version.spawnError}` : ''}).` };
  const installed = { ...base, installed: true, version: version.stdout.trim().split('\n')[0] };

  const auth = await probe(bin, ['auth', 'status']);
  let parsed: { loggedIn?: boolean; authMethod?: string; email?: string; orgName?: string } = {};
  try {
    parsed = JSON.parse(auth.stdout) as typeof parsed;
  } catch {
    return { ...installed, reason: 'Could not read `claude auth status` output. Run `claude auth login` in a terminal.' };
  }
  const status: ClaudeStatus = {
    ...installed,
    loggedIn: parsed.loggedIn === true,
    authMethod: parsed.authMethod,
    email: parsed.email,
    orgName: parsed.orgName,
  };
  if (!status.loggedIn) return { ...status, reason: 'Not logged in. Run `claude auth login` and choose the claude.ai account.' };
  if (status.authMethod !== 'claude.ai') {
    return { ...status, reason: `Auth method is "${status.authMethod ?? 'unknown'}"; only the claude.ai subscription login is allowed (no API billing).` };
  }
  if (apiKeyLeak) return { ...status, reason: 'Billing environment variables survived env stripping.' };
  return { ...status, ready: true };
}

/** Throws ClaudeNotReadyError (message is UI-ready) unless the CLI is usable on the claude.ai login. */
export async function assertClaudeReady(config: { claudeBin: string }): Promise<ClaudeStatus> {
  const status = await getClaudeStatus(config);
  if (!status.ready) throw new ClaudeNotReadyError(status);
  return status;
}
