<script setup lang="ts">
import { computed } from 'vue';

export type IconName =
  | 'settings'
  | 'close'
  | 'trash'
  | 'folder'
  | 'refresh'
  | 'download'
  | 'alert'
  | 'check'
  | 'chevron-down'
  | 'play'
  | 'link'
  | 'sparkles'
  | 'eye'
  | 'stop'
  | 'clock'
  | 'film'
  | 'external'
  | 'plus';

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 18 });

const ICONS: Record<IconName, string[]> = {
  settings: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  ],
  close: ['M18 6 6 18M6 6l12 12'],
  trash: [
    'M4 7h16',
    'M10 11v6M14 11v6',
    'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12',
    'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
  ],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'],
  refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 4v5h-5'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  alert: ['M12 9v4M12 17h.01', 'M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z'],
  check: ['m20 6-11 11-5-5'],
  'chevron-down': ['m6 9 6 6 6-6'],
  play: ['m9 6 9 6-9 6V6Z'],
  link: [
    'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7',
    'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  ],
  sparkles: ['m12 3 1.9 5.8L20 10l-5.1 3.2L16 19l-4-3-4 3 1.1-5.8L4 10l6.1-1.2L12 3Z'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  stop: ['M7 7h10v10H7z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  film: ['M4 5h16v14H4z', 'M4 9h16M4 15h16M8 5v14M16 5v14'],
  external: ['M14 4h6v6M20 4l-9 9', 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5'],
  plus: ['M12 5v14M5 12h14'],
};

const paths = computed(() => ICONS[props.name] ?? ICONS.link);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>
