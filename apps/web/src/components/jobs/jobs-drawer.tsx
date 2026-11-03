import { useEffect } from 'react';
import { ChevronDown, ListChecks, Square } from 'lucide-react';
import { useCancelJob, useJobs } from '../../api/queries';
import { setUi, useUi } from '../../lib/ui-store';
import { navigate } from '../../lib/location-state';
import { Button, IconButton } from '../ui/button';
import { ErrorState, LoadingBlock } from '../ui/misc';
import { isActive, JobKindIcon, JobStatusPill } from './job-bits';
import { JobLogView } from './job-log-view';

/** Drawer above the status bar with the live log of one job. The job list lives in the Activity sidebar. */
export function JobsDrawer() {
  const { data: jobs, isPending, error } = useJobs();
  const selectedId = useUi((s) => s.selectedJobId);
  const cancel = useCancelJob();
  const selected = jobs?.find((j) => j.id === selectedId) ?? jobs?.find((j) => isActive(j.status)) ?? jobs?.[0];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setUi({ selectedJobId: selected.id });
  }, [selected, selectedId]);

  return (
    <section aria-label="Job log" className="flex h-full min-h-0 flex-col bg-surface">
      <header className="hairline-b flex h-9 shrink-0 items-center gap-2 pl-3 pr-1.5">
        {selected ? (
          <>
            <JobKindIcon kind={selected.kind} />
            <span className="min-w-0 truncate font-medium">{selected.title}</span>
            <JobStatusPill status={selected.status} />
            <button className="fx shrink-0 truncate rounded px-1 font-mono text-micro text-muted hover:bg-hover hover:text-fg" onClick={() => navigate(selected.target)}>{selected.target}</button>
            {selected.error && <span className="min-w-0 truncate text-caption text-danger" title={selected.error}>{selected.error}</span>}
          </>
        ) : (
          <span className="font-medium">Job log</span>
        )}
        <span className="flex-1" />
        {selected && isActive(selected.status) && (
          <Button size="sm" icon={<Square size={11} />} loading={cancel.isPending} onClick={() => cancel.mutate(selected.id)}>Cancel job</Button>
        )}
        <IconButton label="All jobs" onClick={() => setUi({ rail: 'activity', sidebarOpen: true })}><ListChecks size={15} /></IconButton>
        <IconButton label="Hide log" onClick={() => setUi({ jobsOpen: false })}><ChevronDown size={16} /></IconButton>
      </header>
      <div className="min-h-0 flex-1">
        {isPending && <LoadingBlock label="Loading jobs" />}
        {error && <ErrorState error={error} title="Could not load jobs" />}
        {jobs?.length === 0 && <p className="p-4 text-muted">No jobs yet. Importing a book, generating a skill or running evals shows up here.</p>}
        {selected && <JobLogView jobId={selected.id} />}
      </div>
    </section>
  );
}
