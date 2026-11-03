/** Long-lived services shared by every route module. Built once in createAppContext(). */
import { mkdirSync } from 'node:fs';
import type { AppConfig } from './config.js';
import { failOrphanedEvalRuns } from './evals/eval-run-recovery.js';
import { EventBus } from './events/event-bus.js';
import { JobManager } from './jobs/job-manager.js';
import { BookStore } from './library/book-store.js';
import { SkillStore } from './skills/skill-store.js';

export interface AppContext {
  config: AppConfig;
  bus: EventBus;
  jobs: JobManager;
  books: BookStore;
  skills: SkillStore;
  /** Cleanup callbacks (stop watchers, tunnels, child processes) run on SIGINT/SIGTERM. */
  onShutdown(fn: () => void | Promise<void>): void;
  shutdown(): Promise<void>;
}

export function createAppContext(config: AppConfig): AppContext {
  for (const dir of [config.libraryDir, `${config.libraryDir}/books`, `${config.libraryDir}/skills`, `${config.libraryDir}/evals`, config.dataDir]) {
    mkdirSync(dir, { recursive: true });
  }
  const bus = new EventBus();
  const hooks: Array<() => void | Promise<void>> = [];
  const jobs = new JobManager(config.dataDir, bus);
  failOrphanedEvalRuns(config.libraryDir, (target) => jobs.isBusy(target));
  return {
    config,
    bus,
    jobs,
    books: new BookStore(config.libraryDir),
    skills: new SkillStore(config.libraryDir),
    onShutdown: (fn) => hooks.push(fn),
    shutdown: async () => {
      // Stop jobs first so their child processes are killed before anything else closes.
      await jobs.cancelAll();
      for (const fn of hooks.reverse()) {
        try {
          await fn();
        } catch {
          // Keep shutting down the rest.
        }
      }
    },
  };
}
