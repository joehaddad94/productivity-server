import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * Idle SSE connections are closed by intermediaries — proxies and load
 * balancers commonly drop a stream after 30 to 60 seconds of silence. A quiet
 * workspace emits nothing for long stretches, so without traffic the stream
 * died and only came back because EventSource happens to reconnect, producing
 * a slow reconnect cycle instead of a live connection.
 */
const HEARTBEAT_MS = 25_000;

@Injectable()
export class SseService {
  private readonly clients = new Map<string, Set<Subject<MessageEvent>>>();

  subscribe(workspaceId: string): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    if (!this.clients.has(workspaceId)) {
      this.clients.set(workspaceId, new Set());
    }
    this.clients.get(workspaceId)!.add(subject);

    return new Observable((observer) => {
      const sub = subject.subscribe(observer);

      // Typed so the client's onmessage handler ignores it: useWorkspaceSSE
      // only acts on `thread_changed`, and otherwise invalidates tasks — an
      // untyped ping would trigger a refetch every 25 seconds.
      const heartbeat = setInterval(() => {
        subject.next({ data: { type: 'ping' } } as MessageEvent);
      }, HEARTBEAT_MS);

      return () => {
        clearInterval(heartbeat);
        sub.unsubscribe();
        const set = this.clients.get(workspaceId);
        if (set) {
          set.delete(subject);
          if (set.size === 0) this.clients.delete(workspaceId);
        }
      };
    });
  }

  emit(workspaceId: string, data: Record<string, unknown>): void {
    const clients = this.clients.get(workspaceId);
    if (!clients?.size) return;
    const event = { data } as MessageEvent;
    for (const subject of clients) {
      subject.next(event);
    }
  }
}
