/**
 * Read-only access to converted books: library/books/<slug>/{book.json, markdown/*.md, source/*}.
 * Shared by the books routes, the skill generator and the MCP server.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BookChapter, BookManifest, BookSummary } from '@b2s/shared';
import { HttpError } from '../http-error.js';
import { resolveLibraryPath } from './library-paths.js';

export class BookStore {
  constructor(private readonly libraryDir: string) {}

  get booksDir(): string {
    return path.join(this.libraryDir, 'books');
  }

  list(): BookSummary[] {
    if (!existsSync(this.booksDir)) return [];
    return readdirSync(this.booksDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => this.summarize(d.name))
      .sort((a, b) => (a.manifest?.title ?? a.slug).localeCompare(b.manifest?.title ?? b.slug));
  }

  get(slug: string): BookSummary {
    const dir = this.bookDir(slug);
    if (!existsSync(dir)) throw new HttpError(404, `Book not found: ${slug}`);
    return this.summarize(slug);
  }

  /** Absolute folder of a book; validates the slug cannot escape the library. */
  bookDir(slug: string): string {
    if (!slug || slug.includes('/')) throw new HttpError(400, `Invalid book slug: ${slug}`);
    return resolveLibraryPath(this.libraryDir, `books/${slug}`);
  }

  manifest(slug: string): BookManifest {
    const summary = this.get(slug);
    if (!summary.manifest) throw new HttpError(409, `Book "${slug}" has not been converted yet`);
    return summary.manifest;
  }

  chapter(slug: string, index: number): { chapter: BookChapter; content: string } {
    const manifest = this.manifest(slug);
    const chapter = manifest.chapters.find((c) => c.index === index);
    if (!chapter) throw new HttpError(404, `Chapter ${index} not found in "${slug}"`);
    const file = resolveLibraryPath(this.libraryDir, `books/${slug}/${chapter.file}`);
    return { chapter, content: readFileSync(file, 'utf8') };
  }

  private summarize(slug: string): BookSummary {
    const dir = path.join(this.booksDir, slug);
    const manifestFile = path.join(dir, 'book.json');
    const sourceDir = path.join(dir, 'source');
    const sourceFile = existsSync(sourceDir) ? readdirSync(sourceDir).find((f) => /\.(pdf|epub)$/i.test(f)) : undefined;
    const failedMarker = path.join(dir, '.convert-failed');
    let manifest: BookManifest | undefined;
    if (existsSync(manifestFile)) {
      try {
        manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as BookManifest;
      } catch {
        manifest = undefined;
      }
    }
    return {
      slug,
      path: `books/${slug}`,
      manifest,
      status: manifest ? 'converted' : existsSync(failedMarker) ? 'failed' : 'pending',
      sourceFile: sourceFile ? `books/${slug}/source/${sourceFile}` : undefined,
    };
  }
}
