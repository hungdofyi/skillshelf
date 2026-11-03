/**
 * Tiny prompt templating for prompts/*.md:
 *  - `{{#if var}} ... {{/if}}` keeps the block only when var is a non-empty string (no nesting);
 *  - `{{var}}` is replaced by the variable's value. Values are inserted verbatim and never re-expanded.
 * A variable referenced but not supplied is a programming error and throws.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type PromptVars = Record<string, string | undefined>;

export function renderTemplate(template: string, vars: PromptVars): string {
  const withBlocks = template.replace(/\{\{#if (\w+)\}\}\n?([\s\S]*?)\{\{\/if\}\}\n?/g, (_m, name: string, body: string) => (vars[name] ? body : ''));
  return withBlocks.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    if (!(name in vars)) throw new Error(`Prompt template references unknown variable "${name}"`);
    return vars[name] ?? '';
  });
}

export function renderPromptFile(promptsDir: string, file: string, vars: PromptVars): string {
  return renderTemplate(readFileSync(path.join(promptsDir, file), 'utf8'), vars);
}
