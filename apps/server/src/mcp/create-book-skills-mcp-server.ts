/**
 * Builds the read-only "skillshelf" MCP server: skills (load + references), converted books
 * (outline + paged chapter reads) and the OpenAI-shaped search/fetch pair. One factory, used by
 * stdio, the stateless HTTP endpoint (a fresh instance per request) and tests.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BOOK_SLUG_PATTERN, SKILL_NAME_PATTERN } from '@b2s/shared';
import { z } from 'zod';
import type { BookStore } from '../library/book-store.js';
import type { SkillStore } from '../skills/skill-store.js';
import { DEFAULT_MAX_CHARS, HARD_MAX_CHARS, chunkText, pageText, type TextPage } from './mcp-text-utils.js';
import type { SearchIndex } from './search-index.js';

export interface BookSkillsMcpDeps {
  books: BookStore;
  skills: SkillStore;
  searchIndex: SearchIndex;
}

const INSTRUCTIONS = [
  'Book-derived skills and their source books, served read-only.',
  'Flow: list_skills -> load_skill { name } -> follow the loaded SKILL.md; fetch its references on demand with read_skill_file.',
  'Books are source material: list_books -> get_book_outline { slug } -> read_chapter { slug, chapter } (paged; continue with next_offset).',
  'search { query } and fetch { id } give ChatGPT-style retrieval across skills, skill files and book chapters.',
].join('\n');

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const paging = {
  offset: z.number().int().min(0).optional().describe('Character offset to start from (use next_offset from a previous call).'),
  max_chars: z
    .number()
    .int()
    .min(1)
    .max(HARD_MAX_CHARS)
    .optional()
    .describe(`Max characters to return (default ${DEFAULT_MAX_CHARS}).`),
};

const text = (value: string, structured?: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text: value }],
  ...(structured ? { structuredContent: structured } : {}),
});

/** Same JSON in structuredContent and in a text block, as the OpenAI search/fetch contract requires. */
const dual = (obj: Record<string, unknown>): CallToolResult => ({
  structuredContent: obj,
  content: [{ type: 'text', text: JSON.stringify(obj) }],
});

const fail = (message: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });

/** Run a tool body, turning any thrown error (HttpError, fs) into an MCP tool error the model can read. */
async function guarded(fn: () => CallToolResult | Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function assertSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name)) throw new Error(`Invalid skill name: ${name}`);
}
function assertBookSlug(slug: string): void {
  if (!BOOK_SLUG_PATTERN.test(slug)) throw new Error(`Invalid book slug: ${slug}`);
}
/** Relative path inside a skill folder; rejects absolute paths and any ".." segment. */
function assertSkillRelPath(rel: string): string {
  const norm = rel.replace(/\\/g, '/').trim();
  if (!norm || norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || norm.includes('\0') || norm.split('/').includes('..')) {
    throw new Error(`Invalid path (must be relative, inside the skill): ${rel}`);
  }
  return norm.replace(/^\.\//, '');
}

function pagedResult(page: TextPage): CallToolResult {
  const note = page.next_offset !== undefined ? `\n\n[truncated: ${page.total_chars} chars total; continue with offset=${page.next_offset}]` : '';
  return text(page.text + note, { ...page });
}

export function createBookSkillsMcpServer(deps: BookSkillsMcpDeps): McpServer {
  const { books, skills, searchIndex } = deps;
  const server = new McpServer({ name: 'skillshelf', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  function skillLoadText(name: string): string {
    const doc = skills.read(name);
    const files = doc.summary.files.filter((f) => f !== 'SKILL.md' && !f.startsWith('evals/'));
    return [
      doc.raw,
      '',
      '---',
      `Files in skill "${name}": ${files.length ? files.join(', ') : '(none)'}`,
      'Follow the instructions above; fetch references on demand with read_skill_file { name, path }.',
    ].join('\n');
  }

  server.registerTool(
    'list_skills',
    {
      title: 'List skills',
      description: 'List available skills with description, source books and latest eval pass rate.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () =>
      guarded(() => {
        const list = skills.list().map((s) => ({
          name: s.name,
          description: s.description,
          source_books: s.frontmatter.metadata?.source ?? null,
          goal: s.frontmatter.metadata?.goal ?? null,
          eval_pass_rate: s.latestRun?.passRate ?? null,
        }));
        return text(JSON.stringify({ skills: list }, null, 2), { skills: list });
      }),
  );

  server.registerTool(
    'load_skill',
    {
      title: 'Load skill',
      description: 'Return the full SKILL.md of a skill plus its file list. Follow it, reading references as needed.',
      inputSchema: { name: z.string().describe('Skill name from list_skills.') },
      annotations: READ_ONLY,
    },
    ({ name }) =>
      guarded(() => {
        assertSkillName(name);
        return text(skillLoadText(name));
      }),
  );

  server.registerTool(
    'read_skill_file',
    {
      title: 'Read skill file',
      description: 'Read a file from a skill folder (e.g. references/ch01.md). Paged.',
      inputSchema: {
        name: z.string().describe('Skill name.'),
        path: z.string().describe('Path relative to the skill folder, e.g. "references/checklist.md".'),
        ...paging,
      },
      annotations: READ_ONLY,
    },
    ({ name, path: rel, offset, max_chars }) =>
      guarded(() => {
        assertSkillName(name);
        const safe = assertSkillRelPath(rel);
        return pagedResult(pageText(skills.readFile(name, safe), offset, max_chars));
      }),
  );

  server.registerTool(
    'list_books',
    {
      title: 'List books',
      description: 'List converted source books with title, authors and chapter count.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () =>
      guarded(() => {
        const list = books
          .list()
          .filter((b) => b.manifest)
          .map((b) => ({
            slug: b.slug,
            title: b.manifest!.title,
            authors: b.manifest!.authors,
            chapters: b.manifest!.chapters.length,
            words: b.manifest!.stats.words,
          }));
        return text(JSON.stringify({ books: list }, null, 2), { books: list });
      }),
  );

  server.registerTool(
    'get_book_outline',
    {
      title: 'Get book outline',
      description: 'List a book\'s chapters (index, title, word count).',
      inputSchema: { slug: z.string().describe('Book slug from list_books.') },
      annotations: READ_ONLY,
    },
    ({ slug }) =>
      guarded(() => {
        assertBookSlug(slug);
        const m = books.manifest(slug);
        const chapters = m.chapters.map((c) => ({ index: c.index, title: c.title, words: c.words }));
        const out = { slug, title: m.title, authors: m.authors, chapters };
        return text(JSON.stringify(out, null, 2), out);
      }),
  );

  server.registerTool(
    'read_chapter',
    {
      title: 'Read chapter',
      description: `Read a chapter as Markdown. Paged (default ${DEFAULT_MAX_CHARS} chars); continue with next_offset.`,
      inputSchema: {
        slug: z.string().describe('Book slug.'),
        chapter: z.number().int().min(0).describe('Chapter index from get_book_outline.'),
        ...paging,
      },
      annotations: READ_ONLY,
    },
    ({ slug, chapter, offset, max_chars }) =>
      guarded(() => {
        assertBookSlug(slug);
        return pagedResult(pageText(books.chapter(slug, chapter).content, offset, max_chars));
      }),
  );

  server.registerTool(
    'search',
    {
      title: 'Search',
      description: 'Search skills, skill references and book chapters. Returns up to 10 results with id, title, url; use fetch for full text.',
      inputSchema: { query: z.string().describe('Search query.') },
      annotations: READ_ONLY,
    },
    ({ query }) => guarded(() => dual({ results: searchIndex.search(query) })),
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch',
      description: 'Fetch the full text of a search result by its id.',
      inputSchema: { id: z.string().describe('Result id from search.') },
      annotations: READ_ONLY,
    },
    ({ id }) => guarded(() => dual(fetchDocument(id))),
  );

  /** Resolve a search id (skill:/skill-file:/chapter:, optional #chunk) to its document. */
  function fetchDocument(id: string): Record<string, unknown> {
    const m = /^(skill|skill-file|chapter):([^#]+)(?:#(\d+))?$/.exec(id);
    if (!m) throw new Error(`Unknown id: ${id}`);
    const [, kind, ref, chunk] = m as unknown as [string, string, string, string | undefined];
    const pick = (full: string): { text: string; part?: string } => {
      if (chunk === undefined) return { text: full };
      const chunks = chunkText(full);
      const n = Number(chunk);
      if (n < 1 || n > chunks.length) throw new Error(`Chunk ${n} out of range (1-${chunks.length}) for ${id}`);
      return { text: chunks[n - 1]!, part: `${n}/${chunks.length}` };
    };
    if (kind === 'skill') {
      assertSkillName(ref);
      const doc = skills.read(ref);
      return { id, title: `Skill: ${ref}`, text: doc.raw, url: searchIndex.urlFor(`skills/${ref}/SKILL.md`), metadata: { type: 'skill', files: doc.summary.files } };
    }
    if (kind === 'skill-file') {
      const slash = ref.indexOf('/');
      if (slash < 1) throw new Error(`Unknown id: ${id}`);
      const name = ref.slice(0, slash);
      assertSkillName(name);
      const rel = assertSkillRelPath(ref.slice(slash + 1));
      const picked = pick(skills.readFile(name, rel));
      return { id, title: `${name}/${rel}`, text: picked.text, url: searchIndex.urlFor(`skills/${name}/${rel}`), metadata: { type: 'skill-file', part: picked.part } };
    }
    const slash = ref.indexOf('/');
    const slug = ref.slice(0, slash);
    const index = Number(ref.slice(slash + 1));
    if (slash < 1 || !Number.isInteger(index)) throw new Error(`Unknown id: ${id}`);
    assertBookSlug(slug);
    const { chapter, content } = books.chapter(slug, index);
    const picked = pick(content);
    return {
      id,
      title: `${books.manifest(slug).title} - ${chapter.title}`,
      text: picked.text,
      url: searchIndex.urlFor(`books/${slug}/${chapter.file}`),
      metadata: { type: 'chapter', book: slug, chapter: index, part: picked.part },
    };
  }

  server.registerPrompt(
    'use_skill',
    {
      title: 'Use skill',
      description: 'Load a skill and follow it for the current task.',
      argsSchema: { name: z.string().describe('Skill name from list_skills.') },
    },
    ({ name }) => {
      assertSkillName(name);
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Use the "${name}" skill for my task. Follow its instructions; load referenced files with read_skill_file { name: "${name}", path } as needed.\n\n${skillLoadText(name)}`,
            },
          },
        ],
      };
    },
  );

  return server;
}

/** Tool names + descriptions for the connect panel (McpInfo.tools). */
export const MCP_TOOL_SUMMARY: Array<{ name: string; description: string }> = [
  { name: 'list_skills', description: 'List available skills with source books and eval pass rate.' },
  { name: 'load_skill', description: 'Return the full SKILL.md of a skill plus its file list.' },
  { name: 'read_skill_file', description: 'Read a file from a skill folder (paged).' },
  { name: 'list_books', description: 'List converted source books.' },
  { name: 'get_book_outline', description: 'List a book\'s chapters with word counts.' },
  { name: 'read_chapter', description: 'Read a chapter as Markdown (paged).' },
  { name: 'search', description: 'Search skills, references and chapters (ChatGPT-shaped).' },
  { name: 'fetch', description: 'Fetch full text of a search result by id (ChatGPT-shaped).' },
];
