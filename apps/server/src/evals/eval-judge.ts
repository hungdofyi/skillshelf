/** LLM-as-judge: grades one answer against its expectations with a tool-less Claude call. */
import type { Effort, ExpectationResult } from '@b2s/shared';
import { type ClaudeEvent, runClaude } from '../claude/claude-runner.js';
import { renderPromptFile } from '../generation/render-prompt.js';

export const JUDGE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    expectations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, passed: { type: 'boolean' }, evidence: { type: 'string' } },
        required: ['text', 'passed', 'evidence'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['expectations', 'summary'],
});

export interface Verdict {
  expectations: ExpectationResult[];
  summary: string;
}

/** First balanced top-level JSON object in free text (the judge may wrap it in prose or a fence). */
export function extractFirstJsonObject(text: string): unknown {
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

/** Validate raw judge output and align it to the expectations by position (or exact text). Undefined when unusable. */
export function parseVerdict(structured: unknown, text: string, expectations: string[]): Verdict | undefined {
  const raw = (structured && typeof structured === 'object' ? structured : extractFirstJsonObject(text)) as { expectations?: unknown; summary?: unknown } | undefined;
  if (!raw || !Array.isArray(raw.expectations)) return undefined;
  const items = raw.expectations.filter((e): e is { text?: unknown; passed?: unknown; evidence?: unknown } => typeof e === 'object' && e !== null);
  if (items.length === 0 && expectations.length > 0) return undefined;
  const aligned = expectations.map((expectation, i): ExpectationResult => {
    const item = items[i]?.text === expectation ? items[i] : (items.find((e) => e.text === expectation) ?? items[i]);
    if (!item) return { text: expectation, passed: false, evidence: 'not graded' };
    return { text: expectation, passed: item.passed === true, evidence: typeof item.evidence === 'string' ? item.evidence : '' };
  });
  return { expectations: aligned, summary: typeof raw.summary === 'string' ? raw.summary : '' };
}

export interface GradeInput {
  config: { claudeBin: string };
  promptsDir: string;
  cwd: string;
  model: string;
  /** Judge effort; callers pass the fixed JUDGE_EFFORT. */
  effort: Effort;
  prompt: string;
  expectedOutput?: string;
  answer: string;
  filesProduced?: string;
  expectations: string[];
  signal?: AbortSignal;
  transcriptFile?: string;
  onEvent?: (event: ClaudeEvent) => void;
}

/** One retry when the judge returns something unparsable. Throws when both attempts fail. */
export async function gradeAnswer(input: GradeInput): Promise<Verdict> {
  const prompt = renderPromptFile(input.promptsDir, 'grade-answer.md', {
    prompt: input.prompt,
    expected_output: input.expectedOutput,
    answer: input.answer.trim() || '(empty answer)',
    files_produced: input.filesProduced,
    expectations_json: JSON.stringify(input.expectations, null, 2),
  });
  let lastProblem = 'judge returned no usable verdict';
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runClaude(input.config, {
      cwd: input.cwd,
      prompt,
      model: input.model,
      effort: input.effort,
      tools: [],
      jsonSchema: JUDGE_SCHEMA,
      permissionMode: 'dontAsk',
      signal: input.signal,
      transcriptFile: input.transcriptFile,
      onEvent: input.onEvent,
    });
    if (result.isError) {
      lastProblem = `judge error: ${result.text.slice(0, 300)}`;
      continue;
    }
    const verdict = parseVerdict(result.structured, result.text, input.expectations);
    if (verdict) return verdict;
    lastProblem = `judge output was not valid verdict JSON: ${result.text.slice(0, 200)}`;
  }
  throw new Error(lastProblem);
}
