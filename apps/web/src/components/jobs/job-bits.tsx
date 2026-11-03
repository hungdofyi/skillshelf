import { BookOpen, FlaskConical, PenLine, RefreshCw, Wand2 } from 'lucide-react';
import type { Job, JobKind, JobStatus } from '@b2s/shared';
import { Pill, Spinner } from '../ui/misc';

export const KIND_LABEL: Record<JobKind, string> = { convert: 'Convert', generate: 'Generate', revise: 'Revise', eval: 'Eval' };

export function JobKindIcon({ kind, size = 14 }: { kind: JobKind; size?: number }) {
  const Icon = { convert: BookOpen, generate: Wand2, revise: PenLine, eval: FlaskConical }[kind] ?? RefreshCw;
  return <Icon size={size} aria-hidden className="shrink-0 text-muted" />;
}

export const isActive = (s: JobStatus) => s === 'queued' || s === 'running';

export function JobStatusPill({ status }: { status: JobStatus }) {
  switch (status) {
    case 'running': return <Pill tone="accent"><Spinner size={10} className="text-accent" />Running</Pill>;
    case 'queued': return <Pill>Queued</Pill>;
    case 'succeeded': return <Pill tone="ok">Done</Pill>;
    case 'failed': return <Pill tone="danger">Failed</Pill>;
    case 'cancelled': return <Pill>Cancelled</Pill>;
  }
}

export const progressFraction = (job: Job): number | undefined =>
  job.progress && job.progress.total > 0 ? job.progress.current / job.progress.total : undefined;
