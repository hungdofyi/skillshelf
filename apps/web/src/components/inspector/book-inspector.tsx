import { ScrollText, Wand2 } from 'lucide-react';
import { useBook, useJobs } from '../../api/queries';
import { formatBytes, formatNumber, formatTime } from '../../lib/format';
import { openCreateSkill, openJob } from '../../lib/ui-store';
import { ReconvertPanel } from '../../views/book/reconvert-panel';
import { Button } from '../ui/button';
import { Pill } from '../ui/misc';
import { OneLine } from '../ui/one-line';
import { InspectorFacts, InspectorNote, InspectorSection } from './inspector-section';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="tnum text-title font-semibold">{formatNumber(value)}</div>
      <div className="text-caption text-muted">{label}</div>
    </div>
  );
}

/** Book: the next step (create a skill), the numbers, the source file and its conversion. */
export function BookInspector({ slug }: { slug: string }) {
  const { data: book, isPending } = useBook(slug);
  const { data: jobs } = useJobs();
  if (isPending) return <InspectorNote>Loading…</InspectorNote>;
  if (!book) return <InspectorNote>This book could not be read.</InspectorNote>;
  const m = book.manifest;
  const job = jobs?.find((j) => j.target === book.path && j.kind === 'convert');
  const converting = job?.status === 'running' || job?.status === 'queued';
  const status = converting ? <Pill tone="accent">Converting</Pill>
    : book.status === 'failed' ? <Pill tone="danger">Conversion failed</Pill>
    : m ? <Pill tone="ok">Converted</Pill> : <Pill tone="warn">Not converted</Pill>;

  return (
    <>
      {m && (
        <div className="px-4 pb-1 pt-3">
          <Button variant="primary" className="w-full" icon={<Wand2 size={14} />} onClick={() => openCreateSkill(slug)}>Create skill from this book</Button>
        </div>
      )}
      {m && (
        <InspectorSection title="Contents">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Stat label="words" value={m.stats.words} />
            <Stat label="chapters" value={m.chapters.length} />
            {m.source.pages !== undefined && <Stat label="pages" value={m.source.pages} />}
            <Stat label="OCR pages" value={m.converter.ocrPages} />
          </div>
        </InspectorSection>
      )}
      {m && (
        <InspectorSection title="Source">
          <InspectorFacts items={[
            ['Format', <span className="uppercase">{m.source.format}</span>],
            ['File', <OneLine className="font-mono text-caption">{m.source.file}</OneLine>],
            ['Size', <span className="tnum">{formatBytes(m.source.bytes)}</span>],
            ...(m.language ? ([['Language', m.language]] as Array<[string, string]>) : []),
          ]} />
        </InspectorSection>
      )}
      <InspectorSection title="Conversion" aside={status}>
        {m && (
          <InspectorFacts items={[
            ['Converter', `${m.converter.engine} ${m.converter.version}`],
            ['Converted', formatTime(m.converter.convertedAt)],
          ]} />
        )}
        {job?.error && <p className="mt-2 break-words text-danger">{job.error}</p>}
        {m && <div className="mt-3"><ReconvertPanel slug={slug} /></div>}
        {job && <Button className="mt-2" size="sm" variant="ghost" icon={<ScrollText size={13} />} onClick={() => openJob(job.id)}>{converting ? 'Show live log' : 'Last conversion log'}</Button>}
      </InspectorSection>
    </>
  );
}
