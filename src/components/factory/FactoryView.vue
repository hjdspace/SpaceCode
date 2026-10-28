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

        <FactoryRunHeader v-if="store.run" :run="store.run" :tasks="store.tasks" @select="store.selectTask" />
        <div v-else class="run-empty">{{ t('factory.run.empty') }}</div>

        <div class="factory-columns">
          <FactoryBacklogPanel
            :items="store.backlog"
            :loading="store.backlogLoading"
            :error="store.backlogError"
            :run-error="store.createRunError"
            :claimed-ids="claimedIds"
            :creating="store.creatingRun"
            :run-id="store.run?.id ?? null"
            @create="handleCreate"
            @update="handleUpdate"
            @remove="handleRemove"
            @move="handleMove"
            @create-run="handleCreateRun"
          />

          <div class="board-column">
            <div v-if="store.runLoading" class="state-inline">
              <Loader2 :size="18" class="spin" />
              <span>{{ t('factory.loading') }}</span>
            </div>
            <div v-else-if="store.runError" class="state-inline error">
              <AlertTriangle :size="18" />
              <span>{{ t('factory.run.loadFailed') }}</span>
            </div>
            <FactoryBoard
              v-else-if="store.run"
              :tasks="store.tasks"
              :selected-id="store.selectedId"
              @select="store.selectTask"
            />
            <div v-else class="board-empty" data-board-empty>{{ t('factory.run.empty') }}</div>
          </div>

          <FactoryInspector
            v-if="store.run"
            :task="store.selectedTask"
            :tab="store.inspectorTab"
            @select-tab="store.setInspectorTab"
          />
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
import FactoryRunHeader from './FactoryRunHeader.vue'
import FactoryBoard from './FactoryBoard.vue'
import FactoryInspector from './FactoryInspector.vue'
import FactoryBacklogPanel from './FactoryBacklogPanel.vue'

const { t } = useI18n()
const appStore = useAppStore()
const store = useFactoryStore()

const root = computed(() => (appStore.projectRoot || '').trim())

/** 未结束的运行仍占着这些待办；停止后才能重新领取。 */
const claimedIds = computed(() => {
  if (!store.run || store.run.status === 'stopped') return []
  return store.tasks.map((task) => task.id)
})

async function loadBoard(value: string): Promise<void> {
  await Promise.all([store.loadBacklog(value), store.loadRun(value)])
}

onMounted(async () => {
  if (!root.value) return
  await store.refresh(root.value)
  await loadBoard(root.value)
})

watch(root, async (value, previous) => {
  if (value === previous) return
  store.reset()
  if (!value) return
  await store.refresh(value)
  await loadBoard(value)
})

function handleCreate(input: { title: string; goal: string }): void {
  if (root.value) void store.createBacklogTask(root.value, input)
}

function handleUpdate(input: { id: string; title: string; goal: string }): void {
  if (root.value) void store.updateBacklogTask(root.value, input)
}

function handleRemove(id: string): void {
  if (root.value) void store.deleteBacklogTask(root.value, id)
}

function handleMove(id: string, direction: 'up' | 'down'): void {
  if (root.value) void store.moveBacklogTask(root.value, id, direction)
}

function handleCreateRun(ids: string[]): void {
  if (root.value) void store.createRun(root.value, ids)
}
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
  gap: 12px;
  height: 100%;
  min-height: 0;
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

.run-empty {
  padding: 10px 14px;
  border: 1px dashed var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  color: var(--text-muted);
  font-size: 12px;
}

.factory-columns {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(0, 1fr) minmax(260px, 320px);
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow-x: auto;
  @include scrollbar-overlay;
}

.board-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  @include scrollbar-overlay;
}

.state-inline {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
  color: var(--text-muted);
  font-size: 12px;

  &.error {
    color: var(--error);
  }
}

.board-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 200px;
  border: 1px dashed var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  color: var(--text-muted);
  font-size: 12px;
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
