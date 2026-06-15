<template>
  <div class="trace-viewer" role="region" :aria-label="t('trace.title')">
    <Transition name="view-slide" mode="out-in">
      <TraceListPage
        v-if="!selectedSessionId"
        key="list"
        @select-session="handleSelectSession"
      />
      <TraceSessionPage
        v-else
        key="session"
        :session-id="selectedSessionId"
        @back="selectedSessionId = null"
      />
    </Transition>
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

.view-slide-enter-active,
.view-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.view-slide-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.view-slide-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}
</style>
