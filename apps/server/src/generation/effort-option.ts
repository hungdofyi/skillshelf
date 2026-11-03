import { EFFORTS, type Effort } from '@b2s/shared';
import { HttpError } from '../http-error.js';

/** Validate a user-supplied effort level at the HTTP boundary; `fallback` applies when it is omitted. */
export function resolveEffort(requested: Effort | undefined, fallback: Effort): Effort {
  if (requested === undefined) return fallback;
  if ((EFFORTS as readonly string[]).includes(requested)) return requested;
  throw new HttpError(400, `Invalid effort: must be one of ${EFFORTS.join(', ')}`);
}

/** Effort of authoring runs (generate, revise, lint fix) and of the grading judge. */
export const AUTHORING_EFFORT: Effort = 'high';
export const AGENT_EFFORT: Effort = 'medium';
export const SUMMARY_EFFORT: Effort = 'medium';
export const JUDGE_EFFORT: Effort = 'low';
