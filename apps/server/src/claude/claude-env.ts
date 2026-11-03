/**
 * Environment handed to every `claude` child process.
 *
 * Billing guard: the child must run on the claude.ai subscription login, never on an API key.
 * So every ANTHROPIC_* variable is removed, and so are CLAUDECODE / CLAUDE_CODE_* (they would
 * make the child behave as a nested session or switch it to Bedrock/Vertex billing).
 * CLAUDE_CONFIG_DIR, PATH and HOME are kept so the login is found.
 */

const STRIPPED = [/^ANTHROPIC_/, /^CLAUDECODE$/, /^CLAUDE_CODE_/];
/** Variables that would redirect billing away from the claude.ai login if they survived. */
const LEAK = [/^ANTHROPIC_/, /^CLAUDE_CODE_USE_/, /^AWS_BEARER_TOKEN_BEDROCK$/];

export function buildClaudeEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (STRIPPED.some((re) => re.test(key))) continue;
    env[key] = value;
  }
  return env;
}

/** Names (never values) of billing-relevant variables present in env. */
export function findApiKeyLeaks(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter((key) => env[key] !== undefined && LEAK.some((re) => re.test(key)));
}

export function assertNoApiKey(env: NodeJS.ProcessEnv): void {
  const leaks = findApiKeyLeaks(env);
  if (leaks.length > 0) throw new Error(`Refusing to run claude: billing variables present in the child environment (${leaks.join(', ')}).`);
}
