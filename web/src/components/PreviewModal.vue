<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import AppIcon from './AppIcon.vue';
import { api } from '../api';
import { toast } from '../store';
import { formatDuration } from '../format';
import type { DownloadOptions, MediaItem, PreviewGroup } from '../types';

const props = defineProps<{
  groups: PreviewGroup[];
  options: DownloadOptions;
  cookie?: string;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'queued', count: number): void;
}>();

const selected = reactive<Record<string, boolean>>({});
const submitting = ref(false);

const allItems = computed<MediaItem[]>(() => props.groups.flatMap((group) => group.items));
const totalCount = computed(() => allItems.value.length);
const selectedItems = computed(() => allItems.value.filter((item) => selected[item.url]));
const selectedCount = computed(() => selectedItems.value.length);
const allSelected = computed(() => totalCount.value > 0 && selectedCount.value === totalCount.value);

for (const item of allItems.value) selected[item.url] = true;

function groupItems(group: PreviewGroup): MediaItem[] {
  return group.items;
}

function groupSelected(group: PreviewGroup): number {
  return group.items.filter((item) => selected[item.url]).length;
}

function toggleGroup(group: PreviewGroup, checked: boolean): void {
  for (const item of group.items) selected[item.url] = checked;
}

function toggleAll(): void {
  const next = !allSelected.value;
  for (const item of allItems.value) selected[item.url] = next;
}

function close(): void {
  emit('close');
}

async function queueSelected(): Promise<void> {
  if (selectedItems.value.length === 0) {
    toast('请至少选择一条', 'error');
    return;
  }
  submitting.value = true;
  try {
    const cookie = props.cookie?.trim();
    await api.createBatch({
      items: selectedItems.value.map((item) => ({ ...item })),
      options: props.options,
      ...(cookie ? { cookie } : {}),
    });
    emit('queued', selectedItems.value.length);
  } catch (error) {
    toast(error instanceof Error ? error.message : '提交失败', 'error');
  } finally {
    submitting.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="modal-backdrop" @click.self="close">
    <div class="modal wide" role="dialog" aria-modal="true" aria-label="解析结果">
      <div class="modal-head">
        <div>
          <h2>解析结果</h2>
          <p>勾选需要下载的条目，确认后直接进入下载队列</p>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭" @click="close">
          <AppIcon name="close" />
        </button>
      </div>

      <div class="modal-body">
        <div class="preview-summary">
          <span>共 {{ totalCount }} 个条目 · 已选 {{ selectedCount }} 个</span>
          <button class="link-btn" type="button" @click="toggleAll">
            {{ allSelected ? '全部取消' : '全选' }}
          </button>
        </div>

        <div v-if="groups.length === 0" class="preview-empty">没有解析结果</div>

        <div v-for="(group, index) in groups" :key="`${group.input}-${index}`" class="preview-group">
          <div class="preview-group-head">
            <label class="preview-group-title truncate" :title="group.input">
              <input
                v-if="group.items.length"
                type="checkbox"
                :checked="groupSelected(group) === group.items.length"
                style="margin-right: 8px; vertical-align: -2px"
                @change="toggleGroup(group, ($event.target as HTMLInputElement).checked)"
              />
              {{ group.playlistTitle || group.providerLabel }}
              <span class="muted">
                · {{ group.items.length }} 条
                <template v-if="group.truncated">（已截断）</template>
              </span>
            </label>
            <span class="status-pill" data-status="queued">{{ group.providerLabel }}</span>
          </div>

          <div v-if="group.error" class="preview-group-error">
            <AppIcon name="alert" :size="14" style="vertical-align: -3px; margin-right: 6px" />
            {{ group.error }}
            <div class="muted" style="margin-top: 4px; word-break: break-all">{{ group.input }}</div>
          </div>

          <div v-else class="preview-items">
            <label
              v-for="item in group.items"
              :key="`${item.url}-${item.id ?? ''}`"
              class="preview-item"
              :title="item.title"
            >
              <input v-model="selected[item.url]" type="checkbox" />
              <img
                v-if="item.thumbnail"
                class="preview-thumb"
                :src="item.thumbnail"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
              />
              <span v-else class="preview-thumb" style="display: grid; place-items: center">
                <AppIcon name="film" :size="16" />
              </span>
              <span style="min-width: 0">
                <span class="preview-title" style="display: block">{{ item.title || item.url }}</span>
                <span class="preview-sub" style="display: block">
                  {{ item.uploader || group.input }}
                </span>
              </span>
              <span class="preview-duration">{{ formatDuration(item.duration) }}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <span class="muted" style="font-size: 12px">{{ selectedCount }} / {{ totalCount }}</span>
        <span class="spacer"></span>
        <button class="btn btn-ghost" type="button" @click="close">取消</button>
        <button
          class="btn btn-primary"
          type="button"
          :disabled="submitting || selectedCount === 0"
          @click="queueSelected"
        >
          <AppIcon name="download" :size="16" />
          {{ submitting ? '提交中…' : `下载选中（${selectedCount}）` }}
        </button>
      </div>
    </div>
  </div>
</template>
