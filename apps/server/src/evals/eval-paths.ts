/** Locations of eval runs: library/evals/<skill>/<runId>/{run.json, cases/<caseId>/<arm>/{answer.md,transcript.jsonl}}. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type EvalRun, SKILL_NAME_PATTERN } from '@b2s/shared';
import { HttpError } from '../http-error.js';
import { withFreshSummary } from './eval-summary.js';

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function evalSkillDir(libraryDir: string, skill: string): string {
  if (!SKILL_NAME_PATTERN.test(skill)) throw new HttpError(400, `Invalid skill name: ${skill}`);
  return path.join(libraryDir, 'evals', skill);
}

export function evalRunDir(libraryDir: string, skill: string, runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) throw new HttpError(400, `Invalid run id: ${runId}`);
  return path.join(evalSkillDir(libraryDir, skill), runId);
}

export function readEvalRun(libraryDir: string, skill: string, runId: string): EvalRun {
  const file = path.join(evalRunDir(libraryDir, skill, runId), 'run.json');
  if (!existsSync(file)) throw new HttpError(404, `Eval run not found: ${skill}/${runId}`);
  try {
    return withFreshSummary(JSON.parse(readFileSync(file, 'utf8')) as EvalRun);
  } catch {
    throw new HttpError(422, `run.json of ${skill}/${runId} is not valid JSON`);
  }
}

export function writeEvalRun(runDir: string, run: EvalRun): void {
  writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2) + '\n');
}

/** Folder-safe form of an eval case id. */
export function caseDirName(id: string | number): string {
  return String(id).replace(/[^A-Za-z0-9._-]+/g, '_') || '_';
}
