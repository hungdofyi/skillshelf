/** Book information formatted for prompts and skill provenance. */
import type { BookManifest } from '@b2s/shared';

export interface BookSelection {
  slug: string;
  manifest: BookManifest;
  /** Chapter indexes to include; all when undefined. */
  chapters?: number[];
}

/** One block per book: title, authors, manifest path and a Markdown chapter table (paths relative to the library). */
export function renderBooksSection(selection: BookSelection[]): string {
  return selection
    .map(({ slug, manifest, chapters }) => {
      const wanted = chapters ? new Set(chapters) : undefined;
      const rows = manifest.chapters
        .filter((c) => !wanted || wanted.has(c.index))
        .map((c) => `| ${c.index} | ${c.title.replace(/\|/g, '/')} | books/${slug}/${c.file} | ${c.words} |`);
      const authors = manifest.authors.length ? manifest.authors.join(', ') : 'unknown author';
      return [
        `### ${manifest.title} (${authors})`,
        `Slug: \`${slug}\` · manifest: \`books/${slug}/book.json\` · ${manifest.stats.words} words total${wanted ? ` · limited to ${rows.length} chapters chosen by the user` : ''}`,
        '',
        '| Ch | Title | File | Words |',
        '| --- | --- | --- | --- |',
        ...rows,
      ].join('\n');
    })
    .join('\n\n');
}

/** "Title — Author; Title 2 — Author 2" for metadata.source. */
export function formatSource(manifests: BookManifest[]): string {
  return manifests.map((m) => (m.authors.length ? `${m.title} — ${m.authors.join(', ')}` : m.title)).join('; ');
}
