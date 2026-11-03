/**
 * Static checks for a skill folder against the Agent Skills spec plus skillshelf conventions.
 * Pure function over already-read file data so it is cheap to unit test.
 */
import {
  SKILL_BODY_LINES_SOFT_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  SKILL_NAME_PATTERN,
  SKILL_RESERVED_WORDS,
  type EvalFile,
  type LintIssue,
} from '@b2s/shared';

export interface SkillLintInput {
  folderName: string;
  frontmatter: Record<string, unknown>;
  frontmatterError?: string;
  hasFrontmatter: boolean;
  body: string;
  /** Paths relative to the skill folder (POSIX). */
  files: string[];
  /** Raw evals/evals.json text, when present. */
  evalsJson?: string;
}

const XML_TAG = /<\/?[a-zA-Z][\w-]*[^>]*>/;
const KNOWN_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'allowed-tools', 'metadata']);

export function lintSkill(input: SkillLintInput): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (level: LintIssue['level'], code: string, message: string, file = 'SKILL.md') => issues.push({ level, code, message, file });

  if (!input.hasFrontmatter) add('error', 'frontmatter-missing', 'SKILL.md must start with a YAML frontmatter block (---).');
  if (input.frontmatterError) add('error', 'frontmatter-invalid', `Frontmatter is not valid YAML: ${input.frontmatterError}`);

  const fm = input.frontmatter;
  const name = typeof fm.name === 'string' ? fm.name : '';
  const description = typeof fm.description === 'string' ? fm.description : '';

  if (!name) add('error', 'name-missing', 'Frontmatter "name" is required.');
  else {
    if (name.length > SKILL_NAME_MAX) add('error', 'name-too-long', `"name" is ${name.length} chars; max ${SKILL_NAME_MAX}.`);
    if (!SKILL_NAME_PATTERN.test(name)) add('error', 'name-format', '"name" must be lowercase letters, digits and single hyphens.');
    if (SKILL_RESERVED_WORDS.some((w) => name.includes(w))) add('error', 'name-reserved', '"name" must not contain "anthropic" or "claude".');
    if (name !== input.folderName) add('error', 'name-folder-mismatch', `"name" (${name}) must match the folder name (${input.folderName}).`);
  }

  if (!description) add('error', 'description-missing', 'Frontmatter "description" is required.');
  else {
    if (description.length > SKILL_DESCRIPTION_MAX) add('error', 'description-too-long', `"description" is ${description.length} chars; max ${SKILL_DESCRIPTION_MAX}.`);
    if (XML_TAG.test(description)) add('error', 'description-xml', '"description" must not contain XML tags.');
    if (!/\b(use|when|for)\b/i.test(description)) add('warning', 'description-no-trigger', 'Describe when to use the skill (e.g. "Use when…") so the agent knows to load it.');
  }
  if (name && XML_TAG.test(name)) add('error', 'name-xml', '"name" must not contain XML tags.');

  if (typeof fm.compatibility === 'string' && fm.compatibility.length > 500) add('error', 'compatibility-too-long', '"compatibility" max 500 chars.');
  if (fm.metadata !== undefined) {
    const meta = fm.metadata;
    const ok = typeof meta === 'object' && meta !== null && !Array.isArray(meta) && Object.values(meta).every((v) => typeof v === 'string');
    if (!ok) add('error', 'metadata-shape', '"metadata" must be a map of string keys to string values.');
  }
  for (const key of Object.keys(fm)) {
    if (!KNOWN_KEYS.has(key)) add('warning', 'frontmatter-unknown-key', `Unknown frontmatter key "${key}" may be rejected by claude.ai upload.`);
  }

  const bodyLines = input.body.split('\n').length;
  if (bodyLines > SKILL_BODY_LINES_SOFT_MAX) add('warning', 'body-too-long', `Body is ${bodyLines} lines; keep it under ${SKILL_BODY_LINES_SOFT_MAX} and move detail into references/.`);
  if (input.body.trim().length === 0) add('error', 'body-empty', 'SKILL.md body is empty.');

  // Links from SKILL.md to local files must resolve; reference files should be linked.
  const linked = new Set<string>();
  for (const match of input.body.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    const target = match[1]!;
    if (/^[a-z]+:/i.test(target)) continue;
    const clean = target.replace(/^\.\//, '');
    linked.add(clean);
    if (!input.files.includes(clean)) add('error', 'link-broken', `Link to "${target}" does not resolve inside the skill folder.`);
  }
  for (const match of input.body.matchAll(/`((?:references|scripts|assets)\/[^`\s]+)`/g)) linked.add(match[1]!);
  for (const file of input.files) {
    if (file.startsWith('references/') && !linked.has(file)) add('warning', 'reference-orphan', `${file} is never mentioned in SKILL.md, so the agent will not know to read it.`, file);
    if (file.split('/').length > 2 && file.startsWith('references/')) add('warning', 'reference-nested', 'Keep references one level deep (references/<file>.md).', file);
  }

  if (input.evalsJson === undefined) add('info', 'evals-missing', 'No evals/evals.json yet; add test prompts to measure the skill.', 'evals/evals.json');
  else {
    try {
      const parsed = JSON.parse(input.evalsJson) as EvalFile;
      if (!Array.isArray(parsed.evals)) add('error', 'evals-shape', 'evals.json must have an "evals" array.', 'evals/evals.json');
      else {
        if (parsed.evals.length < 3) add('warning', 'evals-few', 'Add at least 3 eval cases.', 'evals/evals.json');
        parsed.evals.forEach((c, i) => {
          if (!c || typeof c.prompt !== 'string' || !c.prompt.trim()) add('error', 'eval-prompt', `Eval #${i + 1} has no prompt.`, 'evals/evals.json');
          if (!Array.isArray(c?.expectations) || (c.should_trigger !== false && c.expectations.length === 0))
            add('warning', 'eval-expectations', `Eval #${i + 1} has no expectations to grade.`, 'evals/evals.json');
        });
        const ids = parsed.evals.map((c) => String(c?.id));
        if (new Set(ids).size !== ids.length) add('error', 'eval-ids', 'Eval ids must be unique.', 'evals/evals.json');
      }
      if (parsed.skill_name && name && parsed.skill_name !== name) add('warning', 'evals-skill-name', `evals.json skill_name "${parsed.skill_name}" differs from "${name}".`, 'evals/evals.json');
    } catch (err) {
      add('error', 'evals-json', `evals.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, 'evals/evals.json');
    }
  }

  return issues;
}
