/** Zip of a skill folder in the claude.ai upload layout: <name>/SKILL.md, <name>/references/..., without evals/. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { listFilesRecursive } from './skill-store.js';

export function exportSkillZip(skillDir: string, name: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const rel of listFilesRecursive(skillDir)) {
    if (rel.startsWith('evals/')) continue;
    entries[`${name}/${rel}`] = new Uint8Array(readFileSync(path.join(skillDir, rel)));
  }
  return zipSync(entries, { level: 6 });
}
