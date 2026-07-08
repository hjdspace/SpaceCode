<template>
  <div class="design-page">
    <header class="design-header">
      <div class="header-left">
        <Palette :size="18" />
        <h1>{{ t('design.title') }}</h1>
        <span v-if="lastUsage" class="usage-bar">
          {{ t('design.usage.tokens', { input: lastUsage.inputTokens, output: lastUsage.outputTokens }) }}
        </span>
      </div>
      <div class="header-right">
        <button v-if="isLoading" class="btn-stop" @click="stopDesignGeneration">
          <Square :size="12" /> {{ t('common.stop') }}
        </button>
      </div>
    </header>
    <DesignSplitView>
      <template #left><DesignChatPane /></template>
      <template #right><DesignFileWorkspace /></template>
    </DesignSplitView>
    <ToastNotification />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Palette, Square } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { useTurnStore } from '@/stores/chat'
import { useDesignSession } from '@/composables/useDesignSession'
import DesignSplitView from './DesignSplitView.vue'
import DesignChatPane from './DesignChatPane.vue'
import DesignFileWorkspace from './DesignFileWorkspace.vue'
import ToastNotification from '@/components/common/ToastNotification.vue'

const { t } = useI18n()
const designStore = useDesignStore()
const turnStore = useTurnStore()
const { lastUsage, activeSessionId } = storeToRefs(designStore)
const { stopDesignGeneration } = useDesignSession()

// 复用 chatStream 的 loading 状态
const isLoading = computed(() =>
  activeSessionId.value ? turnStore.getIsLoading(activeSessionId.value) : false
)
</script>

<style scoped lang="scss">
.design-page { display: flex; flex-direction: column; height: 100%; background: var(--bg-primary); }
.design-header { display: flex; align-items: center; justify-content: space-between; height: 48px; padding: 0 16px; border-bottom: 1px solid var(--surface-border); background: var(--bg-secondary); }
.header-left { display: flex; align-items: center; gap: 8px; h1 { font-size: 14px; font-weight: 600; } }
.usage-bar { font-size: 11px; color: var(--text-muted); margin-left: 12px; }
.btn-stop { background: #ef4444; color: white; border: none; border-radius: var(--radius-sm); padding: 4px 10px; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 4px; }
</style>
