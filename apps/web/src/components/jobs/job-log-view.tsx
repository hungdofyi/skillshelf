import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown } from 'lucide-react';
import type { JobLogLine } from '@b2s/shared';
import { useJobLog } from '../../api/queries';
import { formatClock } from '../../lib/format';
import { Button } from '../ui/button';
import { ErrorState, LoadingBlock } from '../ui/misc';

const LEVEL_CLS: Record<JobLogLine['level'], string> = { info: 'text-fg', warn: 'text-warn', error: 'text-danger', debug: 'text-faint' };

function compact(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data);
  } catch {
    return '';
  }
}

/** Live log: initial fetch + SSE appends (merged into the query cache). Auto-scrolls until the user scrolls up. */
export function JobLogView({ jobId }: { jobId: string }) {
  const { data, isPending, error } = useJobLog(jobId);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    stick.current = true;
    setPaused(false);
  }, [jobId]);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [data?.length, jobId]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stick.current = atBottom;
    setPaused(!atBottom);
  };

  if (isPending) return <LoadingBlock label="Loading log" />;
  if (error) return <ErrorState error={error} title="Could not load the log" />;

  return (
    <div className="relative h-full">
      <div ref={ref} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-2 font-mono text-caption leading-[1.55]" role="log" aria-live="off" tabIndex={0}>
        {data.length === 0 && <p className="font-sans text-muted">No output yet.</p>}
        {data.map((l, i) => (
          <div key={`${l.ts}-${i}`} className="flex gap-2.5 whitespace-pre-wrap break-words">
            <span className="tnum shrink-0 select-none text-faint">{formatClock(l.ts)}</span>
            <span className={clsx('min-w-0', LEVEL_CLS[l.level])}>
              {l.message}
              {l.data && <span className="ml-2 text-faint" title={compact(l.data)}>{compact(l.data).slice(0, 160)}</span>}
            </span>
          </div>
        ))}
      </div>
      {paused && (
        <Button size="sm" className="absolute bottom-3 right-4 shadow-pop" icon={<ArrowDown size={13} />} onClick={() => { const el = ref.current; if (el) { el.scrollTop = el.scrollHeight; stick.current = true; setPaused(false); } }}>
          Jump to latest
        </Button>
      )}
    </div>
  );
}
