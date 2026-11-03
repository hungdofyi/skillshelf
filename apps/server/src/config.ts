/**
 * Runtime configuration, resolved once at startup from env (and .env at the repo root if present).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repo root: apps/server/src -> ../../.. */
export const REPO_ROOT = path.resolve(here, '../../..');

const envFile = path.join(REPO_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export interface AppConfig {
  repoRoot: string;
  libraryDir: string;
  /** Runtime state (job logs, MCP token, trash). Gitignored. */
  dataDir: string;
  converterDir: string;
  promptsDir: string;
  webDistDir: string;
  port: number;
  /** MCP-only server for the public tunnel (no /api routes). */
  publicMcpPort: number;
  /** Base URL of the web UI, used for absolute links in MCP search results. */
  publicWebUrl: string;
  models: { generate: string; eval: string; judge: string };
  /** Fixed MCP token from env; otherwise generated into dataDir/mcp-token. */
  mcpToken?: string;
  /** Converter CLI argv prefix; the input file and flags are appended. Overridable for tests. */
  converterCommand: string[];
  /** Claude Code CLI binary. Overridable (CLAUDE_BIN) so tests can use a fake. */
  claudeBin: string;
  /** Which tunnel binary to use for public MCP access. */
  tunnel: { provider: 'cloudflared' | 'ngrok'; ngrokDomain?: string };
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  const port = Number(env.PORT ?? 4317);
  const base: AppConfig = {
    repoRoot: REPO_ROOT,
    libraryDir: path.resolve(REPO_ROOT, env.LIBRARY_DIR ?? 'library'),
    dataDir: path.resolve(REPO_ROOT, env.DATA_DIR ?? '.data'),
    converterDir: path.join(REPO_ROOT, 'converter'),
    promptsDir: path.join(REPO_ROOT, 'prompts'),
    webDistDir: path.join(REPO_ROOT, 'apps/web/dist'),
    port,
    publicMcpPort: Number(env.MCP_PUBLIC_PORT ?? port + 1),
    publicWebUrl: env.PUBLIC_WEB_URL ?? `http://localhost:${env.NODE_ENV === 'production' ? port : 5317}`,
    models: {
      generate: env.GENERATE_MODEL ?? 'sonnet',
      eval: env.EVAL_MODEL ?? 'sonnet',
      judge: env.JUDGE_MODEL ?? 'sonnet',
    },
    mcpToken: env.MCP_TOKEN || undefined,
    converterCommand: ['uv', 'run', '--quiet', '--project', path.join(REPO_ROOT, 'converter'), 'book-convert'],
    claudeBin: env.CLAUDE_BIN ?? 'claude',
    tunnel: {
      provider: env.TUNNEL_PROVIDER === 'ngrok' ? 'ngrok' : 'cloudflared',
      ngrokDomain: env.NGROK_DOMAIN || undefined,
    },
  };
  return { ...base, ...overrides };
}
