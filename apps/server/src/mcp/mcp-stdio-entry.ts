/**
 * stdio MCP entry for Claude Code: `pnpm mcp:stdio`. Builds only the read-only stores (no job manager,
 * watchers or HTTP). stdout carries the JSON-RPC stream, so all diagnostics go to stderr.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.js';
import { BookStore } from '../library/book-store.js';
import { SkillStore } from '../skills/skill-store.js';
import { createBookSkillsMcpServer } from './create-book-skills-mcp-server.js';
import { SearchIndex } from './search-index.js';

// Defensive: stray console.log from any dependency must not corrupt the protocol stream.
console.log = (...args: unknown[]) => console.error(...args);

const config = loadConfig();
const books = new BookStore(config.libraryDir);
const skills = new SkillStore(config.libraryDir);
const searchIndex = new SearchIndex(books, skills, config.libraryDir, config.publicWebUrl);
const server = createBookSkillsMcpServer({ books, skills, searchIndex });

await server.connect(new StdioServerTransport());
console.error(`skillshelf MCP (stdio) ready; library: ${config.libraryDir}`);
