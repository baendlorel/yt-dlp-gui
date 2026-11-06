import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type {
  AppState,
  DownloadBatch,
  DownloadTask,
  PublicSettings,
  Settings,
  TaskStatus,
} from '../types.js';
import { clampInt } from '../types.js';

const STATE_FILE = path.join(config.dataDir, 'state.json');
const MAX_TASKS = 600;
const MAX_BATCHES = 120;

const ACTIVE: TaskStatus[] = ['queued', 'downloading', 'processing'];

export function defaultSettings(): Settings {
  return {
    downloadDir: config.downloadDir,
    concurrency: 2,
    fragmentConcurrency: 4,
    maxPlaylistItems: 300,
    cookie: '',
    ffmpegPath: '',
    ytdlpPath: '',
    pythonPath: '',
    organizeByProvider: true,
  };
}

function sanitizeSettings(input: Partial<Settings> | undefined): Settings {
  const base = defaultSettings();
  if (!input || typeof input !== 'object') return base;
  return {
    downloadDir: typeof input.downloadDir === 'string' && input.downloadDir.trim() ? input.downloadDir.trim() : base.downloadDir,
    concurrency: clampInt(input.concurrency, 1, 6, base.concurrency),
    fragmentConcurrency: clampInt(input.fragmentConcurrency, 1, 16, base.fragmentConcurrency),
    maxPlaylistItems: clampInt(input.maxPlaylistItems, 1, 500, base.maxPlaylistItems),
    cookie: typeof input.cookie === 'string' ? input.cookie.trim() : '',
    ffmpegPath: typeof input.ffmpegPath === 'string' ? input.ffmpegPath.trim() : '',
    ytdlpPath: typeof input.ytdlpPath === 'string' ? input.ytdlpPath.trim() : '',
    pythonPath: typeof input.pythonPath === 'string' ? input.pythonPath.trim() : '',
    organizeByProvider: input.organizeByProvider !== false,
  };
}

function emptyState(): AppState {
  return { version: 1, tasks: [], batches: [], settings: defaultSettings() };
}

export class StateStore {
  state: AppState = emptyState();
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  load(): void {
    fs.mkdirSync(config.dataDir, { recursive: true });
    if (!fs.existsSync(STATE_FILE)) {
      this.state = emptyState();
      this.scheduleSave();
      return;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<AppState>;
      this.state = {
        version: 1,
        tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
        batches: Array.isArray(raw.batches) ? raw.batches : [],
        settings: sanitizeSettings(raw.settings),
      };
    } catch (error) {
      const backup = `${STATE_FILE}.corrupt-${Date.now()}.json`;
      try {
        fs.copyFileSync(STATE_FILE, backup);
      } catch {
        /* ignore */
      }
      console.warn(`[store] 状态文件损坏，已备份到 ${backup}:`, error);
      this.state = emptyState();
    }

    this.recoverInterrupted();
    this.prune();
  }

  /** 进程重启后，把上次未完成的任务标记为中断，避免永远停在“下载中” */
  private recoverInterrupted(): void {
    const now = Date.now();
    for (const task of this.state.tasks) {
      if (ACTIVE.includes(task.status)) {
        task.status = 'failed';
        task.error = '服务重启，任务已中断';
        task.finishedAt = now;
      }
    }
    for (const batch of this.state.batches) {
      if (batch.resolving) {
        batch.resolving = false;
        batch.errors.push({ input: '', message: '服务重启，链接解析被中断' });
      }
    }
  }

  private prune(): void {
    const keep = new Set<string>();
    const sortedTasks = [...this.state.tasks].sort((a, b) => b.createdAt - a.createdAt);
    for (const task of sortedTasks.slice(0, MAX_TASKS)) keep.add(task.id);
    this.state.tasks = this.state.tasks.filter((task) => keep.has(task.id));

    const batches = [...this.state.batches].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_BATCHES);
    for (const batch of batches) {
      batch.taskIds = batch.taskIds.filter((id) => keep.has(id));
    }
    this.state.batches = batches;

    for (const task of this.state.tasks) {
      if (!this.state.batches.some((batch) => batch.id === task.batchId)) {
        // 批次已被裁掉的孤立任务不再保留
        task.batchId = '';
      }
    }
    this.state.tasks = this.state.tasks.filter((task) => {
      if (task.batchId !== '') return true;
      return ACTIVE.includes(task.status);
    });
  }

  getTask(id: string): DownloadTask | undefined {
    return this.state.tasks.find((task) => task.id === id);
  }

  getBatch(id: string): DownloadBatch | undefined {
    return this.state.batches.find((batch) => batch.id === id);
  }

  upsertTask(task: DownloadTask): DownloadTask {
    const index = this.state.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) this.state.tasks[index] = task;
    else this.state.tasks.push(task);
    this.scheduleSave();
    return task;
  }

  addBatch(batch: DownloadBatch): DownloadBatch {
    this.state.batches.push(batch);
    this.scheduleSave();
    return batch;
  }

  updateBatch(id: string, patch: Partial<DownloadBatch>): DownloadBatch | undefined {
    const batch = this.getBatch(id);
    if (!batch) return undefined;
    Object.assign(batch, patch);
    this.scheduleSave();
    return batch;
  }

  removeTask(id: string): boolean {
    const before = this.state.tasks.length;
    this.state.tasks = this.state.tasks.filter((task) => task.id !== id);
    for (const batch of this.state.batches) {
      batch.taskIds = batch.taskIds.filter((taskId) => taskId !== id);
    }
    if (this.state.tasks.length !== before) {
      this.scheduleSave();
      return true;
    }
    return false;
  }

  removeBatch(id: string): DownloadBatch | undefined {
    const batch = this.getBatch(id);
    if (!batch) return undefined;
    this.state.batches = this.state.batches.filter((item) => item.id !== id);
    this.state.tasks = this.state.tasks.filter((task) => task.batchId !== id);
    this.scheduleSave();
    return batch;
  }

  clearFinishedTasks(): number {
    const removable = (task: DownloadTask) => task.status === 'completed' || task.status === 'failed' || task.status === 'canceled';
    const before = this.state.tasks.length;
    const removed = new Set(this.state.tasks.filter(removable).map((task) => task.id));
    this.state.tasks = this.state.tasks.filter((task) => !removed.has(task.id));
    for (const batch of this.state.batches) {
      batch.taskIds = batch.taskIds.filter((id) => !removed.has(id));
    }
    this.state.batches = this.state.batches.filter((batch) => batch.taskIds.length > 0 || batch.resolving);
    this.scheduleSave();
    return before - this.state.tasks.length;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.state.settings = sanitizeSettings({ ...this.state.settings, ...patch });
    this.scheduleSave();
    return this.state.settings;
  }

  publicSettings(): PublicSettings {
    const { cookie, ...rest } = this.state.settings;
    const preview = cookie.replace(/\s+/g, ' ');
    return {
      ...rest,
      hasCookie: cookie.length > 0,
      cookiePreview: cookie ? `${preview.slice(0, 4)}…${preview.slice(-4)}` : '',
    };
  }

  scheduleSave(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveNow();
    }, 400);
  }

  saveNow(): void {
    if (!this.dirty) return;
    this.dirty = false;
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.state), 'utf8');
      fs.renameSync(tmp, STATE_FILE);
    } catch (error) {
      console.error('[store] 保存状态失败:', error);
      try {
        fs.copyFileSync(tmp, STATE_FILE);
      } catch {
        /* ignore */
      }
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirty = true;
    this.saveNow();
  }
}
