/**
 * Git awareness for the library folder. Fails soft: when git is missing or the library
 * is not inside a work tree, `isRepo` is false and no file statuses are returned.
 */
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitFileStatus } from '@b2s/shared';

const run = promisify(execFile);

export interface GitSnapshot {
  isRepo: boolean;
  branch?: string;
  dirty?: number;
  /** Library-relative POSIX path -> status (files only). */
  files: Map<string, GitFileStatus>;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, timeout: 10_000, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

function mapCode(xy: string): GitFileStatus {
  if (xy === '??') return 'untracked';
  if (xy === '!!') return 'ignored';
  if (xy.includes('R') || xy.includes('C')) return 'renamed';
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('A')) return 'added';
  return 'modified';
}

/** Parse `status --porcelain=v1 -z` output into [XY, path] pairs (rename sources dropped). */
export function parsePorcelainZ(out: string): Array<[string, string]> {
  const parts = out.split('\0');
  const entries: Array<[string, string]> = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part.length < 4) continue;
    const xy = part.slice(0, 2);
    entries.push([xy, part.slice(3)]);
    if (xy.includes('R') || xy.includes('C')) i++; // next token is the original path
  }
  return entries;
}

export async function readGitStatus(libraryDir: string): Promise<GitSnapshot> {
  const empty: GitSnapshot = { isRepo: false, files: new Map() };
  try {
    const realLib = realpathSync(libraryDir);
    const top = (await git(realLib, ['rev-parse', '--show-toplevel'])).trim();
    if (!top) return empty;
    const [statusOut, branchOut] = await Promise.all([
      git(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      git(top, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ''),
    ]);
    const files = new Map<string, GitFileStatus>();
    for (const [xy, p] of parsePorcelainZ(statusOut)) {
      const rel = path.relative(realLib, path.join(top, p)).split(path.sep).join('/');
      if (!rel || rel.startsWith('..')) continue; // outside the library folder
      files.set(rel, mapCode(xy));
    }
    return { isRepo: true, branch: branchOut.trim() || undefined, dirty: files.size, files };
  } catch {
    return empty;
  }
}
