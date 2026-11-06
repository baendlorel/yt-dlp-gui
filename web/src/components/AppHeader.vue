<script setup lang="ts">
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';
import { state } from '../store';

defineEmits<{ (event: 'open-settings'): void }>();

const engineLabel = computed(() => {
  const system = state.system;
  if (!system) return '引擎检测中';
  if (!system.ok || !system.ytdlp) return 'yt-dlp 未就绪';
  return `yt-dlp ${system.ytdlp.version}`;
});

const ffmpegLabel = computed(() => {
  if (!state.system) return 'ffmpeg 检测中';
  return state.system.ffmpeg ? `ffmpeg ${state.system.ffmpeg.version}` : '缺少 ffmpeg';
});

const engineBad = computed(() => Boolean(state.system && (!state.system.ok || !state.system.ytdlp)));
const ffmpegBad = computed(() => Boolean(state.system && !state.system.ffmpeg));
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <div class="brand-mark">
        <AppIcon name="play" :size="20" />
      </div>
      <div class="brand-text">
        <h1>BiliFlow</h1>
        <p>yt-dlp 批量下载工作台 · B 站优先</p>
      </div>
    </div>

    <div class="header-actions">
      <span class="status-chip" :class="{ bad: engineBad }" :title="state.system?.ytdlp?.file ?? ''">
        <span class="dot"></span>
        {{ engineLabel }}
      </span>
      <span
        class="status-chip hide-sm"
        :class="{ warn: ffmpegBad }"
        :title="state.system?.ffmpeg?.path ?? '高清视频需要 ffmpeg 合并音视频'"
      >
        <span class="dot"></span>
        {{ ffmpegLabel }}
      </span>
      <span class="status-chip hide-sm" :class="{ warn: !state.online }">
        <span class="dot"></span>
        {{ state.online ? '实时连接' : '连接中断' }}
      </span>
      <button class="btn btn-ghost" type="button" @click="$emit('open-settings')">
        <AppIcon name="settings" :size="16" />
        <span>设置</span>
      </button>
    </div>
  </header>
</template>
