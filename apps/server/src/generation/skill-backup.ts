/** Snapshot of a skill folder before an agent edits it: <dataDir>/skill-backups/<name>/<timestamp>/. */
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function backupSkill(dataDir: string, skillName: string, skillDir: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  let dest = path.join(dataDir, 'skill-backups', skillName, stamp);
  for (let n = 2; ; n++) {
    try {
      mkdirSync(dest, { recursive: false });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        mkdirSync(path.dirname(dest), { recursive: true });
        continue;
      }
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      dest = path.join(dataDir, 'skill-backups', skillName, `${stamp}-${n}`);
    }
  }
  cpSync(skillDir, dest, { recursive: true });
  return dest;
}
