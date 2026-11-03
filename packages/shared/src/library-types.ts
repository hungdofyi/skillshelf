/**
 * Shapes of the files that live in the library folder (LIBRARY_DIR).
 *
 * library/
 *   books/<book-slug>/source/<original.pdf|epub>   original upload (gitignored)
 *   books/<book-slug>/book.json                     BookManifest, written by the Python converter
 *   books/<book-slug>/markdown/NN-<chapter>.md      one Markdown file per chapter
 *   books/<book-slug>/summaries/*.md                generated summaries (frontmatter + chapter links)
 *   skills/<skill-name>/SKILL.md                    Agent Skill entry point (YAML frontmatter + body)
 *   skills/<skill-name>/references/*.md             detail files loaded on demand
 *   skills/<skill-name>/evals/evals.json            EvalFile
 *   evals/<skill-name>/<run-id>/run.json            EvalRun (results of one eval run)
 */

import type { Effort } from './api-types.js';

export const BOOK_MANIFEST_SCHEMA_VERSION = 1 as const;

export type BookFormat = 'pdf' | 'epub';

export interface BookChapter {
  /** 0-based position in reading order. */
  index: number;
  title: string;
  /** Path relative to the book folder, e.g. "markdown/03-why-onboarding-fails.md". */
  file: string;
  /** Heading depth in the source TOC (1 = top level). */
  level: number;
  /** Inclusive 1-based PDF page range; absent for EPUB. */
  pages?: [number, number];
  words: number;
}

export interface BookManifest {
  schemaVersion: typeof BOOK_MANIFEST_SCHEMA_VERSION;
  slug: string;
  title: string;
  authors: string[];
  language?: string;
  source: {
    /** Path relative to the book folder, e.g. "source/onboarding.pdf". */
    file: string;
    format: BookFormat;
    sha256: string;
    bytes: number;
    pages?: number;
  };
  converter: {
    engine: string;
    version: string;
    ocrPages: number;
    convertedAt: string;
  };
  chapters: BookChapter[];
  stats: {
    words: number;
    warnings: string[];
  };
}

/**
 * One progress event printed by the converter CLI as a JSON line on stdout.
 * `book-convert <input> --out <book-dir>` prints these, then exits 0 on success.
 */
export type ConverterEvent =
  | { type: 'progress'; stage: 'open' | 'extract' | 'ocr' | 'split' | 'write'; current?: number; total?: number; message?: string }
  | { type: 'warning'; message: string }
  | { type: 'done'; manifest: string }
  | { type: 'error'; message: string };

/** Frontmatter of SKILL.md, per the Agent Skills spec. Unknown keys are preserved. */
export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  /** Environment requirements, max 500 chars. */
  compatibility?: string;
  /** Space-separated tool list (experimental in the spec). */
  'allowed-tools'?: string;
  /** Spec allows a string->string map; skillshelf records provenance here. */
  metadata?: {
    source?: string;
    goal?: string;
    generator?: string;
    'generated-at'?: string;
    model?: string;
    [key: string]: string | undefined;
  };
  [key: string]: unknown;
}

export type LintLevel = 'error' | 'warning' | 'info';

export interface LintIssue {
  level: LintLevel;
  code: string;
  message: string;
  /** Path relative to the skill folder, when the issue is about one file. */
  file?: string;
}

export interface SkillSummary {
  name: string;
  /** Path relative to LIBRARY_DIR, e.g. "skills/onboarding-audit". */
  path: string;
  description: string;
  frontmatter: SkillFrontmatter;
  /** Paths relative to the skill folder. */
  files: string[];
  bodyLines: number;
  evalCount: number;
  lint: LintIssue[];
  /** Where this skill is symlinked for Claude Code (tracked in .data/installs.json). */
  installs?: Array<{ target: 'user' | 'project'; linkPath: string }>;
  /** Summary of the latest finished eval run, if any run exists. */
  latestRun?: { id: string; finishedAt?: string; summary: Partial<Record<EvalArm, EvalArmSummary>> };
}

/** One generated summary under books/<slug>/summaries/, described by its frontmatter. */
export interface BookSummaryFile {
  /** Library-relative path, e.g. "books/x/summaries/20261103-1500-standard-both.md". */
  path: string;
  title: string;
  /** From frontmatter `generated-at`, else the file's mtime. */
  createdAt?: string;
  settings?: { length?: string; structure?: string; focus?: string };
}

export interface BookSummary {
  slug: string;
  path: string;
  manifest?: BookManifest;
  /** Set while the book has a source file but no manifest yet. */
  status: 'converted' | 'pending' | 'failed';
  sourceFile?: string;
  /** Generated summaries, newest first. */
  summaries?: BookSummaryFile[];
}

/** Skill-creator compatible eval file: skills/<name>/evals/evals.json */
export interface EvalCase {
  id: string | number;
  prompt: string;
  /** Human-readable description of a good answer. */
  expected_output?: string;
  /** Checkable statements the grader marks pass/fail. */
  expectations: string[];
  /** Files (relative to the skill folder) copied into the sandbox before the run. */
  files?: string[];
  /** false = a near-miss prompt where the skill should NOT be used. Default true. */
  should_trigger?: boolean;
}

export interface EvalFile {
  skill_name: string;
  evals: EvalCase[];
}

export type EvalArm = 'with_skill' | 'baseline';

export interface ExpectationResult {
  text: string;
  passed: boolean;
  evidence: string;
}

export interface EvalCaseArmResult {
  caseId: string;
  arm: EvalArm;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  /** Did the agent invoke the Skill tool for this skill? Only meaningful for with_skill. */
  triggered?: boolean;
  expectations: ExpectationResult[];
  /** Fraction of expectations passed, 0..1. */
  score: number;
  /** Paths relative to the run folder. */
  answerFile?: string;
  transcriptFile?: string;
  durationMs?: number;
  numTurns?: number;
  error?: string;
  judgeSummary?: string;
}

/** A count out of a total, e.g. 34 of 44 checks. */
export interface Tally {
  passed: number;
  total: number;
}

/**
 * Per-arm results. `cases`, `passRate`, `meanScore` and `checks` count only graded should-trigger cases,
 * so with_skill and baseline compare the same set; near-miss cases count only in the trigger numbers.
 */
export interface EvalArmSummary {
  cases: number;
  /** Share of cases where every expectation passed. Strict: one missed check fails the case. */
  passRate: number;
  meanScore: number;
  /** Expectations ("checks") passed out of those graded. */
  checks: Tally;
  /** with_skill only: share of all cases where triggering was right (fired on should_trigger, stayed quiet on near-miss). */
  triggerAccuracy?: number;
  /** with_skill only: should-trigger cases where the skill was used. */
  usedWhenNeeded?: Tally;
  /** with_skill only: near-miss cases where the skill was left alone. */
  skippedWhenNotNeeded?: Tally;
  /** with_skill only, when the baseline ran: cases where the skill's answer scored higher, the same or lower. */
  vsBaseline?: { better: number; tied: number; worse: number };
  meanDurationMs?: number;
}

export interface EvalRun {
  id: string;
  skill: string;
  /** sha256 over the skill folder at run time, to tell which version was tested. */
  skillHash: string;
  model: string;
  judgeModel: string;
  /** Effort of the agent arms and of the judge (always low); absent on runs made before the setting existed. */
  effort?: Effort;
  judgeEffort?: Effort;
  arms: EvalArm[];
  caseIds: string[];
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  results: EvalCaseArmResult[];
  summary: Partial<Record<EvalArm, EvalArmSummary>>;
}
