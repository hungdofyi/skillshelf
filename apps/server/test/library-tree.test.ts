import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TreeNode, TreeResponse } from '@b2s/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp, type TestApp } from './fixtures/make-test-app.js';

let t: TestApp;
beforeEach(() => (t = makeTestApp()));
afterEach(() => t.cleanup());

const put = (rel: string, body = 'x') => {
  const abs = path.join(t.libraryDir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, body);
};
const find = (node: TreeNode, p: string): TreeNode | undefined =>
  node.path === p ? node : node.children?.map((c) => find(c, p)).find(Boolean);

describe('GET /api/tree', () => {
  it('assigns kinds, sorts naturally and skips ignored entries', async () => {
    put('books/b1/markdown/10-ten.md');
    put('books/b1/markdown/02-two.md');
    put('books/b1/book.json', '{}');
    put('books/b1/source/b.pdf');
    put('skills/s1/SKILL.md');
    put('skills/s1/references/r.md');
    put('evals/s1/run-1/run.json', '{}');
    put('evals/s1/run-1/sandbox/junk.txt');
    put('notes.md');
    put('node_modules/x/y.js');
    put('.DS_Store');
    put('.git/config');

    const res = await t.app.request('/api/tree');
    expect(res.status).toBe(200);
    const body = (await res.json()) as TreeResponse;
    const root = body.root;
    expect(body.libraryDir).toBe(t.libraryDir);
    expect(body.git).toHaveProperty('isRepo');

    expect(find(root, 'books/b1')?.kind).toBe('book');
    expect(find(root, 'books/b1/markdown/02-two.md')?.kind).toBe('book-chapter');
    expect(find(root, 'books/b1/book.json')?.kind).toBe('json');
    expect(find(root, 'books/b1/source/b.pdf')?.kind).toBe('binary');
    expect(find(root, 'skills/s1')?.kind).toBe('skill');
    expect(find(root, 'skills/s1/references/r.md')?.kind).toBe('skill-file');
    expect(find(root, 'evals/s1/run-1')?.kind).toBe('eval-run');
    expect(find(root, 'notes.md')?.kind).toBe('markdown');
    expect(find(root, 'notes.md')?.size).toBe(1);

    const chapters = find(root, 'books/b1/markdown')!.children!.map((c) => c.name);
    expect(chapters).toEqual(['02-two.md', '10-ten.md']);
    // dirs first at root
    const names = root.children!.map((c) => c.name);
    expect(names.indexOf('notes.md')).toBeGreaterThan(names.indexOf('skills'));

    expect(find(root, 'node_modules')).toBeUndefined();
    expect(find(root, '.DS_Store')).toBeUndefined();
    expect(find(root, '.git')).toBeUndefined();
    expect(find(root, 'evals/s1/run-1/sandbox')).toBeUndefined();
    expect(find(root, 'evals/s1/run-1/run.json')).toBeDefined();
  });
});
