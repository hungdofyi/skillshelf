import clsx from 'clsx';
import { ScrollText } from 'lucide-react';
import { useJobs } from '../../api/queries';
import { formatDuration, jobDurationMs } from '../../lib/format';
import { useNow } from '../../lib/use-now';
import { setUi, useUi } from '../../lib/ui-store';
import { Button } from '../ui/button';
import { ProgressBar } from '../ui/misc';
import { isActive, JobKindIcon, JobStatusPill, KIND_LABEL, progressFraction } from '../jobs/job-bits';
import { SidebarHeader } from '../shell/sidebar-header';
import { SidebarNote } from './sidebar-list-item';

/** Job list. Picking a job opens its live log in the drawer above the status bar. */
export function ActivityPanel() {
  const { data: jobs, isPending, error } = useJobs();
  const selectedId = useUi((s) => s.selectedJobId);
  const jobsOpen = useUi((s) => s.jobsOpen);
  const now = useNow(!!jobs?.some((j) => isActive(j.status)));
  return (
    <>
      <SidebarHeader title="Activity">
        <Button size="sm" variant="ghost" icon={<ScrollText size={14} />} aria-pressed={jobsOpen} onClick={() => setUi({ jobsOpen: !jobsOpen })}>
          {jobsOpen ? 'Hide log' : 'Show log'}
        </Button>
      </SidebarHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {isPending && <SidebarNote>Loading jobs…</SidebarNote>}
        {error && <SidebarNote>Could not load jobs: {error.message}</SidebarNote>}
        {jobs?.length === 0 && <SidebarNote>No jobs yet. Importing a book, generating a skill or running evals shows up here.</SidebarNote>}
        <ul aria-label="Jobs">
          {jobs?.map((j) => {
            const selected = j.id === selectedId && jobsOpen;
            const fraction = progressFraction(j);
            return (
              <li key={j.id}>
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => setUi({ selectedJobId: j.id, jobsOpen: true })}
                  className={clsx('mb-0.5 flex w-full flex-col gap-1.5 rounded-md px-2 py-2 text-left outline-offset-[-2px]', selected ? 'bg-accent-soft' : 'hover:bg-hover')}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <JobKindIcon kind={j.kind} />
                    <span className="min-w-0 flex-1 truncate font-medium">{j.title}</span>
                    <span className="tnum shrink-0 text-caption text-muted">{formatDuration(jobDurationMs(j, now))}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <JobStatusPill status={j.status} />
                    <span className="min-w-0 flex-1 truncate text-caption text-muted">{j.progress?.label ?? KIND_LABEL[j.kind]}</span>
                  </span>
                  {isActive(j.status) && <ProgressBar value={fraction} indeterminate={fraction === undefined} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
