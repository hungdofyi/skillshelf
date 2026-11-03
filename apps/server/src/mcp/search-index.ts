/**
 * Full-text index (MiniSearch) over skills, skill reference files and book chapter chunks, backing the
 * ChatGPT-style `search` tool. Rebuilt lazily when a cheap fingerprint of skills/ and books/ changes.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import MiniSearch from 'minisearch';
import type { BookStore } from '../library/book-store.js';
import { resolveLibraryPath } from '../library/library-paths.js';
import { listFilesRecursive } from '../skills/skill-store.js';
import type { SkillStore } from '../skills/skill-store.js';
import { chunkSuffix, chunkText } from './mcp-text-utils.js';

export interface SearchHit {
  id: string;
  title: string;
  url: string;
}

interface IndexDoc extends SearchHit {
  text: string;
}

const MAX_RESULTS = 10;
const TEXT_FILE = /\.(md|markdown|txt)$/i;

export class SearchIndex {
  private index: MiniSearch<IndexDoc> | undefined;
  private fingerprint = '';

  constructor(
    private readonly books: BookStore,
    private readonly skills: SkillStore,
    private readonly libraryDir: string,
    private readonly publicWebUrl: string,
  ) {}

  /** Absolute, user-openable link into the web UI for a library-relative path. */
  urlFor(libraryPath: string): string {
    return `${this.publicWebUrl.replace(/\/+$/, '')}/?path=${encodeURIComponent(libraryPath)}`;
  }

  search(query: string): SearchHit[] {
    const q = query.trim();
    if (!q) return [];
    const index = this.ensureFresh();
    return index
      .search(q, { prefix: true, fuzzy: 0.2, boost: { title: 3 }, combineWith: 'OR' })
      .slice(0, MAX_RESULTS)
      .map((r) => ({ id: r.id as string, title: r.title as string, url: r.url as string }));
  }

  private ensureFresh(): MiniSearch<IndexDoc> {
    const fp = this.computeFingerprint();
    if (!this.index || fp !== this.fingerprint) {
      const index = new MiniSearch<IndexDoc>({
        fields: ['title', 'text'],
        storeFields: ['title', 'url'],
        searchOptions: { prefix: true, fuzzy: 0.2 },
      });
      index.addAll(this.collect());
      this.index = index;
      this.fingerprint = fp;
    }
    return this.index;
  }

  /** mtime+size of every skill file and each book.json: changes whenever content that is indexed changes. */
  private computeFingerprint(): string {
    const parts: string[] = [];
    const skillsDir = this.skills.skillsDir;
    if (existsSync(skillsDir)) {
      for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name.startsWith('.')) continue;
        for (const rel of listFilesRecursive(path.join(skillsDir, d.name))) {
          if (rel.startsWith('evals/')) continue;
          const st = statSync(path.join(skillsDir, d.name, rel));
          parts.push(`${d.name}/${rel}:${st.mtimeMs}:${st.size}`);
        }
      }
    }
    const booksDir = this.books.booksDir;
    if (existsSync(booksDir)) {
      for (const d of readdirSync(booksDir, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name.startsWith('.')) continue;
        const manifest = path.join(booksDir, d.name, 'book.json');
        if (existsSync(manifest)) parts.push(`${d.name}:${statSync(manifest).mtimeMs}`);
      }
    }
    return parts.join('|');
  }

  private collect(): IndexDoc[] {
    const docs: IndexDoc[] = [];
    for (const summary of this.skills.list()) {
      const name = summary.name;
      const skillDoc = this.skills.read(name);
      docs.push({
        id: `skill:${name}`,
        title: `Skill: ${name}`,
        url: this.urlFor(`skills/${name}/SKILL.md`),
        text: `${name} ${summary.description} ${skillDoc.body}`,
      });
      for (const rel of summary.files) {
        if (rel === 'SKILL.md' || rel.startsWith('evals/') || !TEXT_FILE.test(rel)) continue;
        const chunks = chunkText(this.safeRead(() => this.skills.readFile(name, rel)));
        chunks.forEach((text, i) =>
          docs.push({
            id: `skill-file:${name}/${rel}${chunkSuffix(i + 1, chunks.length)}`,
            title: `${name}/${rel}${chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : ''}`,
            url: this.urlFor(`skills/${name}/${rel}`),
            text,
          }),
        );
      }
    }
    for (const book of this.books.list()) {
      if (!book.manifest) continue;
      for (const ch of book.manifest.chapters) {
        const chunks = chunkText(
          this.safeRead(() => readFileSync(resolveLibraryPath(this.libraryDir, `books/${book.slug}/${ch.file}`), 'utf8')),
        );
        chunks.forEach((text, i) =>
          docs.push({
            id: `chapter:${book.slug}/${ch.index}${chunkSuffix(i + 1, chunks.length)}`,
            title: `${book.manifest!.title} - ${ch.title}${chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : ''}`,
            url: this.urlFor(`books/${book.slug}/${ch.file}`),
            text,
          }),
        );
      }
    }
    return docs;
  }

  /** A missing/unreadable file must not take the whole index down. */
  private safeRead(read: () => string): string {
    try {
      return read();
    } catch {
      return '';
    }
  }
}
