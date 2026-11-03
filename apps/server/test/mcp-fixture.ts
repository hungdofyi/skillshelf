/** Shared temp-library fixture for the MCP tests (one book, one skill with a reference file). */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const LONG_CHAPTER = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} about retention cohorts and activation. ${'lorem ipsum '.repeat(30)}`).join('\n\n');

export function makeLibrary(): string {
  const lib = mkdtempSync(path.join(tmpdir(), 'b2s-mcp-'));
  const book = path.join(lib, 'books/onboarding-book');
  mkdirSync(path.join(book, 'markdown'), { recursive: true });
  writeFileSync(path.join(book, 'markdown/00-intro.md'), '# Intro\n\nWelcome to zebrafish onboarding.\n');
  writeFileSync(path.join(book, 'markdown/01-long.md'), `# Long\n\n${LONG_CHAPTER}\n`);
  writeFileSync(
    path.join(book, 'book.json'),
    JSON.stringify({
      schemaVersion: 1,
      slug: 'onboarding-book',
      title: 'The Onboarding Book',
      authors: ['A. Author'],
      source: { file: 'source/x.pdf', format: 'pdf', sha256: 'x', bytes: 1 },
      converter: { engine: 't', version: '1', ocrPages: 0, convertedAt: '2026-01-01' },
      chapters: [
        { index: 0, title: 'Intro', file: 'markdown/00-intro.md', level: 1, words: 6 },
        { index: 1, title: 'Long', file: 'markdown/01-long.md', level: 1, words: 1000 },
      ],
      stats: { words: 1006, warnings: [] },
    }),
  );
  const skill = path.join(lib, 'skills/onboarding-audit');
  mkdirSync(path.join(skill, 'references'), { recursive: true });
  writeFileSync(
    path.join(skill, 'SKILL.md'),
    '---\nname: onboarding-audit\ndescription: Audit a SaaS onboarding flow. Use when reviewing activation.\nmetadata:\n  source: onboarding-book\n---\n\n# Onboarding audit\n\nRead references/checklist.md first.\n',
  );
  writeFileSync(path.join(skill, 'references/checklist.md'), '# Checklist\n\nCheck the quokka step.\n');
  writeFileSync(path.join(lib, 'secret.txt'), 'outside skill');
  return lib;
}
