<template>
  <div class="factory-view">
    <div v-if="!root" class="state-card">
      <Workflow :size="28" />
      <p>{{ t('factory.noProject') }}</p>
    </div>

    <div v-else-if="store.loading" class="state-card">
      <Loader2 :size="24" class="spin" />
      <p>{{ t('factory.loading') }}</p>
    </div>

    <div v-else-if="store.error" class="state-card">
      <AlertTriangle :size="26" />
      <p>{{ t('factory.loadFailed') }}</p>
      <button class="primary-btn" @click="store.refresh(root)">{{ t('factory.refresh') }}</button>
    </div>

    <template v-else>
      <div v-if="!store.configured" class="factory-empty">
        <div class="empty-icon"><Workflow :size="32" /></div>
        <h1>{{ t('factory.emptyTitle') }}</h1>
        <p>{{ t('factory.emptyDescription') }}</p>
        <button class="primary-btn" @click="store.openWizard(root)">
          {{ t('factory.init') }}
        </button>
      </div>

      <div v-else class="factory-board-shell">
        <header class="board-header">
          <div>
            <h1>{{ t('factory.boardTitle') }}</h1>
            <p>{{ t('factory.boardDescription') }}</p>
          </div>
          <button class="ghost-btn" @click="store.openWizard(root)">
            {{ t('factory.reconfigure') }}
          </button>
        </header>
        <div class="board-meta">
          <span>{{ t('factory.configPath') }}</span>
          <code>{{ store.configPath }}</code>
        </div>
        <div class="board-placeholder">
          <Workflow :size="28" />
        </div>
      </div>
    </template>

    <FactorySetupWizard v-if="store.wizardOpen && root" :root="root" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Workflow, AlertTriangle, Loader2 } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useFactoryStore } from '@/stores/factory'
import FactorySetupWizard from './FactorySetupWizard.vue'

const { t } = useI18n()
const appStore = useAppStore()
const store = useFactoryStore()

const root = computed(() => (appStore.projectRoot || '').trim())

onMounted(() => {
  if (root.value) void store.refresh(root.value)
})

watch(root, (value, previous) => {
  if (value === previous) return
  store.reset()
  if (value) void store.refresh(value)
})
</script>

<style lang="scss" scoped>
.factory-view {
  position: relative;
  height: 100%;
  overflow-y: auto;
  padding: 24px;
  background: var(--bg-secondary, #1a1a2e);
  @include scrollbar-overlay;
}

.state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;

  p {
    margin: 0;
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.factory-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 100%;
  max-width: 460px;
  margin: 0 auto;
  text-align: center;

  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }

  p {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--text-muted);
  }
}

.empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: var(--radius-lg, 12px);
  background: var(--surface-glass);
  color: var(--accent-primary);
}

.factory-board-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.board-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;

  h1 {
    margin: 0 0 4px;
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary);
  }

  p {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
  }
}

.board-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);

  code {
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: var(--surface-glass);
    color: var(--text-secondary);
  }
}

.board-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 240px;
  border: 1px dashed var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  color: var(--text-muted);
}

.primary-btn,
.ghost-btn {
  padding: 8px 18px;
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  cursor: pointer;
}

.primary-btn {
  border: 1px solid var(--accent-primary);
  background: var(--accent-primary);
  color: #fff;
}

.ghost-btn {
  border: 1px solid var(--surface-border);
  background: transparent;
  color: var(--text-primary);

  &:hover {
    border-color: var(--accent-primary);
  }
}
</style>
