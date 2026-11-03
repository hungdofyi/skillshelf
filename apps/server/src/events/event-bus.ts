/** In-process pub/sub for ServerEvent; /api/events streams it to the UI over SSE. */
import type { ServerEvent } from '@b2s/shared';

type Listener = (event: ServerEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  publish(event: ServerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not break the publisher.
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
