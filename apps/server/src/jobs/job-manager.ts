/**
 * Background job queue for long work (conversion, skill generation, evals).
 *
 * - FIFO with a small concurrency cap so headless Claude runs don't pile up.
 * - Each job's state is persisted to <dataDir>/jobs/<id>.json and its log to <id>.log.jsonl,
 *   so the UI can show history after a restart. Jobs that were running when the server
 *   stopped are marked failed on load.
 * - Every state change and log line is published on the EventBus for live UI updates.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Job, JobKind, JobLogLine } from '@b2s/shared';
import type { EventBus } from '../events/event-bus.js';
import { HttpError } from '../http-error.js';

export interface JobContext {
  readonly job: Readonly<Job>;
  /** Aborted when the user cancels the job; pass it to child processes. */
  readonly signal: AbortSignal;
  log(message: string, opts?: { level?: JobLogLine['level']; data?: Record<string, unknown> }): void;
  progress(current: number, total: number, label?: string): void;
}

/** Return value becomes Job.result. Throwing marks the job failed with the error message. */
export type JobRunner = (ctx: JobContext) => Promise<Record<string, unknown> | void>;

export interface CreateJobInput {
  kind: JobKind;
  title: string;
  target: string;
  /** Called when the job is cancelled while still queued (its runner will never execute). */
  onCancelledBeforeStart?: () => void;
}

const MAX_KEPT_JOBS = 300;

export class JobManager {
  private jobs = new Map<string, Job>();
  private queue: Array<{ id: string; run: JobRunner; onCancelledBeforeStart?: () => void }> = [];
  private controllers = new Map<string, AbortController>();
  private running = 0;
  private readonly dir: string;

  constructor(
    dataDir: string,
    private readonly bus: EventBus,
    private readonly concurrency = 2,
  ) {
    this.dir = path.join(dataDir, 'jobs');
    mkdirSync(this.dir, { recursive: true });
    this.loadPersisted();
  }

  create(input: CreateJobInput, run: JobRunner): Job {
    const job: Job = {
      id: `${input.kind}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
      kind: input.kind,
      status: 'queued',
      title: input.title,
      target: input.target,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    this.persist(job);
    this.bus.publish({ type: 'job', job });
    this.queue.push({ id: job.id, run, onCancelledBeforeStart: input.onCancelledBeforeStart });
    this.pump();
    return job;
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, `Job not found: ${id}`);
    return job;
  }

  getLog(id: string): JobLogLine[] {
    this.get(id);
    const file = this.logFile(id);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as JobLogLine);
  }

  cancel(id: string): void {
    const job = this.get(id);
    if (job.status === 'queued') {
      const entry = this.queue.find((q) => q.id === id);
      this.queue = this.queue.filter((q) => q.id !== id);
      this.update(job, { status: 'cancelled', finishedAt: new Date().toISOString() });
      try {
        entry?.onCancelledBeforeStart?.();
      } catch (err) {
        console.warn(`job ${id}: cancel hook failed:`, err instanceof Error ? err.message : err);
      }
      return;
    }
    this.controllers.get(id)?.abort();
  }

  /**
   * Cancel everything (queued and running) and wait until running jobs settle, so no child
   * process (converter, claude) outlives the server. Used on shutdown.
   */
  async cancelAll(timeoutMs = 5000): Promise<void> {
    for (const { id } of [...this.queue]) this.cancel(id);
    for (const controller of this.controllers.values()) controller.abort();
    const start = Date.now();
    while (this.running > 0 && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 25));
  }

  /** True when a job for this target is queued or running (used to refuse duplicates). */
  isBusy(target: string): boolean {
    return [...this.jobs.values()].some((j) => j.target === target && (j.status === 'queued' || j.status === 'running'));
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      void this.execute(next.id, next.run);
    }
  }

  private async execute(id: string, run: JobRunner): Promise<void> {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'queued') return;
    this.running++;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.update(job, { status: 'running', startedAt: new Date().toISOString() });

    const ctx: JobContext = {
      job,
      signal: controller.signal,
      log: (message, opts) => this.appendLog(id, { ts: new Date().toISOString(), level: opts?.level ?? 'info', message, data: opts?.data }),
      progress: (current, total, label) => this.update(job, { progress: { current, total, label } }),
    };

    try {
      const result = await run(ctx);
      if (controller.signal.aborted) {
        this.update(job, { status: 'cancelled', finishedAt: new Date().toISOString() });
      } else {
        this.update(job, { status: 'succeeded', finishedAt: new Date().toISOString(), result: result ?? undefined });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log(message, { level: 'error' });
      this.update(job, {
        status: controller.signal.aborted ? 'cancelled' : 'failed',
        finishedAt: new Date().toISOString(),
        error: message,
      });
    } finally {
      this.controllers.delete(id);
      this.running--;
      this.pump();
    }
  }

  private update(job: Job, patch: Partial<Job>): void {
    Object.assign(job, patch);
    this.persist(job);
    this.bus.publish({ type: 'job', job: { ...job } });
  }

  /**
   * Called from child-process stream handlers, so it must never throw (an exception there would be
   * uncaught and take the server down). Lines that arrive after the job finished — e.g. stderr
   * flushed by a killed process — are dropped.
   */
  private appendLog(id: string, line: JobLogLine): void {
    const job = this.jobs.get(id);
    if (!job || (job.finishedAt && job.status !== 'running')) return;
    try {
      appendFileSync(this.logFile(id), JSON.stringify(line) + '\n');
    } catch {
      return;
    }
    this.bus.publish({ type: 'job-log', jobId: id, line });
  }

  /** Best effort: a failed state write must not fail the job itself. */
  private persist(job: Job): void {
    try {
      writeFileSync(path.join(this.dir, `${job.id}.json`), JSON.stringify(job, null, 2));
    } catch (err) {
      console.error(`job ${job.id}: could not persist state:`, err instanceof Error ? err.message : err);
    }
  }

  private logFile(id: string): string {
    return path.join(this.dir, `${id}.log.jsonl`);
  }

  private loadPersisted(): void {
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    const loaded: Job[] = [];
    for (const f of files) {
      try {
        loaded.push(JSON.parse(readFileSync(path.join(this.dir, f), 'utf8')) as Job);
      } catch {
        // Skip unreadable job files rather than refusing to start.
      }
    }
    loaded.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const job of loaded.slice(0, MAX_KEPT_JOBS)) {
      if (job.status === 'running' || job.status === 'queued') {
        job.status = 'failed';
        job.error = 'Server restarted while the job was running';
        job.finishedAt ??= new Date().toISOString();
        this.persist(job);
      }
      this.jobs.set(job.id, job);
    }
  }
}
