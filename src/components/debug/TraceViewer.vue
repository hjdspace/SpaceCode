<template>
  <div class="trace-viewer" role="region" :aria-label="t('trace.title')">
    <!-- cc-haha 复刻：Trace 列表 + Trace 会话详情 双视图 -->
    <TraceListPage
      v-if="!selectedSessionId"
      @select-session="handleSelectSession"
    />
    <TraceSessionPage
      v-else
      :session-id="selectedSessionId"
      @back="selectedSessionId = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import TraceListPage from './TraceListPage.vue'
import TraceSessionPage from './TraceSessionPage.vue'

const { t } = useI18n()
const appStore = useAppStore()
const selectedSessionId = ref<string | null>(null)

function handleSelectSession(sessionId: string) {
  selectedSessionId.value = sessionId
}
</script>

<style lang="scss" scoped>
.trace-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  overscroll-behavior: contain;
}
</style>
