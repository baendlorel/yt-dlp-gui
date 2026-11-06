<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AppIcon from './components/AppIcon.vue';
import BatchCard from './components/BatchCard.vue';
import Composer from './components/Composer.vue';
import SettingsModal from './components/SettingsModal.vue';
import ToastHost from './components/ToastHost.vue';
import { api } from './api';
import { bootstrap, globalStats, refreshState, state, toast } from './store';
import { formatSpeed } from './format';

const settingsOpen = ref(false);
const clearing = ref(false);

const batches = computed(() => [...state.batches].sort((a, b) => b.createdAt - a.createdAt));
const stats = computed(() => globalStats());
const finishedCount = computed(() => stats.value.completed + stats.value.failed + stats.value.canceled);

onMounted(() => {
  void bootstrap();
});

async function clearFinished(): Promise<void> {
  if (!window.confirm('清空所有已完成 / 失败 / 已取消的任务记录？已下载的文件不会删除。')) return;
  clearing.value = true;
  try {
    const { removed } = await api.clearFinished();
    await refreshState();
    toast(removed > 0 ? `已清理 ${removed} 条记录` : '没有可清理的记录', 'info');
  } catch (error) {
    toast(error instanceof Error ? error.message : '清理失败', 'error');
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div class="app-shell">
    <AppHeader @open-settings="settingsOpen = true" />

    <div v-if="state.system && !state.system.ok" class="warning-box error setup-banner">
      <AppIcon name="alert" :size="16" style="flex: none; margin-top: 2px" />
      <div>
        <strong>下载引擎未就绪。</strong>
        {{ state.system.error }}
        <button class="link-btn" type="button" style="margin-left: 6px" @click="settingsOpen = true">
          打开设置检查路径
        </button>
      </div>
    </div>

    <main class="layout">
      <Composer />

      <section class="queue-panel">
        <div class="section-head">
          <h2>
            下载队列
            <span v-if="batches.length" class="queue-count">{{ batches.length }}</span>
          </h2>
          <div class="queue-actions">
            <span v-if="stats.active > 0" class="queue-summary">
              {{ stats.active }} 个下载中
              <template v-if="stats.speed > 0"> · {{ formatSpeed(stats.speed) }}</template>
            </span>
            <span v-else-if="state.ready && stats.total > 0" class="queue-summary">
              {{ stats.completed }} / {{ stats.total }} 已完成
            </span>
            <button
              class="btn btn-sm btn-ghost"
              type="button"
              :disabled="clearing || finishedCount === 0"
              @click="clearFinished"
            >
              清空已完成
            </button>
          </div>
        </div>

        <div v-if="!state.ready" class="card skeleton">正在连接后端…</div>

        <div v-else-if="batches.length === 0" class="empty-state">
          <div class="empty-icon">
            <AppIcon name="download" :size="22" />
          </div>
          <h3>还没有下载任务</h3>
          <p>
            在上方粘贴一个或多个 B 站链接（支持 BV/av、b23.tv、番剧、收藏夹、UP 主合集），
            选择画质后「加入队列」。也可以先「预览并挑选」，按单集精确下载。
          </p>
        </div>

        <template v-else>
          <BatchCard v-for="batch in batches" :key="batch.id" :batch="batch" />
        </template>
      </section>
    </main>

    <SettingsModal v-if="settingsOpen" @close="settingsOpen = false" />
    <ToastHost />
  </div>
</template>
