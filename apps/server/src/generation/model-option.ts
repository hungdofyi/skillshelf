import { HttpError } from '../http-error.js';
import { assertSafeModel } from '../claude/claude-runner.js';

/** Validate a user-supplied model alias at the HTTP boundary (it ends up as a CLI argument). */
export function resolveModel(requested: string | undefined, fallback: string): string {
  const model = requested?.trim() || fallback;
  try {
    assertSafeModel(model);
  } catch {
    throw new HttpError(400, `Invalid model name: ${model}`);
  }
  return model;
}
