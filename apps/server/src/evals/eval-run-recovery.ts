/**
 * run.json is written with status "running" before its job starts. If the server stops (or the job
 * dies) before the final write, the record would claim a live run forever, so at startup every
 * "running" record whose evals/<skill> target has no queued or running job is marked failed.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EvalRun } from '@b2s/shared';

export function failOrphanedEvalRuns(libraryDir: string, isBusy: (target: string) => boolean): string[] {
  const root = path.join(libraryDir, 'evals');
  if (!existsSync(root)) return [];
  const fixed: string[] = [];
  for (const skill of readdirSync(root, { withFileTypes: true })) {
    if (!skill.isDirectory() || isBusy(`evals/${skill.name}`)) continue;
    for (const run of readdirSync(path.join(root, skill.name), { withFileTypes: true })) {
      if (!run.isDirectory()) continue;
      const file = path.join(root, skill.name, run.name, 'run.json');
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as EvalRun;
        if (data.status !== 'running') continue;
        data.status = 'failed';
        data.finishedAt ??= new Date().toISOString();
        writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
        fixed.push(`${skill.name}/${run.name}`);
      } catch {
        // Missing or unreadable run.json: leave it for the UI to report.
      }
    }
  }
  return fixed;
}
