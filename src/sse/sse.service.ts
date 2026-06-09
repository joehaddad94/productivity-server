import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

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
      return () => {
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
