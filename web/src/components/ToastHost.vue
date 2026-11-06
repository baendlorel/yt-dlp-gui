<script setup lang="ts">
import { state } from '../store';
</script>

<template>
  <div class="toasts" aria-live="polite" aria-atomic="false">
    <div v-for="item in state.toasts" :key="item.id" class="toast" :class="item.kind">
      <span class="toast-dot"></span>
      <span>{{ item.message }}</span>
    </div>
  </div>
</template>
