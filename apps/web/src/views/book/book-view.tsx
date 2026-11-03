import { ScrollText, Wand2 } from 'lucide-react';
import type { BookSummary } from '@b2s/shared';
import { useBook, useJobs } from '../../api/queries';
import { navigate } from '../../lib/location-state';
import { openCreateSkill, openJob, useUi } from '../../lib/ui-store';
import { formatNumber } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, LoadingBlock, Pill, SectionTitle } from '../../components/ui/misc';
import { ReconvertPanel } from './reconvert-panel';

function ChapterTable({ book }: { book: BookSummary }) {
  const m = book.manifest!;
  const hasPages = m.chapters.some((c) => c.pages);
  return (
    <div className="overflow-hidden rounded-lg shadow-raised">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-panel text-caption text-muted">
            <th className="w-12 px-3 py-1.5 text-right font-medium">#</th>
            <th className="px-3 py-1.5 font-medium">Chapter</th>
            {hasPages && <th className="w-24 px-3 py-1.5 text-right font-medium">Pages</th>}
            <th className="w-24 px-3 py-1.5 text-right font-medium">Words</th>
          </tr>
        </thead>
        <tbody>
          {m.chapters.map((c) => (
            <tr key={c.index} className="border-b border-line last:border-0 hover:bg-hover">
              <td className="tnum px-3 py-1.5 text-right text-faint">{c.index + 1}</td>
              <td className="px-3 py-0">
                <button onClick={() => navigate(`${book.path}/${c.file}`)} className="block w-full truncate py-1.5 text-left hover:text-accent" style={{ paddingLeft: Math.max(0, c.level - 1) * 14 }} title={c.file}>
                  {c.title}
                </button>
              </td>
              {hasPages && <td className="tnum px-3 py-1.5 text-right text-muted">{c.pages ? (c.pages[0] === c.pages[1] ? c.pages[0] : `${c.pages[0]}–${c.pages[1]}`) : ''}</td>}
              <td className="tnum px-3 py-1.5 text-right text-muted">{formatNumber(c.words)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Book page: title in the reading face, then its chapters. Numbers, source and conversion live in the inspector. */
export function BookView({ slug }: { slug: string }) {
  const { data: book, isPending, error } = useBook(slug);
  const { data: jobs } = useJobs();
  const inspectorOpen = useUi((s) => s.inspectorOpen);
  if (isPending) return <LoadingBlock />;
  if (error || !book) return <ErrorState error={error} title="Could not open this book" />;
  const m = book.manifest;
  const convertJob = jobs?.find((j) => j.target === book.path && j.kind === 'convert');
  const converting = convertJob?.status === 'running' || convertJob?.status === 'queued';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-8 py-8">
        <header className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-balance font-read text-display font-bold leading-tight">{m?.title ?? slug}</h1>
            <p className="mt-1.5 text-muted">{m?.authors.length ? m.authors.join(', ') : book.sourceFile ?? 'Unknown author'}{m && <span className="tnum"> · {m.chapters.length} chapters · {formatNumber(m.stats.words)} words</span>}</p>
          </div>
          {/* With the inspector closed, its primary action comes back to the page so it is never out of reach. */}
          {m && !inspectorOpen && <Button variant="primary" icon={<Wand2 size={14} />} onClick={() => openCreateSkill(slug)}>Create skill from this book</Button>}
        </header>

        {!m && (
          <section className="rounded-lg bg-panel p-5">
            <div className="mb-3 flex items-center gap-2">
              {converting ? <Pill tone="accent">Converting</Pill> : book.status === 'failed' ? <Pill tone="danger">Conversion failed</Pill> : <Pill tone="warn">Not converted yet</Pill>}
              {convertJob?.error && <span className="truncate text-danger" title={convertJob.error}>{convertJob.error}</span>}
            </div>
            <p className="mb-4 text-muted">
              {converting ? 'The converter is splitting the book into chapters. They appear here when it finishes.' : book.status === 'failed' ? 'The converter stopped before writing chapters. Check the log, then try again with different OCR settings.' : 'The source file is saved. Convert it to get one Markdown file per chapter.'}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <ReconvertPanel slug={slug} primary />
              {convertJob && <Button variant="ghost" icon={<ScrollText size={14} />} onClick={() => openJob(convertJob.id)}>View log</Button>}
            </div>
          </section>
        )}

        {m && m.stats.warnings.length > 0 && (
          <section aria-label="Converter notes">
            <SectionTitle>Converter notes</SectionTitle>
            <ul className="list-disc space-y-0.5 pl-5 text-muted marker:text-faint">{m.stats.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </section>
        )}

        {m && (
          <section>
            <SectionTitle>Chapters</SectionTitle>
            {m.chapters.length ? <ChapterTable book={book} /> : <EmptyState title="No chapters found">The converter produced no chapters. Convert again with OCR set to Force.</EmptyState>}
          </section>
        )}
      </div>
    </div>
  );
}
