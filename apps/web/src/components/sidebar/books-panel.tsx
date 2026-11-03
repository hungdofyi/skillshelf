import { BookOpen, BookPlus } from 'lucide-react';
import { useBooks, useJobs } from '../../api/queries';
import { formatNumber } from '../../lib/format';
import { navigate } from '../../lib/location-state';
import { Button } from '../ui/button';
import { Pill } from '../ui/misc';
import { SidebarHeader } from '../shell/sidebar-header';
import { useImportBookPicker } from '../tree/use-import-book';
import { isWithin, SidebarListItem, SidebarNote } from './sidebar-list-item';

/** Books with their conversion state; "Import" is the panel's primary action. */
export function BooksPanel({ activePath }: { activePath: string }) {
  const { data: books, isPending, error } = useBooks();
  const { data: jobs } = useJobs();
  const picker = useImportBookPicker();
  return (
    <>
      <SidebarHeader title="Books">
        <Button size="sm" icon={<BookPlus size={14} />} onClick={picker.pick}>Import</Button>
        {picker.input}
      </SidebarHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {isPending && <SidebarNote>Loading books…</SidebarNote>}
        {error && <SidebarNote>Could not load books: {error.message}</SidebarNote>}
        {books?.length === 0 && <SidebarNote>No books yet. Import a PDF or EPUB, or drop one on the Library tree.</SidebarNote>}
        <ul>
          {books?.map((b) => {
            const converting = jobs?.some((j) => j.target === b.path && j.kind === 'convert' && (j.status === 'running' || j.status === 'queued'));
            const m = b.manifest;
            const meta = converting ? <Pill tone="accent">Converting</Pill>
              : b.status === 'failed' ? <Pill tone="danger">Conversion failed</Pill>
              : b.status === 'pending' || !m ? <Pill tone="warn">Not converted</Pill>
              : <span className="tnum truncate">{m.chapters.length} chapters · {formatNumber(m.stats.words)} words</span>;
            return (
              <SidebarListItem
                key={b.slug}
                icon={<BookOpen size={15} />}
                title={m?.title ?? b.slug}
                meta={meta}
                selected={isWithin(activePath, b.path)}
                onClick={() => navigate(b.path)}
              />
            );
          })}
        </ul>
      </div>
    </>
  );
}
