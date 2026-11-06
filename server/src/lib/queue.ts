export type JobRunner = (signal: AbortSignal) => Promise<void>;

interface PendingJob {
  id: string;
  run: JobRunner;
}

/**
 * 带并发上限的下载队列。每个任务独立 AbortController，
 * 取消时先终止 yt-dlp 进程树，再由 runner 收尾。
 */
export class TaskQueue {
  private pending: PendingJob[] = [];
  private running = new Map<string, AbortController>();
  private concurrency: number;

  constructor(concurrency = 2) {
    this.concurrency = Math.max(1, concurrency);
  }

  enqueue(id: string, run: JobRunner): void {
    if (this.running.has(id)) return;
    this.pending = this.pending.filter((job) => job.id !== id);
    this.pending.push({ id, run });
    this.pump();
  }

  cancel(id: string): boolean {
    const controller = this.running.get(id);
    if (controller) {
      controller.abort();
      return true;
    }
    const before = this.pending.length;
    this.pending = this.pending.filter((job) => job.id !== id);
    return this.pending.length !== before;
  }

  isActive(id: string): boolean {
    return this.running.has(id) || this.pending.some((job) => job.id === id);
  }

  setConcurrency(value: number): void {
    this.concurrency = Math.max(1, Math.min(6, Math.trunc(value)));
    this.pump();
  }

  get stats(): { running: number; queued: number; concurrency: number } {
    return { running: this.running.size, queued: this.pending.length, concurrency: this.concurrency };
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job || this.running.has(job.id)) continue;
      const controller = new AbortController();
      this.running.set(job.id, controller);
      Promise.resolve()
        .then(() => job.run(controller.signal))
        .catch((error) => {
          console.error(`[queue] 任务 ${job.id} 异常:`, error);
        })
        .finally(() => {
          this.running.delete(job.id);
          this.pump();
        });
    }
  }
}
