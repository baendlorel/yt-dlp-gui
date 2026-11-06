<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import PreviewModal from './PreviewModal.vue';
import { api } from '../api';
import { state, toast } from '../store';
import type { DownloadOptions, PreviewGroup } from '../types';

const STORAGE_KEY = 'ytdlp-gui.options.v1';
const DEFAULTS: DownloadOptions = {
  quality: 'max',
  codec: 'h264',
  audioFormat: 'm4a',
  subtitles: false,
  danmaku: false,
  thumbnail: false,
  metadata: false,
  expandPlaylist: true,
  maxItems: 300,
};

function loadOptions(): DownloadOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<DownloadOptions> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

const saved = loadOptions();
const urlsText = ref('');
const quality = ref<DownloadOptions['quality']>(saved.quality);
const codec = ref<DownloadOptions['codec']>(saved.codec);
const audioFormat = ref<DownloadOptions['audioFormat']>(saved.audioFormat);
const expandPlaylist = ref(saved.expandPlaylist);
const subtitles = ref(saved.subtitles);
const danmaku = ref(saved.danmaku ?? false);
const thumbnail = ref(saved.thumbnail);
const metadata = ref(saved.metadata);
const batchCookie = ref('');
const showCookie = ref(false);

const submitting = ref(false);
const resolving = ref(false);
const previewOpen = ref(false);
const previewGroups = ref<PreviewGroup[]>([]);

const lines = computed(() =>
  urlsText.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0),
);

const options = computed<DownloadOptions>(() => ({
  quality: quality.value,
  codec: codec.value,
  audioFormat: audioFormat.value,
  subtitles: subtitles.value,
  danmaku: danmaku.value,
  thumbnail: thumbnail.value,
  metadata: metadata.value,
  expandPlaylist: expandPlaylist.value,
  maxItems: state.settings?.maxPlaylistItems ?? 300,
}));

watch([quality, codec, audioFormat, expandPlaylist, subtitles, danmaku, thumbnail, metadata], () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options.value));
  } catch {
    /* 隐私模式下忽略 */
  }
});

async function submit(): Promise<void> {
  if (lines.value.length === 0) {
    toast('请先粘贴至少一个链接', 'error');
    return;
  }
  submitting.value = true;
  try {
    const cookie = batchCookie.value.trim();
    const { batch } = await api.createBatch({
      urls: lines.value,
      options: options.value,
      ...(cookie ? { cookie } : {}),
    });
    urlsText.value = '';
    toast(
      batch.resolving
        ? `已创建批次，正在解析 ${batch.inputs.length} 个链接…`
        : `已加入队列，共 ${batch.taskIds.length} 个任务`,
      'success',
    );
  } catch (error) {
    toast(error instanceof Error ? error.message : '提交失败', 'error');
  } finally {
    submitting.value = false;
  }
}

async function openPreview(): Promise<void> {
  if (lines.value.length === 0) {
    toast('请先粘贴至少一个链接', 'error');
    return;
  }
  resolving.value = true;
  try {
    const cookie = batchCookie.value.trim();
    const { groups } = await api.preview(
      lines.value,
      state.settings?.maxPlaylistItems ?? 300,
      cookie || undefined,
    );
    previewGroups.value = groups;
    previewOpen.value = true;
    const failed = groups.filter((group) => group.error).length;
    if (failed > 0) toast(`${failed} 个链接解析失败，详情见预览面板`, 'info');
  } catch (error) {
    toast(error instanceof Error ? error.message : '解析失败', 'error');
  } finally {
    resolving.value = false;
  }
}

function onQueued(count: number): void {
  previewOpen.value = false;
  urlsText.value = '';
  toast(`已加入 ${count} 个下载任务`, 'success');
}

function fillExample(): void {
  urlsText.value = 'https://www.bilibili.com/video/BV1GJ411x7h7';
}
</script>

<template>
  <section class="card composer">
    <textarea
      v-model="urlsText"
      spellcheck="false"
      placeholder="每行粘贴一个链接，支持批量提交，例如：&#10;https://www.bilibili.com/video/BV1GJ411x7h7&#10;https://b23.tv/xxxxxxx&#10;https://space.bilibili.com/2/favlist?fid=..."
      @keydown.ctrl.enter.prevent="submit"
      @keydown.meta.enter.prevent="submit"
    ></textarea>

    <div class="composer-hint">
      <span>
        每行一个链接 · 支持 BV/av、b23.tv 短链、番剧、课程、收藏夹、UP 主合集
        <button class="link-btn" type="button" @click="fillExample">填入示例</button>
      </span>
      <span>{{ lines.length }} 个链接 · Ctrl / ⌘ + Enter 提交</span>
    </div>

    <div class="composer-cookie">
      <div class="composer-cookie-label">
        <label for="batch-cookie">Cookie（可选）</label>
        <span>任意站点 · 当前页面复用</span>
      </div>
      <div class="composer-cookie-input">
        <input
          id="batch-cookie"
          v-model="batchCookie"
          class="input"
          :type="showCookie ? 'text' : 'password'"
          autocomplete="off"
          spellcheck="false"
          placeholder="粘贴 Cookie 或 cookies.txt 路径；B 站留空则使用设置中保存的登录信息"
        />
        <button class="btn btn-sm btn-ghost" type="button" @click="showCookie = !showCookie">
          {{ showCookie ? '隐藏' : '显示' }}
        </button>
        <button
          v-if="batchCookie"
          class="icon-btn"
          type="button"
          aria-label="清空 Cookie"
          @click="batchCookie = ''"
        >
          <AppIcon name="close" :size="14" />
        </button>
      </div>
      <p class="composer-cookie-hint">
        不同站点请分开提交；B 站留空则使用设置中的登录信息。也可以直接填浏览器导出的 cookies.txt 路径。
        只保存在当前页面内存，刷新后清空，可点 × 手动清除。
      </p>
    </div>

    <div class="composer-options">
      <div class="field">
        <label for="quality">画质</label>
        <select id="quality" v-model="quality" class="select">
          <option value="max">最高画质</option>
          <option value="2160">4K · 2160P</option>
          <option value="1440">2K · 1440P</option>
          <option value="1080">1080P</option>
          <option value="720">720P</option>
          <option value="480">480P</option>
          <option value="360">360P</option>
          <option value="audio">仅音频</option>
        </select>
      </div>

      <div v-if="quality !== 'audio'" class="field">
        <label for="codec">编码偏好</label>
        <select id="codec" v-model="codec" class="select">
          <option value="h264">H.264（兼容优先）</option>
          <option value="hevc">H.265 / HEVC</option>
          <option value="av1">AV1（体积小）</option>
          <option value="auto">自动</option>
        </select>
      </div>

      <div v-else class="field">
        <label for="audio-format">音频格式</label>
        <select id="audio-format" v-model="audioFormat" class="select">
          <option value="m4a">M4A（不转码）</option>
          <option value="mp3">MP3</option>
        </select>
      </div>

      <div class="checks">
        <label class="check" title="分 P 视频、合集、收藏夹会拆成多条任务">
          <input v-model="expandPlaylist" type="checkbox" />
          展开合集 / 分 P
        </label>
        <label class="check" title="B 站 CC / AI 字幕，需要登录后才有">
          <input v-model="subtitles" type="checkbox" />
          字幕
        </label>
        <label class="check" title="下载弹幕 XML，无需登录">
          <input v-model="danmaku" type="checkbox" />
          弹幕
        </label>
        <label class="check">
          <input v-model="thumbnail" type="checkbox" />
          封面
        </label>
        <label class="check">
          <input v-model="metadata" type="checkbox" />
          元数据
        </label>
      </div>

      <p v-if="subtitles" class="composer-option-hint">
        只下载 CC / AI 字幕轨。B 站需要有效登录 Cookie；视频本身没有字幕轨时不会生成文件。弹幕请勾选「弹幕」。
      </p>
      <p v-if="subtitles && !batchCookie.trim() && !state.settings?.hasCookie" class="composer-cookie-warning">
        当前没有 B 站登录 Cookie：B 站 CC / AI 字幕不会下载；弹幕不受影响。
      </p>

      <div class="composer-actions">
        <button class="btn btn-ghost" type="button" :disabled="resolving" @click="openPreview">
          <AppIcon name="eye" :size="16" :class="{ spin: resolving }" />
          {{ resolving ? '解析中…' : '预览并挑选' }}
        </button>
        <button class="btn btn-primary" type="button" :disabled="submitting || lines.length === 0" @click="submit">
          <AppIcon name="download" :size="16" />
          {{ submitting ? '提交中…' : '加入队列' }}
        </button>
      </div>
    </div>

    <PreviewModal
      v-if="previewOpen"
      :groups="previewGroups"
      :options="options"
      :cookie="batchCookie"
      @close="previewOpen = false"
      @queued="onQueued"
    />
  </section>
</template>
