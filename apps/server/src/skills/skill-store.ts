/**
 * Read access to skills: library/skills/<name>/{SKILL.md, references/, evals/evals.json}.
 * Shared by the skills routes, the eval runner and the MCP server.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { type EvalFile, type SkillFrontmatter, type SkillSummary, SKILL_NAME_MAX, SKILL_NAME_PATTERN } from '@b2s/shared';
import { HttpError } from '../http-error.js';
import { readEvalRun } from '../evals/eval-paths.js';
import { parseFrontmatter } from '../library/frontmatter.js';
import { resolveLibraryPath } from '../library/library-paths.js';
import { lintSkill } from './skill-lint.js';

function isValidSkillName(name: string): boolean {
  return name.length <= SKILL_NAME_MAX && SKILL_NAME_PATTERN.test(name);
}

export interface SkillDocument {
  summary: SkillSummary;
  /** Full SKILL.md text including frontmatter. */
  raw: string;
  body: string;
}

export class SkillStore {
  constructor(private readonly libraryDir: string) {}

  get skillsDir(): string {
    return path.join(this.libraryDir, 'skills');
  }

  list(): SkillSummary[] {
    if (!existsSync(this.skillsDir)) return [];
    return readdirSync(this.skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && isValidSkillName(d.name) && existsSync(path.join(this.skillsDir, d.name, 'SKILL.md')))
      .map((d) => this.read(d.name).summary)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  exists(name: string): boolean {
    return isValidSkillName(name) && existsSync(path.join(this.skillDir(name), 'SKILL.md'));
  }

  /** Absolute folder of a skill; validates the name cannot escape the library. */
  skillDir(name: string): string {
    if (!isValidSkillName(name)) throw new HttpError(400, `Invalid skill name: ${name}`);
    return resolveLibraryPath(this.libraryDir, `skills/${name}`);
  }

  read(name: string): SkillDocument {
    const dir = this.skillDir(name);
    const skillFile = path.join(dir, 'SKILL.md');
    if (!existsSync(skillFile)) throw new HttpError(404, `Skill not found: ${name}`);
    const raw = readFileSync(skillFile, 'utf8');
    const parsed = parseFrontmatter<SkillFrontmatter>(raw);
    const files = listFilesRecursive(dir);
    const evalsPath = path.join(dir, 'evals', 'evals.json');
    const evalsJson = existsSync(evalsPath) ? readFileSync(evalsPath, 'utf8') : undefined;
    const lint = lintSkill({
      folderName: name,
      frontmatter: parsed.data,
      frontmatterError: parsed.error,
      hasFrontmatter: parsed.hasFrontmatter,
      body: parsed.body,
      files,
      evalsJson,
    });
    let evalCount = 0;
    try {
      evalCount = evalsJson ? ((JSON.parse(evalsJson) as EvalFile).evals?.length ?? 0) : 0;
    } catch {
      evalCount = 0;
    }
    const summary: SkillSummary = {
      name,
      path: `skills/${name}`,
      description: typeof parsed.data.description === 'string' ? parsed.data.description : '',
      frontmatter: parsed.data,
      files,
      bodyLines: parsed.body.split('\n').length,
      evalCount,
      lint,
      latestRun: this.latestRun(name),
    };
    return { summary, raw, body: parsed.body };
  }

  /** Read one file inside a skill folder (e.g. "references/checklist.md"). */
  readFile(name: string, rel: string): string {
    const abs = resolveLibraryPath(this.libraryDir, `skills/${name}/${rel}`);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new HttpError(404, `File not found in skill "${name}": ${rel}`);
    return readFileSync(abs, 'utf8');
  }

  readEvals(name: string): EvalFile {
    const text = this.readFile(name, 'evals/evals.json');
    try {
      return JSON.parse(text) as EvalFile;
    } catch (err) {
      throw new HttpError(422, `evals.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Stable content hash of the skill folder (excluding evals/), to tie eval runs to a skill version. */
  hash(name: string): string {
    const dir = this.skillDir(name);
    const h = createHash('sha256');
    for (const rel of listFilesRecursive(dir).filter((f) => !f.startsWith('evals/')).sort()) {
      h.update(rel);
      h.update('\0');
      h.update(readFileSync(path.join(dir, rel)));
      h.update('\0');
    }
    return h.digest('hex').slice(0, 16);
  }

  private latestRun(name: string): SkillSummary['latestRun'] {
    const runsDir = path.join(this.libraryDir, 'evals', name);
    if (!existsSync(runsDir)) return undefined;
    const ids = readdirSync(runsDir).filter((d) => existsSync(path.join(runsDir, d, 'run.json'))).sort().reverse();
    for (const id of ids) {
      try {
        const run = readEvalRun(this.libraryDir, name, id);
        if (run.status !== 'succeeded') continue;
        return { id: run.id, finishedAt: run.finishedAt, summary: run.summary };
      } catch {
        continue;
      }
    }
    return undefined;
  }
}

/** All files under dir as POSIX paths relative to dir, skipping dotfiles. */
export function listFilesRecursive(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRecursive(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}
