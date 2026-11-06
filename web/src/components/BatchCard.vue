<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from './AppIcon.vue';
import TaskRow from './TaskRow.vue';
import { api } from '../api';
import { formatTime, pct } from '../format';
import { batchStats, batchTasks, toast } from '../store';
import type { Batch } from '../types';

const props = defineProps<{ batch: Batch }>();

const collapsed = ref(false);
const busy = ref(false);

const tasks = computed(() => batchTasks(props.batch));
const stats = computed(() => batchStats(props.batch));
const firstTask = computed(() => tasks.value[0]);

const title = computed(() => {
  if (firstTask.value?.playlistTitle) return firstTask.value.playlistTitle;
  if (firstTask.value) return `${firstTask.value.providerLabel} · 批量任务`;
  return '批量任务';
});

const aggregate = computed(() => {
  const batch = props.batch;
  if (batch.canceled) return { text: '已取消', status: 'canceled' as const };
  if (batch.resolving) return { text: '解析中', status: 'downloading' as const };
  if (stats.value.active > 0) return { text: '下载中', status: 'downloading' as const };
  if (stats.value.queued > 0) return { text: '排队中', status: 'queued' as const };
  if (stats.value.total > 0 && stats.value.completed === stats.value.total) {
    return { text: '已完成', status: 'completed' as const };
  }
  if (stats.value.failed > 0 && stats.value.failed === stats.value.total) {
    return { text: '全部失败', status: 'failed' as const };
  }
  if (stats.value.failed > 0) return { text: '部分失败', status: 'failed' as const };
  if (stats.value.canceled > 0 && stats.value.canceled === stats.value.total) {
    return { text: '已取消', status: 'canceled' as const };
  }
  if (stats.value.canceled > 0) return { text: '部分取消', status: 'canceled' as const };
  if (batch.errors.length > 0) return { text: '解析失败', status: 'failed' as const };
  return { text: '等待中', status: 'queued' as const };
});

const progressLabel = computed(() => {
  if (props.batch.resolving) return `${stats.value.total} 个已解析`;
  if (stats.value.total === 0) return '—';
  const parts = [`${stats.value.completed}/${stats.value.total}`];
  if (stats.value.failed > 0) parts.push(`${stats.value.failed} 失败`);
  if (stats.value.canceled > 0) parts.push(`${stats.value.canceled} 取消`);
  parts.push(pct(stats.value.percent));
  return parts.join(' · ');
});

const canCancel = computed(
  () => !props.batch.canceled && (props.batch.resolving || stats.value.active > 0 || stats.value.queued > 0),
);

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

function cancelBatch(): void {
  if (!window.confirm('取消该批次中所有排队与进行中的任务？')) return;
  void run(() => api.cancelBatch(props.batch.id), '已取消该批次');
}

function retryFailed(): void {
  void run(async () => {
    const { count } = await api.retryFailed(props.batch.id);
    toast(count > 0 ? `已重试 ${count} 个任务` : '没有可重试的任务', count > 0 ? 'success' : 'info');
  });
}

function removeBatch(): void {
  if (!window.confirm('移除该批次及其任务记录？已下载的文件不会删除。')) return;
  void run(() => api.deleteBatch(props.batch.id), '批次已移除');
}
</script>

<template>
  <article class="batch" :class="{ collapsed }">
    <div class="batch-head">
      <div style="min-width: 0">
        <div class="batch-title-row">
          <span class="status-pill" :data-status="aggregate.status">{{ aggregate.text }}</span>
          <span class="batch-title" :title="title">{{ title }}</span>
          <span class="batch-meta">
            <span>{{ formatTime(batch.createdAt) }}</span>
            <span class="sep">·</span>
            <span>{{ batch.inputs.length }} 个链接</span>
            <span v-if="stats.total > 0" class="sep">·</span>
            <span v-if="stats.total > 0">{{ stats.total }} 个任务</span>
          </span>
        </div>
        <div class="batch-progress">
          <div class="progress" :class="{ indeterminate: batch.resolving || (stats.active > 0 && stats.percent === 0) }">
            <div class="progress-fill" :style="{ width: `${stats.percent}%` }"></div>
          </div>
          <span class="batch-progress-text">{{ progressLabel }}</span>
        </div>
      </div>

      <div class="batch-actions">
        <button v-if="canCancel" class="btn btn-sm btn-ghost" type="button" :disabled="busy" @click="cancelBatch">
          <AppIcon name="stop" :size="13" />
          取消
        </button>
        <button
          v-if="stats.failed > 0 || stats.canceled > 0"
          class="btn btn-sm btn-ghost"
          type="button"
          :disabled="busy"
          @click="retryFailed"
        >
          <AppIcon name="refresh" :size="13" />
          重试失败
        </button>
        <button class="icon-btn danger" type="button" title="移除批次" :disabled="busy" @click="removeBatch">
          <AppIcon name="trash" :size="15" />
        </button>
        <button
          class="icon-btn"
          type="button"
          :title="collapsed ? '展开' : '收起'"
          @click="collapsed = !collapsed"
        >
          <AppIcon name="chevron-down" :size="15" :style="{ transform: collapsed ? 'rotate(-90deg)' : 'none' }" />
        </button>
      </div>
    </div>

    <div v-if="batch.errors.length" class="batch-errors">
      <div v-for="(error, index) in batch.errors" :key="index" class="batch-error">
        <AppIcon name="alert" :size="13" style="flex: none; margin-top: 1px" />
        <span>
          <template v-if="error.input">{{ error.input }}：</template>{{ error.message }}
        </span>
      </div>
    </div>

    <div class="batch-body">
      <div v-if="tasks.length === 0" class="batch-empty">
        <template v-if="batch.resolving">正在解析链接，请稍候…</template>
        <template v-else-if="batch.canceled">批次已取消</template>
        <template v-else>没有解析到可下载的条目</template>
      </div>
      <TaskRow v-for="task in tasks" :key="task.id" :task="task" />
    </div>
  </article>
</template>
