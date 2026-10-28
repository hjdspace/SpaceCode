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

        <FactoryRunHeader
          v-if="store.run"
          :run="store.run"
          :tasks="store.tasks"
          @select="store.selectTask"
          @stop="handleStopRun"
        />
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
            :events="store.selectedEvents"
            :events-loading="store.eventsLoading"
            :events-error="store.eventsError"
            :action-error="store.actionError"
            :starting="store.startingId === store.selectedTask?.id"
            :stopping="store.stopping"
            :pending-dirty="store.pendingDirtyId === store.selectedTask?.id"
            :eligible="store.selectedEligibility.ok"
            :approving="store.approving"
            :fixing="store.fixing"
            :updating-comment="store.updatingComment"
            :pending-ignore-id="store.pendingIgnoreId"
            :merge-target="store.mergeTarget"
            :merging="store.merging"
            @select-tab="store.setInspectorTab"
            @start="handleStart"
            @stop="handleStopTask"
            @reveal="handleReveal"
            @confirm-dirty="handleConfirmDirty"
            @approve="handleApprove"
            @request-changes="handleRequestChanges"
            @fix="handleFix"
            @comment-accept="handleCommentAccept"
            @comment-ignore="handleCommentIgnore"
            @comment-confirm-ignore="handleCommentConfirmIgnore"
            @merge="handleOpenMerge"
          />
        </div>
      </div>
    </template>

    <FactoryMergeDialog
      v-if="store.mergeOpen && root"
      :task="mergeTask"
      :target="store.mergeTarget"
      :preflight="store.mergePreflight"
      :checking="store.mergeChecking"
      :error="store.mergeError"
      :mode="store.mergeMode"
      :confirmed="store.mergeConfirmed"
      :merging="store.merging"
      :can-confirm="store.canConfirmMerge"
      @close="store.closeMerge()"
      @refresh="handleRefreshMerge"
      @update:mode="store.setMergeMode"
      @update:confirmed="store.setMergeConfirmed"
      @confirm="handleConfirmMerge"
    />

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
import FactoryMergeDialog from './FactoryMergeDialog.vue'

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
  store.subscribeEvents(root.value)
})

watch(root, async (value, previous) => {
  if (value === previous) return
  store.reset()
  if (!value) return
  await store.refresh(value)
  await loadBoard(value)
  store.subscribeEvents(value)
})

/** 事件流页签按需拉取：切到页签或换任务时读一次落盘事件，之后靠推送增量。 */
watch(
  [() => store.inspectorTab, () => store.selectedId, () => store.run?.id],
  () => {
    const selected = store.selectedTask
    if (!root.value || !store.run || !selected) return
    if (store.inspectorTab !== 'events') return
    void store.loadEvents(root.value, store.run.id, selected.id)
  },
)

function selectedTaskId(): string | null {
  return store.selectedTask?.id ?? null
}

/** 弹窗内容跟随打开时的任务，而不是当前选中项。 */
const mergeTask = computed(
  () => store.tasks.find((task) => task.id === store.mergeTaskId) ?? store.selectedTask,
)

function handleOpenMerge(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.openMerge(root.value, store.run.id, taskId)
}

function handleRefreshMerge(): void {
  if (!root.value || !store.run) return
  void store.refreshMerge(root.value, store.run.id)
}

function handleConfirmMerge(): void {
  if (!root.value || !store.run) return
  void store.confirmMerge(root.value, store.run.id)
}

function handleStart(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.startTask(root.value, store.run.id, taskId)
}

function handleConfirmDirty(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.confirmDirtyStart(root.value, store.run.id, taskId)
}

function handleStopTask(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.stopTask(root.value, store.run.id, taskId)
}

function handleReveal(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.revealWorktree(root.value, store.run.id, taskId)
}

function handleApprove(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.approveTask(root.value, store.run.id, taskId)
}

function handleRequestChanges(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.requestChanges(root.value, store.run.id, taskId)
}

function handleFix(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.fixTask(root.value, store.run.id, taskId)
}

function handleCommentAccept(commentId: string): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.acceptComment(root.value, store.run.id, taskId, commentId)
}

function handleCommentIgnore(commentId: string): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.ignoreComment(root.value, store.run.id, taskId, commentId)
}

function handleCommentConfirmIgnore(commentId: string): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.confirmIgnoreComment(root.value, store.run.id, taskId, commentId)
}

function handleStopRun(): void {
  if (!root.value || !store.run) return
  void store.stopRun(root.value, store.run.id)
}

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
