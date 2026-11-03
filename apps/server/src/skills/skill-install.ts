/**
 * Install a library skill into Claude Code by symlinking skills/<name> into a skills folder:
 *  - user:    <CLAUDE_CONFIG_DIR or ~/.claude>/skills/<name>
 *  - project: <projectDir>/.claude/skills/<name>
 * Installs are tracked in <dataDir>/installs.json; only symlinks pointing at our skill folder are ever removed.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InstallSkillResponse, InstallTarget, SkillSummary } from '@b2s/shared';
import { HttpError } from '../http-error.js';

type InstallRecord = NonNullable<SkillSummary['installs']>[number];
type InstallsFile = Record<string, InstallRecord[]>;

const installsFile = (dataDir: string) => path.join(dataDir, 'installs.json');

function readAll(dataDir: string): InstallsFile {
  try {
    return JSON.parse(readFileSync(installsFile(dataDir), 'utf8')) as InstallsFile;
  } catch {
    return {};
  }
}

function writeAll(dataDir: string, data: InstallsFile): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(installsFile(dataDir), JSON.stringify(data, null, 2) + '\n');
}

/** True when linkPath is a symlink that resolves to skillDir. */
function isOurLink(linkPath: string, skillDir: string): boolean {
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return false;
    return path.resolve(path.dirname(linkPath), readlinkSync(linkPath)) === path.resolve(skillDir);
  } catch {
    return false;
  }
}

/** Recorded installs of a skill, dropping (and persisting the removal of) links that no longer exist or point elsewhere. */
export function listInstalls(dataDir: string, name: string, skillDir: string): InstallRecord[] {
  const all = readAll(dataDir);
  const records = all[name] ?? [];
  const alive = records.filter((r) => isOurLink(r.linkPath, skillDir));
  if (alive.length !== records.length) {
    if (alive.length) all[name] = alive;
    else delete all[name];
    writeAll(dataDir, all);
  }
  return alive;
}

export interface InstallOptions {
  dataDir: string;
  name: string;
  /** Absolute skill folder inside the library. */
  skillDir: string;
  target: InstallTarget;
  projectDir?: string;
  /** Defaults to process.env; tests pass their own HOME / CLAUDE_CONFIG_DIR. */
  env?: NodeJS.ProcessEnv;
}

function userSkillsDir(env: NodeJS.ProcessEnv): string {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude'), 'skills');
}

export function installSkill(opts: InstallOptions): InstallSkillResponse {
  const env = opts.env ?? process.env;
  let skillsDir: string;
  if (opts.target === 'user') skillsDir = userSkillsDir(env);
  else {
    const dir = opts.projectDir;
    if (!dir || !path.isAbsolute(dir)) throw new HttpError(400, 'projectDir must be an absolute path');
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new HttpError(400, `Project directory does not exist: ${dir}`);
    skillsDir = path.join(dir, '.claude', 'skills');
  }
  const linkPath = path.join(skillsDir, opts.name);
  let present = false;
  try {
    lstatSync(linkPath);
    present = true;
  } catch {
    present = false;
  }
  if (present && !isOurLink(linkPath, opts.skillDir)) throw new HttpError(409, `${linkPath} already exists and is not a link to this skill; remove it first.`);
  if (!present) {
    mkdirSync(skillsDir, { recursive: true });
    symlinkSync(path.resolve(opts.skillDir), linkPath, 'dir');
  }
  const all = readAll(opts.dataDir);
  const records = (all[opts.name] ?? []).filter((r) => r.linkPath !== linkPath);
  records.push({ target: opts.target, linkPath });
  all[opts.name] = records;
  writeAll(opts.dataDir, all);
  return { linkPath, target: opts.target };
}

/** Remove our symlink(s) for the target (all projects when projectDir is omitted). Returns removed link paths. */
export function uninstallSkill(opts: Omit<InstallOptions, 'env'> & { env?: NodeJS.ProcessEnv }): string[] {
  const all = readAll(opts.dataDir);
  const records = all[opts.name] ?? [];
  const removed: string[] = [];
  const keep: InstallRecord[] = [];
  for (const r of records) {
    const matches = r.target === opts.target && (!opts.projectDir || r.linkPath.startsWith(path.join(opts.projectDir, '.claude', 'skills') + path.sep));
    if (!matches) {
      keep.push(r);
      continue;
    }
    if (isOurLink(r.linkPath, opts.skillDir)) rmSync(r.linkPath);
    removed.push(r.linkPath);
  }
  if (removed.length === 0) throw new HttpError(404, `Skill "${opts.name}" is not installed for target "${opts.target}"`);
  if (keep.length) all[opts.name] = keep;
  else delete all[opts.name];
  writeAll(opts.dataDir, all);
  return removed;
}

