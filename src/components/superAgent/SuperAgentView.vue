<template>
  <div class="super-agent-view">
    <div class="super-agent-empty">
      <div class="empty-icon">
        <Sparkles :size="30" />
      </div>
      <h2>{{ t('superAgent.emptyTitle') }}</h2>
      <p>{{ t('superAgent.emptyHint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Sparkles } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useSuperAgentStore } from '@/stores/superAgent'

const { t } = useI18n()
const appStore = useAppStore()
const superAgentStore = useSuperAgentStore()

onMounted(async () => {
  const repoRoot = appStore.projectRoot
  if (!repoRoot) return
  await superAgentStore.bind(repoRoot)
  await superAgentStore.loadState(repoRoot)
})
</script>

<style scoped lang="scss">
.super-agent-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  overflow: auto;
  background: var(--bg-primary);
}

.super-agent-empty {
  max-width: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
}

.empty-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  color: var(--accent-primary);
  background: var(--surface-glass);
  border: 1px solid var(--border-subtle);
}

h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}
</style>
