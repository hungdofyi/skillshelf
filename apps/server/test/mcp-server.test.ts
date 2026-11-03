import { rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBookSkillsMcpServer } from '../src/mcp/create-book-skills-mcp-server.js';
import { SearchIndex } from '../src/mcp/search-index.js';
import { BookStore } from '../src/library/book-store.js';
import { SkillStore } from '../src/skills/skill-store.js';
import { makeLibrary } from './mcp-fixture.js';

let lib: string;
let client: Client;

type Result = { isError?: boolean; content: Array<{ type: string; text: string }>; structuredContent?: Record<string, any> };
const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result;

beforeAll(async () => {
  lib = makeLibrary();
  const books = new BookStore(lib);
  const skills = new SkillStore(lib);
  const server = createBookSkillsMcpServer({ books, skills, searchIndex: new SearchIndex(books, skills, lib, 'http://localhost:5317') });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
});
afterAll(async () => {
  await client.close();
  rmSync(lib, { recursive: true, force: true });
});

describe('skillshelf MCP server', () => {
  it('exposes instructions and read-only annotated tools', async () => {
    expect(client.getInstructions()).toContain('list_skills');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['fetch', 'get_book_outline', 'list_books', 'list_skills', 'load_skill', 'read_chapter', 'read_skill_file', 'search'].sort(),
    );
    for (const t of tools) {
      expect(t.title).toBeTruthy();
      expect(t.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    }
  });

  it('list_skills / load_skill / read_skill_file happy path', async () => {
    const list = await call('list_skills');
    expect(list.structuredContent!.skills[0]).toMatchObject({ name: 'onboarding-audit', source_books: 'onboarding-book' });
    const loaded = await call('load_skill', { name: 'onboarding-audit' });
    expect(loaded.content[0]!.text).toContain('# Onboarding audit');
    expect(loaded.content[0]!.text).toContain('references/checklist.md');
    const file = await call('read_skill_file', { name: 'onboarding-audit', path: 'references/checklist.md' });
    expect(file.content[0]!.text).toContain('quokka');
  });

  it('errors: unknown skill, path escape, bad name', async () => {
    expect((await call('load_skill', { name: 'nope' })).isError).toBe(true);
    for (const p of ['../../secret.txt', '../../../secret.txt', '/etc/passwd', 'references/../../../secret.txt']) {
      const r = await call('read_skill_file', { name: 'onboarding-audit', path: p });
      expect(r.isError, p).toBe(true);
      expect(r.content[0]!.text).not.toContain('outside skill');
    }
    expect((await call('read_skill_file', { name: '..', path: 'SKILL.md' })).isError).toBe(true);
    expect((await call('read_skill_file', { name: 'onboarding-audit', path: 'missing.md' })).isError).toBe(true);
  });

  it('books: list, outline, paged chapter reads', async () => {
    expect((await call('list_books')).structuredContent!.books[0]).toMatchObject({ slug: 'onboarding-book', chapters: 2 });
    const outline = await call('get_book_outline', { slug: 'onboarding-book' });
    expect(outline.structuredContent!.chapters).toEqual([
      { index: 0, title: 'Intro', words: 6 },
      { index: 1, title: 'Long', words: 1000 },
    ]);
    const first = await call('read_chapter', { slug: 'onboarding-book', chapter: 1, max_chars: 1000 });
    expect(first.structuredContent!.next_offset).toBe(1000);
    const second = await call('read_chapter', { slug: 'onboarding-book', chapter: 1, offset: 1000, max_chars: 1000 });
    expect(second.structuredContent!.offset).toBe(1000);
    const full = await call('read_chapter', { slug: 'onboarding-book', chapter: 1, max_chars: 100000 });
    expect(full.structuredContent!.next_offset).toBeUndefined();
    expect((await call('read_chapter', { slug: 'onboarding-book', chapter: 9 })).isError).toBe(true);
    expect((await call('get_book_outline', { slug: 'missing' })).isError).toBe(true);
  });

  it('search returns the exact OpenAI shape with absolute urls', async () => {
    const r = await call('search', { query: 'zebrafish' });
    expect(Object.keys(r.structuredContent!)).toEqual(['results']);
    expect(JSON.parse(r.content[0]!.text)).toEqual(r.structuredContent);
    const hit = r.structuredContent!.results[0];
    expect(hit.id).toBe('chapter:onboarding-book/0');
    expect(Object.keys(hit).sort()).toEqual(['id', 'title', 'url']);
    expect(hit.url).toBe(`http://localhost:5317/?path=${encodeURIComponent('books/onboarding-book/markdown/00-intro.md')}`);
    expect((await call('search', { query: 'quokka' })).structuredContent!.results[0].id).toBe('skill-file:onboarding-audit/references/checklist.md');
    expect((await call('search', { query: 'onboardin' })).structuredContent!.results.map((x: any) => x.id)).toContain('skill:onboarding-audit');
    expect((await call('search', { query: '   ' })).structuredContent!.results).toEqual([]);
  });

  it('search chunks long chapters and fetch resolves every id kind', async () => {
    const r = await call('search', { query: 'retention cohorts' });
    const chunkHit = r.structuredContent!.results.find((x: any) => x.id.startsWith('chapter:onboarding-book/1#'));
    expect(chunkHit).toBeTruthy();
    const f = await call('fetch', { id: chunkHit.id });
    expect(JSON.parse(f.content[0]!.text)).toEqual(f.structuredContent);
    expect(f.structuredContent).toMatchObject({ id: chunkHit.id, url: chunkHit.url });
    expect(f.structuredContent!.text.length).toBeLessThan(5000);
    expect(f.structuredContent!.text).toContain('retention');
    expect((await call('fetch', { id: 'chapter:onboarding-book/1' })).structuredContent!.text.length).toBeGreaterThan(10000);
    expect((await call('fetch', { id: 'skill:onboarding-audit' })).structuredContent!.text).toContain('# Onboarding audit');
    expect((await call('fetch', { id: 'skill-file:onboarding-audit/references/checklist.md' })).structuredContent!.text).toContain('quokka');
    expect((await call('fetch', { id: 'bogus' })).isError).toBe(true);
    expect((await call('fetch', { id: 'chapter:onboarding-book/1#999' })).isError).toBe(true);
    expect((await call('fetch', { id: 'skill-file:onboarding-audit/../../secret.txt' })).isError).toBe(true);
  });

  it('prompt use_skill returns SKILL.md in a user message', async () => {
    const p = await client.getPrompt({ name: 'use_skill', arguments: { name: 'onboarding-audit' } });
    expect(p.messages[0]!.role).toBe('user');
    expect((p.messages[0]!.content as { text: string }).text).toContain('# Onboarding audit');
  });
});
