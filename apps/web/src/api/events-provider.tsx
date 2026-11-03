import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Job, JobLogLine, ServerEvent } from '@b2s/shared';
import { keys, upsertJob } from './queries';
import { basename } from '../lib/route';
import { navigate } from '../lib/location-state';
import { openJob } from '../lib/ui-store';

const TERMINAL = new Set<Job['status']>(['succeeded', 'failed', 'cancelled']);

const EventsContext = createContext<{ connected: boolean }>({ connected: false });
export const useEventsConnected = () => useContext(EventsContext).connected;

/** Where to send the user when a finished job's "Open" action is clicked. */
function jobOpenPath(job: Job): string {
  const r = job.result ?? {};
  if (job.kind === 'generate' && typeof r.skill === 'string') return `skills/${r.skill}`;
  if (job.kind === 'summarize' && typeof r.path === 'string') return r.path;
  if (job.kind === 'eval' && typeof r.runId === 'string') return `evals/${basename(job.target)}/${r.runId}`;
  return job.target;
}

function notifyFinished(job: Job): void {
  const open = { label: 'Open', onClick: () => navigate(jobOpenPath(job)) };
  if (job.status === 'succeeded') toast.success(`${job.title} finished`, { action: open });
  else if (job.status === 'failed') toast.error(`${job.title} failed`, { description: job.error, action: { label: 'View log', onClick: () => openJob(job.id) } });
  else toast(`${job.title} cancelled`);
}

/** Invalidate whatever cached data an fs change can affect. */
function invalidateForPaths(qc: QueryClient, paths: Set<string>): void {
  void qc.invalidateQueries({ queryKey: keys.tree });
  for (const p of paths) {
    void qc.invalidateQueries({ queryKey: keys.file(p) });
    const [top, a, b] = p.split('/');
    if (top === 'books') {
      void qc.invalidateQueries({ queryKey: keys.books });
      if (a) void qc.invalidateQueries({ queryKey: keys.book(a) });
    } else if (top === 'skills') {
      void qc.invalidateQueries({ queryKey: keys.skills });
      if (a) void qc.invalidateQueries({ queryKey: keys.skill(a) });
    } else if (top === 'evals' && a) {
      void qc.invalidateQueries({ queryKey: keys.runs(a) });
      if (b) void qc.invalidateQueries({ queryKey: keys.run(a, b) });
      void qc.invalidateQueries({ queryKey: keys.skill(a) }); // latestRun pass rates
    }
  }
}

function appendLog(qc: QueryClient, jobId: string, line: JobLogLine): void {
  qc.setQueryData<JobLogLine[]>(keys.jobLog(jobId), (prev) => {
    if (!prev) return prev; // not loaded yet: the initial fetch will include it
    const tail = prev.slice(-30);
    if (tail.some((l) => l.ts === line.ts && l.message === line.message)) return prev; // fetch/SSE overlap
    return [...prev, line];
  });
}

/** One EventSource for the whole app; reconnects with backoff and refetches on reconnect. */
export function EventsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const pending = useRef<{ paths: Set<string>; timer: number | null }>({ paths: new Set(), timer: null });

  useEffect(() => {
    let es: EventSource | null = null;
    let retry = 0;
    let retryTimer: number | undefined;
    let disposed = false;
    const jobsState = new Map<string, Job['status']>();

    const flushFs = () => {
      const p = pending.current;
      p.timer = null;
      const paths = p.paths;
      p.paths = new Set();
      invalidateForPaths(qc, paths);
    };

    const handle = (ev: ServerEvent) => {
      switch (ev.type) {
        case 'fs': {
          pending.current.paths.add(ev.path);
          pending.current.timer ??= window.setTimeout(flushFs, 200);
          break;
        }
        case 'job': {
          const prev = jobsState.get(ev.job.id) ?? qc.getQueryData<Job[]>(keys.jobs)?.find((j) => j.id === ev.job.id)?.status;
          jobsState.set(ev.job.id, ev.job.status);
          qc.setQueryData<Job[]>(keys.jobs, (list) => upsertJob(list, ev.job));
          if (ev.job.kind === 'eval') {
            void qc.invalidateQueries({ queryKey: ['run'] });
            void qc.invalidateQueries({ queryKey: ['runs'] });
          }
          if (prev && !TERMINAL.has(prev) && TERMINAL.has(ev.job.status)) {
            notifyFinished(ev.job);
            void qc.invalidateQueries({ queryKey: keys.tree });
            void qc.invalidateQueries({ queryKey: keys.claude });
          }
          break;
        }
        case 'job-log':
          appendLog(qc, ev.jobId, ev.line);
          break;
        case 'mcp':
          qc.setQueryData(keys.mcp, ev.info);
          break;
      }
    };

    const connect = () => {
      if (disposed) return;
      es = new EventSource('/api/events');
      es.onopen = () => {
        setConnected(true);
        if (retry > 0) void qc.invalidateQueries(); // missed events while offline
        retry = 0;
      };
      es.onmessage = (m: MessageEvent<string>) => {
        try {
          handle(JSON.parse(m.data) as ServerEvent);
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (disposed) return;
        retry += 1;
        retryTimer = window.setTimeout(connect, Math.min(15_000, 500 * 2 ** Math.min(retry, 5)));
      };
    };
    connect();

    const p = pending.current;
    return () => {
      disposed = true;
      es?.close();
      window.clearTimeout(retryTimer);
      if (p.timer) window.clearTimeout(p.timer);
    };
  }, [qc]);

  return <EventsContext.Provider value={{ connected }}>{children}</EventsContext.Provider>;
}
