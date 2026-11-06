import { reactive } from 'vue';
import { api } from './api';
import type {
  Batch,
  PreviewGroup,
  PublicSettings,
  SystemInfo,
  Task,
  TaskStatus,
} from './types';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface UiState {
  ready: boolean;
  online: boolean;
  tasks: Record<string, Task>;
  batches: Batch[];
  settings: PublicSettings | null;
  system: SystemInfo | null;
  queue: { running: number; queued: number; concurrency: number };
  toasts: Toast[];
  previewGroups: PreviewGroup[];
  previewOpen: boolean;
}

export const state = reactive<UiState>({
  ready: false,
  online: false,
  tasks: {},
  batches: [],
  settings: null,
  system: null,
  queue: { running: 0, queued: 0, concurrency: 2 },
  toasts: [],
  previewGroups: [],
  previewOpen: false,
});

let toastId = 1;
let eventSource: EventSource | null = null;
let bootstrapped = false;

export function toast(message: string, kind: ToastKind = 'info'): void {
  const id = toastId++;
  state.toasts.push({ id, kind, message });
  window.setTimeout(() => {
    state.toasts = state.toasts.filter((item) => item.id !== id);
  }, kind === 'error' ? 6500 : 4000);
}

export async function refreshState(): Promise<void> {
  try {
    const data = await api.state();
    state.tasks = Object.fromEntries(data.tasks.map((task) => [task.id, task]));
    state.batches = data.batches;
    state.settings = data.settings;
    state.queue = data.queue;
    state.ready = true;
  } catch (error) {
    state.ready = true;
    toast(error instanceof Error ? error.message : '加载失败', 'error');
  }
}

export async function refreshSystem(): Promise<void> {
  try {
    state.system = await api.system();
    state.queue = state.system.queue;
  } catch (error) {
    toast(error instanceof Error ? error.message : '无法获取服务状态', 'error');
  }
}

export async function bootstrap(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  await Promise.all([refreshState(), refreshSystem()]);
  connectEvents();
}

function connectEvents(): void {
  if (eventSource) return;
  eventSource = new EventSource('/api/events');

  eventSource.onopen = () => {
    state.online = true;
    // 断线重连后补齐可能错过的状态
    void refreshState();
  };
  eventSource.onerror = () => {
    state.online = false;
  };

  eventSource.addEventListener('task', (event) => {
    const task = parse<Task>(event);
    if (task) state.tasks[task.id] = task;
  });

  eventSource.addEventListener('task-removed', (event) => {
    const payload = parse<{ id: string }>(event);
    if (payload) delete state.tasks[payload.id];
  });

  eventSource.addEventListener('batch', (event) => {
    const batch = parse<Batch>(event);
    if (!batch) return;
    const index = state.batches.findIndex((item) => item.id === batch.id);
    if (index >= 0) state.batches[index] = batch;
    else state.batches.push(batch);
  });

  eventSource.addEventListener('batch-removed', (event) => {
    const payload = parse<{ id: string }>(event);
    if (!payload) return;
    const batch = state.batches.find((item) => item.id === payload.id);
    if (batch) {
      for (const taskId of batch.taskIds) delete state.tasks[taskId];
    }
    state.batches = state.batches.filter((item) => item.id !== payload.id);
  });

  eventSource.addEventListener('settings', (event) => {
    const settings = parse<PublicSettings>(event);
    if (settings) state.settings = settings;
  });

  eventSource.addEventListener('refresh', () => {
    void refreshState();
  });
}

function parse<T>(event: Event): T | null {
  try {
    return JSON.parse((event as MessageEvent).data) as T;
  } catch {
    return null;
  }
}

export function batchTasks(batch: Batch): Task[] {
  const tasks: Task[] = [];
  for (const id of batch.taskIds) {
    const task = state.tasks[id];
    if (task) tasks.push(task);
  }
  return tasks;
}

export interface BatchStats {
  total: number;
  completed: number;
  failed: number;
  canceled: number;
  active: number;
  queued: number;
  percent: number;
  speed: number;
}

export function statsOf(tasks: Task[]): BatchStats {
  const stats: BatchStats = {
    total: tasks.length,
    completed: 0,
    failed: 0,
    canceled: 0,
    active: 0,
    queued: 0,
    percent: 0,
    speed: 0,
  };
  let progressSum = 0;
  for (const task of tasks) {
    if (task.status === 'completed') {
      stats.completed += 1;
      progressSum += 100;
    } else if (task.status === 'failed') {
      stats.failed += 1;
    } else if (task.status === 'canceled') {
      stats.canceled += 1;
    } else if (task.status === 'downloading' || task.status === 'processing') {
      stats.active += 1;
      progressSum += Math.min(100, task.progress.percent);
      stats.speed += task.progress.speed;
    } else {
      stats.queued += 1;
    }
  }
  stats.percent = stats.total > 0 ? Math.min(100, progressSum / stats.total) : 0;
  return stats;
}

export function batchStats(batch: Batch): BatchStats {
  return statsOf(batchTasks(batch));
}

export function globalStats(): BatchStats {
  return statsOf(Object.values(state.tasks));
}

export function isActiveStatus(status: TaskStatus): boolean {
  return status === 'queued' || status === 'downloading' || status === 'processing';
}

export const STATUS_TEXT: Record<TaskStatus, string> = {
  queued: '排队中',
  downloading: '下载中',
  processing: '后处理中',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
};
