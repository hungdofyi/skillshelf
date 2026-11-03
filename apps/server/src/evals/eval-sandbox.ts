/**
 * Throw-away working directory for one agent run. It lives under the OS temp dir, not inside the
 * repo, so no parent CLAUDE.md or .claude/skills of this project can leak into either arm.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Sandbox {
  dir: string;
  /** Files present before the agent ran (case input files), POSIX relative paths. */
  initialFiles: Set<string>;
  dispose(): void;
}

/**
 * A case input file must be a plain relative path inside the skill folder. Dot-segments (which
 * would allow `.claude/settings.json`, i.e. hooks or billing overrides), CLAUDE.md and `..` are
 * refused, and the resolved real path (symlinks followed) must stay inside the skill folder.
 */
export function resolveCaseFile(skillRoot: string, sandboxDir: string, rel: unknown): { from: string; to: string } {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0') || rel.includes('\\') || path.isAbsolute(rel)) {
    throw new Error(`Eval file path must be a plain relative path: ${String(rel)}`);
  }
  for (const segment of rel.split('/')) {
    if (segment === '' || segment === '.' || segment === '..' || segment.startsWith('.') || segment.toLowerCase() === 'claude.md') {
      throw new Error(`Eval file path is not allowed (hidden, CLAUDE.md or parent segment): ${rel}`);
    }
  }
  const from = path.resolve(skillRoot, rel);
  const to = path.resolve(sandboxDir, rel);
  if (!from.startsWith(skillRoot + path.sep) || !to.startsWith(sandboxDir + path.sep)) throw new Error(`Eval file path escapes the skill folder: ${rel}`);
  if (!existsSync(from)) throw new Error(`Eval input file not found: ${rel}`);
  const realRoot = realpathSync(skillRoot);
  const realFrom = realpathSync(from);
  if (realFrom !== realRoot && !realFrom.startsWith(realRoot + path.sep)) throw new Error(`Eval file resolves outside the skill folder: ${rel}`);
  return { from: realFrom, to };
}

export function createSandbox(opts: { skillName: string; skillDir?: string; caseFiles?: string[]; skillRootForFiles: string }): Sandbox {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'b2s-eval-'));
  const dispose = () => rmSync(dir, { recursive: true, force: true });
  try {
    if (opts.skillDir) {
      // Everything except evals/: the agent must not see the test prompts or expectations.
      const dest = path.join(dir, '.claude', 'skills', opts.skillName);
      cpSync(opts.skillDir, dest, {
        recursive: true,
        filter: (src) => {
          const rel = path.relative(opts.skillDir!, src).split(path.sep);
          return rel[0] !== 'evals';
        },
      });
    }
    for (const rel of opts.caseFiles ?? []) {
      const { from, to } = resolveCaseFile(opts.skillRootForFiles, dir, rel);
      mkdirSync(path.dirname(to), { recursive: true });
      cpSync(from, to);
    }
    const initialFiles = new Set(walk(dir).filter((f) => !f.startsWith('.claude/')));
    return { dir, initialFiles, dispose };
  } catch (err) {
    dispose();
    throw err;
  }
}

function walk(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

const MAX_FILES = 3;
const MAX_CHARS = 4000;

/** Text files the agent created (not inputs, not the installed skill), formatted for the judge. */
export function collectProducedFiles(sandbox: Sandbox): string {
  const created = walk(sandbox.dir).filter((f) => !f.startsWith('.claude/') && !sandbox.initialFiles.has(f));
  const blocks: string[] = [];
  for (const rel of created.slice(0, MAX_FILES)) {
    const abs = path.join(sandbox.dir, rel);
    if (statSync(abs).size > 200_000) continue;
    const text = readFileSync(abs, 'utf8');
    if (text.includes('\0')) continue;
    blocks.push(`### ${rel}\n\n${text.slice(0, MAX_CHARS)}${text.length > MAX_CHARS ? '\n[truncated]' : ''}`);
  }
  return blocks.join('\n\n');
}
