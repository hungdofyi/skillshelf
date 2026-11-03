/**
 * Headless runs read `<cwd>/.claude/settings{,.local}.json` (`--setting-sources project,local`).
 * Those files can redirect billing (env, apiKeyHelper, forceLoginMethod, awsAuthRefresh) or run
 * shell commands (hooks) after the claude.ai login gate has already passed, so a run is refused
 * when either file defines one of those keys.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const RISKY_KEYS = ['env', 'apiKeyHelper', 'hooks', 'awsAuthRefresh', 'forceLoginMethod'] as const;
const SETTINGS_FILES = ['settings.json', 'settings.local.json'] as const;

/** Throws a UI-ready error naming the offending file and keys. */
export function assertNoRiskyProjectSettings(cwd: string): void {
  for (const name of SETTINGS_FILES) {
    const file = path.join(cwd, '.claude', name);
    if (!existsSync(file)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new Error(`Refusing to run Claude: ${file} exists but is not valid JSON. Fix or remove it.`);
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const found = RISKY_KEYS.filter((k) => k in (parsed as Record<string, unknown>));
    if (found.length > 0) {
      throw new Error(`Refusing to run Claude: ${file} defines ${found.join(', ')}, which could change billing or run commands. Remove those keys first.`);
    }
  }
}
