/** Watches the library folder and publishes coalesced `fs` events on the bus. */
import chokidar from 'chokidar';
import type { ServerEvent } from '@b2s/shared';
import type { EventBus } from '../events/event-bus.js';
import { toLibraryRel } from './library-paths.js';
import { isIgnoredPath } from './library-tree.js';

type FsEvent = Extract<ServerEvent, { type: 'fs' }>;

const COALESCE_MS = 100;

export function startLibraryWatcher(libraryDir: string, bus: EventBus): () => Promise<void> {
  const pending = new Map<string, FsEvent>();
  let timer: NodeJS.Timeout | undefined;

  const flush = () => {
    timer = undefined;
    const batch = [...pending.values()];
    pending.clear();
    for (const ev of batch) bus.publish(ev);
  };
  const queue = (event: FsEvent['event'], abs: string) => {
    const rel = toLibraryRel(libraryDir, abs);
    if (!rel || rel.startsWith('..') || isIgnoredPath(rel)) return;
    pending.set(`${event}:${rel}`, { type: 'fs', event, path: rel });
    timer ??= setTimeout(flush, COALESCE_MS);
  };

  const watcher = chokidar.watch(libraryDir, {
    ignoreInitial: true,
    ignored: (p) => {
      const rel = toLibraryRel(libraryDir, p);
      return rel !== '' && !rel.startsWith('..') && isIgnoredPath(rel);
    },
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });
  for (const ev of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) watcher.on(ev, (p) => queue(ev, p));
  watcher.on('error', (err) => console.error('[watcher]', err));

  return async () => {
    if (timer) clearTimeout(timer);
    await watcher.close();
  };
}
