/**
 * Pieces shared by skill generation and revision: tool scoping for the authoring agent,
 * provenance stamping, lint gating and the one-shot lint fix pass.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LintIssue } from '@b2s/shared';
import { type ClaudeEvent, runClaude } from '../claude/claude-runner.js';
import type { AppContext } from '../app-context.js';
import type { JobContext } from '../jobs/job-manager.js';
import { parseFrontmatter, stringifyFrontmatter } from '../library/frontmatter.js';
import { renderPromptFile } from './render-prompt.js';

/**
 * Tools for an agent that edits one skill folder (cwd = library root). `Edit(path)` rules also
 * govern the Write tool, and `Read(path)` rules govern Glob and Grep. Reads are limited to the books
 * and this skill (book text is untrusted, so the agent must not be able to read the rest of the disk);
 * everything else is denied by dontAsk.
 */
export function authoringToolScope(skillName: string) {
  return {
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
    allowedTools: ['Read(books/**)', `Read(skills/${skillName}/**)`, `Edit(skills/${skillName}/**)`],
    disallowedTools: ['Bash', 'WebFetch', 'WebSearch'],
    permissionMode: 'dontAsk' as const,
  };
}

/** Forward claude events into the job log. */
export function logClaudeEvent(job: JobContext) {
  return (event: ClaudeEvent) => job.log(event.message, { level: event.kind === 'tool-error' ? 'warn' : 'info', data: { claude: event.kind, ...event.data } });
}

/** Merge provenance into SKILL.md frontmatter (agent-written metadata is kept unless overridden) and pin `name`. */
export function stampSkillFile(skillDir: string, skillName: string, metadata: Record<string, string>): void {
  const file = path.join(skillDir, 'SKILL.md');
  const parsed = parseFrontmatter<Record<string, unknown>>(readFileSync(file, 'utf8'));
  if (parsed.error) {
    // Rewriting from an empty `data` would drop the description; leave it for the lint fix pass.
    console.warn(`Skipping provenance stamp for ${skillName}: SKILL.md frontmatter does not parse (${parsed.error})`);
    return;
  }
  const existing = parsed.data.metadata;
  const base = typeof existing === 'object' && existing !== null && !Array.isArray(existing) ? (existing as Record<string, unknown>) : {};
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (typeof v === 'string') merged[k] = v;
  Object.assign(merged, metadata);
  const data = { ...parsed.data, name: skillName, metadata: merged };
  writeFileSync(file, stringifyFrontmatter(data, parsed.body));
}

/** Align evals.json `skill_name` with the folder when the file parses; invalid JSON is left for lint to report. */
export function pinEvalSkillName(skillDir: string, skillName: string): void {
  const file = path.join(skillDir, 'evals', 'evals.json');
  if (!existsSync(file)) return;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { skill_name?: string };
    if (parsed && typeof parsed === 'object' && parsed.skill_name !== skillName) {
      writeFileSync(file, JSON.stringify({ ...parsed, skill_name: skillName }, null, 2) + '\n');
    }
  } catch {
    // Reported by lint.
  }
}

export function lintErrors(ctx: AppContext, skillName: string): LintIssue[] {
  if (!ctx.skills.exists(skillName)) return [{ level: 'error', code: 'skill-missing', message: 'SKILL.md was not written.', file: 'SKILL.md' }];
  return ctx.skills.read(skillName).summary.lint.filter((i) => i.level === 'error');
}

function describeIssues(issues: LintIssue[]): string {
  return issues.map((i) => `- ${i.code}${i.file ? ` (${i.file})` : ''}: ${i.message}`).join('\n');
}

export interface FinalizeOptions {
  ctx: AppContext;
  job: JobContext;
  skillName: string;
  model: string;
  /** Provenance to stamp; re-applied after a lint fix pass. */
  metadata: Record<string, string>;
}

/**
 * Stamp provenance, lint, and when errors exist run one fix pass with the agent, then lint again.
 * Throws with the remaining errors when the skill still fails.
 */
export async function finalizeSkill({ ctx, job, skillName, model, metadata }: FinalizeOptions): Promise<void> {
  const skillDir = ctx.skills.skillDir(skillName);
  const settle = () => {
    if (!existsSync(path.join(skillDir, 'SKILL.md'))) return;
    stampSkillFile(skillDir, skillName, metadata);
    pinEvalSkillName(skillDir, skillName);
  };
  settle();
  let errors = lintErrors(ctx, skillName);
  if (errors.length > 0) {
    job.log(`Lint found ${errors.length} error(s); running one fix pass`, { level: 'warn', data: { lint: errors.map((e) => e.code) } });
    const prompt = renderPromptFile(ctx.config.promptsDir, 'fix-skill-lint.md', {
      skill_name: skillName,
      output_dir: `skills/${skillName}/`,
      lint_errors: describeIssues(errors),
    });
    const result = await runClaude(ctx.config, {
      cwd: ctx.config.libraryDir,
      prompt,
      model,
      ...authoringToolScope(skillName),
      signal: job.signal,
      onEvent: logClaudeEvent(job),
    });
    if (result.isError) job.log(`Fix pass reported an error: ${result.text.slice(0, 300)}`, { level: 'warn' });
    settle();
    errors = lintErrors(ctx, skillName);
  }
  if (errors.length > 0) throw new Error(`Skill still fails lint: ${errors.map((e) => `${e.code}: ${e.message}`).join(' | ')}`);
  const warnings = ctx.skills.read(skillName).summary.lint.filter((i) => i.level === 'warning');
  if (warnings.length) job.log(`Lint warnings: ${warnings.map((w) => w.code).join(', ')}`, { level: 'warn' });
}
