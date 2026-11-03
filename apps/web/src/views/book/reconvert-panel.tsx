import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConvertRequest, Job } from '@b2s/shared';
import { keys, upsertJob, useConvertBook } from '../../api/queries';
import { openJob } from '../../lib/ui-store';
import { Button } from '../../components/ui/button';
import { Checkbox, Segmented } from '../../components/ui/misc';

/** OCR mode + image toggle + Re-convert. Starts a convert job and opens its log. */
export function ReconvertPanel({ slug, primary }: { slug: string; primary?: boolean }) {
  const [ocr, setOcr] = useState<NonNullable<ConvertRequest['ocr']>>('auto');
  const [images, setImages] = useState(true);
  const qc = useQueryClient();
  const convert = useConvertBook(slug);
  const run = () =>
    convert.mutate({ ocr, images }, {
      onSuccess: ({ job }) => {
        qc.setQueryData<Job[]>(keys.jobs, (l) => upsertJob(l, job));
        openJob(job.id);
      },
    });
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <span className="text-caption text-muted">OCR</span>
        <Segmented label="OCR mode" value={ocr} onChange={setOcr} options={[{ value: 'auto', label: 'Auto' }, { value: 'off', label: 'Off' }, { value: 'force', label: 'Force' }]} />
      </div>
      <Checkbox checked={images} onChange={setImages}>Extract images</Checkbox>
      <Button variant={primary ? 'primary' : 'secondary'} icon={<RefreshCw size={14} />} loading={convert.isPending} onClick={run}>Re-convert</Button>
    </div>
  );
}
