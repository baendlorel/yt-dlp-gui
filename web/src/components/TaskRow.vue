<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from './AppIcon.vue';
import { api } from '../api';
import { pct, formatBytes, formatDuration, formatEta, formatSpeed, fileNameOf } from '../format';
import { STATUS_TEXT, isActiveStatus, toast } from '../store';
import type { Task } from '../types';

const props = defineProps<{ task: Task }>();

const busy = ref(false);
const thumbError = ref(false);

const active = computed(() => isActiveStatus(props.task.status));
const percent = computed(() =>
  props.task.status === 'completed' ? 100 : Math.min(100, Math.max(0, props.task.progress.percent)),
);
const indeterminate = computed(
  () => props.task.status === 'downloading' && percent.value <= 0.05 && props.task.progress.totalBytes === 0,
);

const progressText = computed(() => {
  const task = props.task;
  switch (task.status) {
    case 'queued':
      return '等待下载';
    case 'downloading': {
      const speed = formatSpeed(task.progress.speed);
      const size = task.progress.totalBytes
        ? `${formatBytes(task.progress.downloadedBytes)} / ${formatBytes(task.progress.totalBytes)}`
        : formatBytes(task.progress.downloadedBytes);
      const stream = task.progress.stream && task.progress.stream > 1 ? `第 ${task.progress.stream} 段` : '';
      return [stream, pct(percent.value), speed, size].filter(Boolean).join(' · ');
    }
    case 'processing':
      return '后处理中（合并音视频）…';
    case 'completed':
      return task.progress.totalBytes ? formatBytes(task.progress.totalBytes) : '已完成';
    case 'failed':
      return '下载失败';
    case 'canceled':
      return '已取消';
    default:
      return '';
  }
});

const etaText = computed(() => {
  if (props.task.status !== 'downloading' || !props.task.progress.eta) return '';
  return formatEta(props.task.progress.eta);
});

const progressClass = computed(() => ({
  completed: props.task.status === 'completed',
  failed: props.task.status === 'failed',
  canceled: props.task.status === 'canceled',
  indeterminate: indeterminate.value,
}));

const subtitle = computed(() => {
  const parts: string[] = [];
  if (props.task.uploader) parts.push(props.task.uploader);
  if (props.task.playlistTitle) parts.push(props.task.playlistTitle);
  if (props.task.playlistIndex) parts.push(`P${props.task.playlistIndex}`);
  if (props.task.duration) parts.push(formatDuration(props.task.duration));
  if (props.task.status === 'completed' && props.task.filePath) parts.push(fileNameOf(props.task.filePath));
  return parts;
});

async function run(action: () => Promise<unknown>, message?: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await action();
    if (message) toast(message, 'success');
  } catch (error) {
    toast(error instanceof Error ? error.message : '操作失败', 'error');
  } finally {
    busy.value = false;
  }
}

function cancel(): void {
  void run(() => api.cancelTask(props.task.id));
}

function retry(): void {
  void run(() => api.retryTask(props.task.id), '已重新加入队列');
}

function reveal(): void {
  void run(() => api.revealTask(props.task.id));
}

function remove(): void {
  if (!window.confirm('仅移除任务记录，不会删除已下载的文件。确定继续？')) return;
  void run(() => api.deleteTask(props.task.id));
}
</script>

<template>
  <div class="task">
    <div class="task-thumb">
      <img
        v-if="task.thumbnail && !thumbError"
        :src="task.thumbnail"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        @error="thumbError = true"
      />
      <AppIcon v-else name="film" :size="17" />
    </div>

    <div class="task-main">
      <div class="task-title" :title="task.title">{{ task.title }}</div>
      <div class="task-sub">
        <span class="badge" :class="{ generic: task.providerId !== 'bilibili' }">{{ task.providerLabel }}</span>
        <span v-for="(part, index) in subtitle" :key="index" class="truncate" :title="part">{{ part }}</span>
        <span
          class="status-pill"
          :data-status="task.status"
          :title="task.error ?? ''"
          style="margin-left: auto"
        >
          {{ STATUS_TEXT[task.status] }}
        </span>
      </div>
      <div class="task-progress-row">
        <div class="progress" :class="progressClass">
          <div class="progress-fill" :style="{ width: `${percent}%` }"></div>
        </div>
        <span class="task-progress-text">{{ progressText }}</span>
        <span v-if="etaText" class="task-progress-text" style="min-width: 0">{{ etaText }}</span>
      </div>
    </div>

    <div class="task-actions">
      <button v-if="active" class="icon-btn danger" type="button" title="取消下载" :disabled="busy" @click="cancel">
        <AppIcon name="stop" :size="15" />
      </button>
      <button
        v-else-if="task.status === 'failed' || task.status === 'canceled'"
        class="icon-btn"
        type="button"
        title="重试"
        :disabled="busy"
        @click="retry"
      >
        <AppIcon name="refresh" :size="15" />
      </button>
      <button
        v-else-if="task.status === 'completed'"
        class="icon-btn"
        type="button"
        title="在文件夹中显示"
        :disabled="busy"
        @click="reveal"
      >
        <AppIcon name="folder" :size="15" />
      </button>
      <button class="icon-btn danger" type="button" title="移除记录" :disabled="busy" @click="remove">
        <AppIcon name="trash" :size="15" />
      </button>
    </div>

    <div v-if="task.status === 'failed' && task.error" class="task-error" :title="task.errorDetail ?? ''">
      {{ task.error }}
      <span v-if="task.errorDetail" class="mono">失败详情已记录，重试前可先在设置中检查登录 / ffmpeg</span>
    </div>
  </div>
</template>
