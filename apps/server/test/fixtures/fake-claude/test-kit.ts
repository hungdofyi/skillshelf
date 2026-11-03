/** Shared helpers for tests that run the server services against the fake claude binary. */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BookManifest, Job } from '@b2s/shared';
import { createAppContext, type AppContext } from '../../../src/app-context.js';
import { clearClaudeStatusCache } from '../../../src/claude/claude-status.js';
import { loadConfig } from '../../../src/config.js';

export const FAKE_CLAUDE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'claude.mjs');

export interface TestApp {
  ctx: AppContext;
  root: string;
  /** Lines the fake logged for each print-mode call. */
  calls(): Array<{ argv: string[]; cwd: string; envKeys: string[]; prompt: string }>;
  /** Forget the calls logged so far. */
  resetCalls(): void;
}

/** Fresh library + data dirs in the OS temp dir, a converted demo book, and config.claudeBin = fake. */
export function makeTestApp(): TestApp {
  chmodSync(FAKE_CLAUDE, 0o755);
  clearClaudeStatusCache();
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'b2s-test-')));
  const libraryDir = path.join(root, 'library');
  const log = path.join(root, 'fake-claude.log');
  process.env.FAKE_CLAUDE_LOG = log;
  const ctx = createAppContext(loadConfig({ libraryDir, dataDir: path.join(root, 'data'), claudeBin: FAKE_CLAUDE }));
  addBook(libraryDir, 'demo');
  return {
    ctx,
    root,
    resetCalls: () => writeFileSync(log, ''),
    calls: () => {
      try {
        return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
  };
}

export function addBook(libraryDir: string, slug: string): void {
  const dir = path.join(libraryDir, 'books', slug);
  mkdirSync(path.join(dir, 'markdown'), { recursive: true });
  const manifest: BookManifest = {
    schemaVersion: 1,
    slug,
    title: 'Demo Book',
    authors: ['Ada Author'],
    source: { file: 'source/demo.pdf', format: 'pdf', sha256: 'x', bytes: 1 },
    converter: { engine: 'test', version: '0', ocrPages: 0, convertedAt: new Date().toISOString() },
    chapters: [
      { index: 0, title: 'Intro | basics', file: 'markdown/00-intro.md', level: 1, words: 100 },
      { index: 1, title: 'Activation', file: 'markdown/01-activation.md', level: 1, words: 200 },
    ],
    stats: { words: 300, warnings: [] },
  };
  writeFileSync(path.join(dir, 'book.json'), JSON.stringify(manifest));
  writeFileSync(path.join(dir, 'markdown/00-intro.md'), '# Intro\n');
  writeFileSync(path.join(dir, 'markdown/01-activation.md'), '# Activation\n');
}

export async function waitForJob(ctx: AppContext, id: string, timeoutMs = 20_000): Promise<Job> {
  const start = Date.now();
  for (;;) {
    const job = ctx.jobs.get(id);
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return job;
    if (Date.now() - start > timeoutMs) throw new Error(`Job ${id} did not finish: ${job.status}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
