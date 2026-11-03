import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BookSummary, Job } from '@b2s/shared';
import { uploadFile } from '../../api/client';
import { keys, upsertJob } from '../../api/queries';
import { navigate } from '../../lib/location-state';
import { openJob } from '../../lib/ui-store';
import { formatBytes } from '../../lib/format';

const ACCEPT = /\.(pdf|epub)$/i;

/** Upload PDF/EPUB files to /api/books/import with a live progress toast. */
export function useImportBooks() {
  const qc = useQueryClient();
  return useCallback(
    async (files: File[]) => {
      const accepted = files.filter((f) => ACCEPT.test(f.name));
      const rejected = files.length - accepted.length;
      if (rejected > 0) toast.error(rejected === files.length ? 'Only PDF and EPUB files can be imported' : `${rejected} file(s) skipped: only PDF and EPUB are supported`);
      for (const file of accepted) {
        const id = toast.loading(`Uploading ${file.name} (${formatBytes(file.size)})`, { duration: Infinity });
        try {
          const res = await uploadFile<{ book: BookSummary; job: Job }>('/api/books/import', file, (f) => {
            toast.loading(`Uploading ${file.name}: ${Math.round(f * 100)}%`, { id, duration: Infinity });
          });
          qc.setQueryData<Job[]>(keys.jobs, (l) => upsertJob(l, res.job));
          void qc.invalidateQueries({ queryKey: keys.tree });
          void qc.invalidateQueries({ queryKey: keys.books });
          toast.success(`${file.name} uploaded. Converting…`, { id, duration: 4000, action: { label: 'Show log', onClick: () => openJob(res.job.id) } });
          navigate(`books/${res.book.slug}`, { force: true });
        } catch (e) {
          toast.error(`Could not import ${file.name}`, { id, description: e instanceof Error ? e.message : String(e), duration: 8000 });
        }
      }
    },
    [qc],
  );
}

/** A hidden PDF/EPUB file input plus the function that opens it, for any "Import book" control. */
export function useImportBookPicker() {
  const importBooks = useImportBooks();
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept=".pdf,.epub,application/pdf,application/epub+zip"
      multiple
      hidden
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (files.length) void importBooks(files);
      }}
    />
  );
  return { pick: () => ref.current?.click(), input };
}
