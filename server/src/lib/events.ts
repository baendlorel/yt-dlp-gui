import type { ServerResponse } from 'node:http';

interface Client {
  res: ServerResponse;
  id: number;
}

/** 极简 SSE 广播中心：单机应用足够，不引入 WebSocket 依赖 */
export class EventHub {
  private clients = new Map<number, Client>();
  private nextId = 1;
  private heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const client of this.clients.values()) {
        try {
          client.res.write(': ping\n\n');
        } catch {
          this.remove(client.id);
        }
      }
    }, 25000);
    this.heartbeat.unref();
  }

  add(res: ServerResponse): number {
    const id = this.nextId++;
    this.clients.set(id, { res, id });
    res.on('close', () => this.remove(id));
    return id;
  }

  remove(id: number): void {
    this.clients.delete(id);
  }

  broadcast(event: string, payload: unknown): void {
    if (this.clients.size === 0) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of [...this.clients.values()]) {
      try {
        client.res.write(frame);
      } catch {
        this.remove(client.id);
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const client of this.clients.values()) {
      try {
        client.res.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }
}
