import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type {
  BatchError,
  DownloadBatch,
  DownloadOptions,
  DownloadTask,
  MediaItem,
  TaskProgress,
} from '../types.js';
import { normalizeOptions } from '../types.js';
import { getEngine, type Engine } from '../lib/engine.js';
import { removeBatchCookieFile, removeCookieFile, writeTempCookieFile } from '../lib/cookies.js';
import { runStreaming } from '../lib/ytdlp.js';
import { mapLimit, newId, truncate } from '../lib/util.js';
import type { StateStore } from '../lib/store.js';
import type { TaskQueue } from '../lib/queue.js';
import type { EventHub } from '../lib/events.js';
import type { Provider, ProviderContext } from '../providers/types.js';
import type { ProviderRegistry } from '../providers/registry.js';

export interface CreateBatchInput {
  urls?: string[] | string;
  items?: MediaItem[];
  options?: unknown;
  /** 主界面填写的 Cookie，仅用于本次批次，不写入 state.json */
  cookie?: string;
  source?: string;
}

export interface PreviewGroup {
  input: string;
  providerId: string;
  providerLabel: string;
  playlistTitle?: string;
  items: MediaItem[];
  truncated?: boolean;
  error?: string;
}

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.webm', '.flv', '.mov', '.m4v', '.ts', '.m4a', '.mp3', '.opus', '.flac']);

export class DownloadService {
  private readonly batchAborts = new Map<string, AbortController>();
  private readonly batchCookies = new Map<string, string>();
  private readonly lastEmit = new Map<string, number>();

  constructor(
    private readonly store: StateStore,
    private readonly queue: TaskQueue,
    private readonly hub: EventHub,
    private readonly registry: ProviderRegistry,
  ) {}

  // ── 创建批次 ─────────────────────────────────────────────

  createBatch(input: CreateBatchInput): DownloadBatch {
    const options = normalizeOptions(input.options, this.store.state.settings.maxPlaylistItems);
    const cookie = cleanCookie(input.cookie);
    const engineStatus = getEngine(this.store.state.settings);
    if (!engineStatus.ok) throw new Error(engineStatus.error ?? 'yt-dlp 不可用');
    const now = Date.now();
    const batch: DownloadBatch = {
      id: newId('batch'),
      createdAt: now,
      inputs: [],
      options,
      taskIds: [],
      errors: [],
      resolving: false,
      canceled: false,
    };

    const directItems = this.cleanItems(input.items);
    if (directItems.length > 0) {
      batch.inputs = directItems.map((item) => item.url);
      this.store.addBatch(batch);
      if (cookie) this.batchCookies.set(batch.id, cookie);
      for (const item of directItems) {
        this.createTask(batch, this.registry.match(item.url), item);
      }
      this.hub.broadcast('batch', batch);
      return batch;
    }

    const urls = this.cleanUrls(input.urls);
    if (urls.length === 0) throw new Error('没有可下载的链接');

    batch.inputs = urls;
    batch.resolving = true;
    this.store.addBatch(batch);
    if (cookie) this.batchCookies.set(batch.id, cookie);
    this.hub.broadcast('batch', batch);
    void this.resolveBatch(batch.id);
    return batch;
  }

  private cleanUrls(input: unknown): string[] {
    const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/\r?\n/) : [];
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      const value = entry.trim();
      if (!value) continue;
      if (value.length > 4096) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      urls.push(value);
      if (urls.length >= 200) break;
    }
    return urls;
  }

  private cleanItems(input: unknown): MediaItem[] {
    if (!Array.isArray(input)) return [];
    const items: MediaItem[] = [];
    const seen = new Set<string>();
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Partial<MediaItem>;
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      items.push({
        url,
        id: typeof item.id === 'string' ? item.id : undefined,
        title: typeof item.title === 'string' ? item.title : undefined,
        uploader: typeof item.uploader === 'string' ? item.uploader : undefined,
        duration: typeof item.duration === 'number' ? item.duration : undefined,
        thumbnail: typeof item.thumbnail === 'string' ? item.thumbnail : undefined,
        webpageUrl: typeof item.webpageUrl === 'string' ? item.webpageUrl : undefined,
        playlistTitle: typeof item.playlistTitle === 'string' ? item.playlistTitle : undefined,
        playlistIndex: typeof item.playlistIndex === 'number' ? item.playlistIndex : undefined,
      });
      if (items.length >= 500) break;
    }
    return items;
  }

  // ── 批量解析（后台进行，前端实时收到新任务）────────────────

  private async resolveBatch(batchId: string): Promise<void> {
    const batch = this.store.getBatch(batchId);
    if (!batch) return;

    const settings = this.store.state.settings;
    const status = getEngine(settings);
    if (!status.ok || !status.engine) {
      batch.errors.push({ input: '', message: status.error ?? 'yt-dlp 不可用' });
      batch.resolving = false;
      this.store.updateBatch(batch.id, batch);
      this.hub.broadcast('batch', batch);
      return;
    }

    const controller = new AbortController();
    this.batchAborts.set(batch.id, controller);
    const cookie = this.batchCookies.get(batch.id);
    const ctx: ProviderContext = {
      engine: status.engine,
      settings,
      ...(cookie ? { cookie } : {}),
      batchId: batch.id,
      signal: controller.signal,
    };

    try {
      await mapLimit(batch.inputs, 3, async (input) => {
        if (batch.canceled || controller.signal.aborted) return;
        try {
          const provider = this.registry.match(input);
          const normalized = await provider.normalize(input, ctx);
          const result = await provider.expand(normalized, ctx);
          const limited = result.items.slice(0, batch.options.maxItems);
          const items = batch.options.expandPlaylist ? limited : limited.slice(0, 1);
          for (const item of items) {
            this.createTask(batch, provider, item, result.playlistTitle);
          }
          this.store.updateBatch(batch.id, batch);
          this.hub.broadcast('batch', batch);
        } catch (error) {
          if (batch.canceled || controller.signal.aborted) return;
          const message = error instanceof Error ? error.message : String(error);
          batch.errors.push({ input, message });
          this.store.updateBatch(batch.id, batch);
          this.hub.broadcast('batch', batch);
        }
      });
    } finally {
      this.batchAborts.delete(batch.id);
      const latest = this.store.getBatch(batchId);
      if (latest && !latest.canceled) {
        latest.resolving = false;
        this.store.updateBatch(batchId, latest);
        this.hub.broadcast('batch', latest);
      }
    }
  }

  private createTask(
    batch: DownloadBatch,
    provider: Provider,
    item: MediaItem,
    playlistTitle?: string,
  ): DownloadTask {
    const task: DownloadTask = {
      id: newId('task'),
      batchId: batch.id,
      providerId: provider.id,
      providerLabel: provider.label,
      url: item.url,
      mediaId: item.id,
      title: item.title ?? item.url,
      uploader: item.uploader,
      duration: item.duration,
      thumbnail: item.thumbnail,
      webpageUrl: item.webpageUrl,
      playlistTitle: playlistTitle ?? item.playlistTitle,
      playlistIndex: item.playlistIndex,
      status: 'queued',
      progress: emptyProgress(),
      options: batch.options,
      createdAt: Date.now(),
      attempt: 0,
    };
    this.store.upsertTask(task);
    batch.taskIds.push(task.id);
    this.store.updateBatch(batch.id, batch);
    this.hub.broadcast('task', task);
    this.enqueue(task.id);
    return task;
  }

  private enqueue(taskId: string): void {
    this.queue.enqueue(taskId, (signal) => this.runTask(taskId, signal));
  }

  // ── 执行单个任务 ─────────────────────────────────────────

  private async runTask(taskId: string, signal: AbortSignal): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task) return;
    if (task.status === 'canceled') return;

    const settings = this.store.state.settings;
    const engineStatus = getEngine(settings);
    if (!engineStatus.ok || !engineStatus.engine) {
      this.finishWithError(task, engineStatus.error ?? 'yt-dlp 不可用');
      return;
    }

    const provider = this.registry.get(task.providerId) ?? this.registry.match(task.url);
    const engine: Engine = engineStatus.engine;
    const cookie = this.batchCookies.get(task.batchId);
    const ctx: ProviderContext = {
      engine,
      settings,
      ...(cookie ? { cookie } : {}),
      batchId: task.batchId,
      signal,
    };

    task.status = 'downloading';
    task.startedAt = Date.now();
    task.finishedAt = undefined;
    task.error = undefined;
    task.errorDetail = undefined;
    task.filePath = undefined;
    task.progress = emptyProgress();
    task.attempt += 1;
    this.touch(task, true);

    const item: MediaItem = {
      url: task.url,
      id: task.mediaId,
      title: task.title,
      uploader: task.uploader,
      duration: task.duration,
      thumbnail: task.thumbnail,
      webpageUrl: task.webpageUrl,
    };

    let filePath: string | undefined;
    let destination: string | undefined;
    let markProcessing = false;
    let streamIndex = 1;
    let destinationCount = 0;
    const log: string[] = [];

    let args: string[];
    try {
      args = provider.downloadArgs(item, task.options, ctx);
    } catch (error) {
      this.finishWithError(task, error instanceof Error ? error.message : String(error));
      return;
    }

    const result = await runStreaming(engine, args, {
      signal,
      onLine: (line) => {
        if (line.startsWith('PROGRESS|')) {
          const progress = parseProgress(line);
          if (progress) {
            progress.stream = streamIndex;
            if (markProcessing) progress.percent = Math.max(progress.percent, 99);
            task.progress = progress;
            this.touch(task);
          }
          return;
        }
        if (line.startsWith('FILE|')) {
          const candidate = line.slice('FILE|'.length).trim();
          if (candidate) filePath = candidate;
          return;
        }
        if (!line.trim()) return;

        log.push(line);
        if (log.length > 80) log.shift();

        const destinationMatch = line.match(/\[download\]\s+Destination:\s+(.+)$/);
        if (destinationMatch?.[1]) {
          destination = destinationMatch[1].trim();
          destinationCount += 1;
          if (destinationCount > 1) streamIndex = destinationCount;
        }

        if (/^\[(Merger|VideoConvertor|ExtractAudio|Metadata|EmbedThumbnail|MoveFiles|Fixup)/.test(line)) {
          markProcessing = true;
          task.status = 'processing';
          task.progress = { ...task.progress, percent: Math.max(task.progress.percent, 99), speed: 0, eta: null };
          this.touch(task, true);
        }
      },
      onStderrLine: (line) => {
        if (!line.trim()) return;
        log.push(line);
        if (log.length > 80) log.shift();
      },
    });

    task.logTail = truncate(log.slice(-40).join('\n'), 4000);

    if (result.aborted || signal.aborted) {
      task.status = 'canceled';
      task.finishedAt = Date.now();
      task.progress = { ...task.progress, speed: 0, eta: null };
      task.error = '已取消';
      this.touch(task, true);
      return;
    }

    if (result.code === 0) {
      const resolved =
        (filePath && fs.existsSync(filePath) ? filePath : undefined) ??
        (destination && fs.existsSync(destination) ? destination : undefined) ??
        this.findFile(task);
      task.status = 'completed';
      task.finishedAt = Date.now();
      task.progress = { ...task.progress, percent: 100, speed: 0, eta: null };
      if (resolved) {
        task.filePath = resolved;
        if (!task.progress.totalBytes) {
          try {
            task.progress.totalBytes = fs.statSync(resolved).size;
            task.progress.downloadedBytes = task.progress.totalBytes;
          } catch {
            /* ignore */
          }
        }
      }
      this.touch(task, true);
      return;
    }

    const friendly = provider.friendlyError(result.stderrTail) || '下载失败';
    task.status = 'failed';
    task.finishedAt = Date.now();
    task.error = result.timedOut ? '下载超时' : friendly;
    task.errorDetail = truncate(result.stderrTail, 6000);
    task.progress = { ...task.progress, speed: 0, eta: null };
    this.touch(task, true);
  }

  private finishWithError(task: DownloadTask, message: string): void {
    task.status = 'failed';
    task.error = message;
    task.finishedAt = Date.now();
    this.touch(task, true);
  }

  /** 最多每 300ms 推一次进度，避免 SSE 压力过大 */
  private touch(task: DownloadTask, force = false): void {
    this.store.upsertTask(task);
    const now = Date.now();
    const last = this.lastEmit.get(task.id) ?? 0;
    if (!force && now - last < 300) return;
    this.lastEmit.set(task.id, now);
    this.hub.broadcast('task', task);
  }

  /** 兜底：按媒体 ID / 修改时间在下载目录里找文件 */
  private findFile(task: DownloadTask): string | undefined {
    try {
      const provider = this.registry.get(task.providerId) ?? this.registry.match(task.url);
      const dir = provider.outputDir(this.store.state.settings);
      const since = (task.startedAt ?? Date.now()) - 5000;
      let best: { file: string; mtime: number; exact: boolean } | undefined;
      const walk = (current: string, depth: number) => {
        if (depth > 2) return;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            walk(full, depth + 1);
            continue;
          }
          if (!entry.isFile()) continue;
          if (!VIDEO_EXT.has(path.extname(entry.name).toLowerCase())) continue;
          const stat = fs.statSync(full);
          if (stat.mtimeMs < since) continue;
          const exact = Boolean(task.mediaId && entry.name.includes(`[${task.mediaId}]`));
          if (!best || (exact && !best.exact) || (exact === best.exact && stat.mtimeMs > best.mtime)) {
            best = { file: full, mtime: stat.mtimeMs, exact };
          }
        }
      };
      walk(dir, 0);
      return best?.file;
    } catch {
      return undefined;
    }
  }

  // ── 预览 / 取消 / 重试 / 删除 ────────────────────────────

  async preview(urls: string[], limit?: number, cookieInput?: string): Promise<PreviewGroup[]> {
    const settings = this.store.state.settings;
    const max = Math.max(1, Math.min(500, limit ?? settings.maxPlaylistItems));
    const status = getEngine(settings);
    if (!status.ok || !status.engine) throw new Error(status.error ?? 'yt-dlp 不可用');
    const cookie = cleanCookie(cookieInput);
    const cookieFile = cookie ? writeTempCookieFile(cookie) : undefined;
    const ctx: ProviderContext = {
      engine: status.engine,
      settings,
      ...(cookie ? { cookie } : {}),
      ...(cookieFile ? { cookieFile } : {}),
    };
    const inputs = this.cleanUrls(urls).slice(0, 30);

    try {
      return await mapLimit(inputs, 3, async (input) => {
        const provider = this.registry.match(input);
        const base: PreviewGroup = {
          input,
          providerId: provider.id,
          providerLabel: provider.label,
          items: [],
        };
        try {
          const normalized = await provider.normalize(input, ctx);
          const result = await provider.expand(normalized, ctx);
          base.playlistTitle = result.playlistTitle;
          base.truncated = result.items.length > max;
          base.items = result.items.slice(0, max);
        } catch (error) {
          base.error = error instanceof Error ? error.message : String(error);
        }
        return base;
      });
    } finally {
      removeCookieFile(cookieFile);
    }
  }

  cancelTask(taskId: string): boolean {
    const task = this.store.getTask(taskId);
    if (!task) return false;
    if (task.status === 'queued') {
      this.queue.cancel(taskId);
      task.status = 'canceled';
      task.error = '已取消';
      task.finishedAt = Date.now();
      this.touch(task, true);
      return true;
    }
    if (task.status === 'downloading' || task.status === 'processing') {
      return this.queue.cancel(taskId);
    }
    return false;
  }

  retryTask(taskId: string): DownloadTask | undefined {
    const task = this.store.getTask(taskId);
    if (!task) return undefined;
    if (task.status === 'queued' || task.status === 'downloading' || task.status === 'processing') return task;
    task.status = 'queued';
    task.error = undefined;
    task.errorDetail = undefined;
    task.filePath = undefined;
    task.startedAt = undefined;
    task.finishedAt = undefined;
    task.progress = emptyProgress();
    this.touch(task, true);
    this.enqueue(task.id);
    return task;
  }

  cancelBatch(batchId: string): DownloadBatch | undefined {
    const batch = this.store.getBatch(batchId);
    if (!batch) return undefined;
    batch.canceled = true;
    batch.resolving = false;
    this.batchAborts.get(batchId)?.abort();
    for (const taskId of [...batch.taskIds]) this.cancelTask(taskId);
    this.store.updateBatch(batchId, batch);
    this.hub.broadcast('batch', batch);
    return batch;
  }

  retryFailed(batchId: string): number {
    const batch = this.store.getBatch(batchId);
    if (!batch) return 0;
    let count = 0;
    for (const taskId of batch.taskIds) {
      const task = this.store.getTask(taskId);
      if (task?.status === 'failed' || task?.status === 'canceled') {
        this.retryTask(taskId);
        count += 1;
      }
    }
    if (count > 0) {
      batch.canceled = false;
      this.store.updateBatch(batchId, batch);
      this.hub.broadcast('batch', batch);
    }
    return count;
  }

  removeTask(taskId: string): boolean {
    const task = this.store.getTask(taskId);
    if (!task) return false;
    if (task.status === 'downloading' || task.status === 'processing' || task.status === 'queued') {
      this.queue.cancel(taskId);
    }
    this.lastEmit.delete(taskId);
    const batchId = task.batchId;
    const removed = this.store.removeTask(taskId);
    if (removed) {
      this.hub.broadcast('task-removed', { id: taskId, batchId });
      const batch = this.store.getBatch(batchId);
      if (batch) this.hub.broadcast('batch', batch);
    }
    return removed;
  }

  removeBatch(batchId: string): boolean {
    const batch = this.store.getBatch(batchId);
    if (!batch) return false;
    for (const taskId of [...batch.taskIds]) this.queue.cancel(taskId);
    this.batchAborts.get(batchId)?.abort();
    this.batchCookies.delete(batchId);
    removeBatchCookieFile(batchId);
    this.store.removeBatch(batchId);
    this.hub.broadcast('batch-removed', { id: batchId });
    return true;
  }

  clearFinishedTasks(): number {
    const removed = this.store.clearFinishedTasks();
    for (const batchId of [...this.batchCookies.keys()]) {
      if (!this.store.getBatch(batchId)) {
        this.batchCookies.delete(batchId);
        removeBatchCookieFile(batchId);
      }
    }
    return removed;
  }

  revealTask(taskId: string): string | undefined {
    const task = this.store.getTask(taskId);
    if (!task) return undefined;
    const target = task.filePath && fs.existsSync(task.filePath) ? task.filePath : undefined;
    if (target) revealInExplorer(target);
    else {
      const provider = this.registry.get(task.providerId) ?? this.registry.match(task.url);
      revealInExplorer(provider.outputDir(this.store.state.settings));
    }
    return target;
  }

  batchErrors(batch: DownloadBatch): BatchError[] {
    return batch.errors;
  }
}

function emptyProgress(): TaskProgress {
  return { percent: 0, downloadedBytes: 0, totalBytes: 0, speed: 0, eta: null, stream: 1 };
}

function cleanCookie(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, 16384) : '';
}

function numeric(value: string | undefined): number {
  if (!value || value === 'NA' || value === 'None') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** 解析 --progress-template 输出的一行 */
export function parseProgress(line: string): TaskProgress | null {
  const parts = line.split('|');
  if (parts.length < 6) return null;
  const downloaded = numeric(parts[1]);
  const total = numeric(parts[2]) || numeric(parts[3]);
  const speed = numeric(parts[4]);
  const eta = numeric(parts[5]);
  const percent = total > 0 ? Math.min(100, (downloaded / total) * 100) : 0;
  return {
    percent: Number.isFinite(percent) ? percent : 0,
    downloadedBytes: downloaded,
    totalBytes: total,
    speed,
    eta: eta > 0 ? eta : null,
  };
}

function revealInExplorer(target: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('explorer.exe', ['/select,', target], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', ['-R', target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [path.dirname(target)], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (error) {
    console.warn('[reveal] 打开目录失败:', error);
  }
}
