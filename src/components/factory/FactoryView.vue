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

        <FactoryRunTabs
          :runs="store.runTabs"
          :active-id="store.run?.id ?? null"
          @select="handleSelectRunTab"
          @close="handleCloseRunTab"
          @new-run="handleOpenNewRun"
        />

        <div v-if="store.readonly" class="storage-banner" data-storage-readonly>
          <AlertTriangle :size="14" />
          <span>{{ t('factory.storage.readonly') }}</span>
        </div>
        <div v-if="store.corruptRuns.length" class="storage-banner" data-storage-corrupt>
          <AlertTriangle :size="14" />
          <span>{{ t('factory.storage.corrupt', { runs: store.corruptRuns.join(', ') }) }}</span>
        </div>

        <FactoryRunHeader
          v-if="store.run"
          :run="store.run"
          :tasks="store.tasks"
          :pausing="store.pausing"
          :repo-label="repoLabel"
          @select="store.selectTask"
          @pause="handlePauseRun"
          @resume="handleResumeRun"
          @config="store.openConfig()"
          @stop="handleStopRun"
          @new-run="handleOpenNewRun"
          @focus-lane="handleFocusLane"
        />

        <div class="factory-columns">
          <FactoryGithubPanel
            v-if="isGithubTracker"
            :label="store.githubLabel"
            :issues="store.githubIssues"
            :loading="store.githubIssuesLoading"
            :error="store.githubIssuesError"
            :claiming="store.githubClaiming"
            :claim-error="store.githubClaimError"
            :run-id="store.run?.id ?? null"
            @update:label="store.setGithubLabel"
            @refresh="handleGithubRefresh"
            @claim="handleGithubClaim"
          />
          <FactoryBacklogPanel
            v-else
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
              ref="boardRef"
              :tasks="store.tasks"
              :selected-id="store.selectedId"
              :run="store.run"
              :now-ms="nowMs"
              @select="store.selectTask"
              @return="handleReturn"
            />
            <div v-else class="board-empty" data-board-empty>{{ t('factory.run.empty') }}</div>
          </div>

          <FactoryInspector
            v-if="store.run"
            :task="store.selectedTask"
            :tab="store.inspectorTab"
            :now-ms="nowMs"
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
            :retrying-writeback="store.retryingWritebackId === store.selectedTask?.id"
            :writeback-error="store.writebackError"
            :readonly="store.readonly"
            :taking-over="store.takingOver"
            :returning="store.returning"
            :retrying="store.retrying"
            @select-tab="store.setInspectorTab"
            @retry-writeback="handleRetryWriteback"
            @start="handleStart"
            @stop="handleStopTask"
            @takeover="handleTakeover"
            @return="handleReturn()"
            @retry="handleRetry"
            @retry-local="handleRetryLocal"
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
      :delivery-mode="deliveryMode"
      :merging="store.merging"
      :can-confirm="store.canConfirmMerge"
      @close="store.closeMerge()"
      @refresh="handleRefreshMerge"
      @update:mode="store.setMergeMode"
      @update:confirmed="store.setMergeConfirmed"
      @confirm="handleConfirmMerge"
    />

    <FactoryConfigModal
      v-if="store.configOpen && store.configDraft"
      :config="store.configDraft"
      :total-tokens="usage.totalTokens"
      :cost-usd="usage.costUsd"
      :has-cost="usage.hasCost"
      :saving="store.configSaving"
      :error="store.configError"
      :field-errors="store.configFieldErrors"
      :conflict-revision="store.configConflictRevision"
      :confirm-gate-off="store.configConfirmGateOff"
      @close="store.closeConfig()"
      @save="handleSaveConfig"
      @update:stage="store.updateStage"
      @update:concurrency="store.setConfigConcurrency"
      @update:verify="store.setConfigVerifyCommand"
      @update:gate-confirm="store.setConfigGateConfirm"
      @update:merge-mode="store.setConfigMergeMode"
    />

    <FactoryNewRunModal
      v-if="newRunOpen"
      :source="isGithubTracker ? 'github-issues' : 'local'"
      :candidates="newRunCandidates"
      :verify-command="newRunVerifyCommand"
      :default-concurrency="newRunDefaultConcurrency"
      :creating="isGithubTracker ? store.githubClaiming : store.creatingRun"
      :loading="isGithubTracker ? store.githubIssuesLoading : store.backlogLoading"
      :error="newRunError"
      @close="newRunOpen = false"
      @create="handleCreateNewRun"
    />

    <FactorySetupWizard v-if="store.wizardOpen && root" :root="root" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Workflow, AlertTriangle, Loader2 } from 'lucide-vue-next'
import type { FactoryLane } from '@/shared/factory'
import { useAppStore } from '@/stores/app'
import { useFactoryStore } from '@/stores/factory'
import { runUsage } from '@/stores/factory/board'
import { backlogCandidates, githubCandidates } from '@/stores/factory/newRun'
import { factoryRepoLabel } from '@/utils/factoryRepo'
import FactorySetupWizard from './FactorySetupWizard.vue'
import FactoryRunTabs from './FactoryRunTabs.vue'
import FactoryRunHeader from './FactoryRunHeader.vue'
import FactoryBoard from './FactoryBoard.vue'
import FactoryInspector from './FactoryInspector.vue'
import FactoryBacklogPanel from './FactoryBacklogPanel.vue'
import FactoryGithubPanel from './FactoryGithubPanel.vue'
import FactoryMergeDialog from './FactoryMergeDialog.vue'
import FactoryConfigModal from './FactoryConfigModal.vue'
import FactoryNewRunModal from './FactoryNewRunModal.vue'

const { t } = useI18n()
const appStore = useAppStore()
const store = useFactoryStore()

const root = computed(() => (appStore.projectRoot || '').trim())

const boardRef = ref<InstanceType<typeof FactoryBoard> | null>(null)

/**
 * 运行中的任务用时按各自的运行时间线继续走：只改 nowMs，卡片与检查器
 * 从 task.timestamps.startedAt 重新折算，切换页签后回到该运行的进度。
 */
const nowMs = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null

function startClock(): void {
  clock = setInterval(() => {
    if (store.run?.status === 'running' && !store.run.paused) nowMs.value = Date.now()
  }, 1000)
}

/** GitHub 任务源显示 owner/repo；本地 backlog 显示项目目录名，避免头部留白。 */
const repoLabel = computed(() =>
  store.config ? factoryRepoLabel(store.config.tracker, root.value) : '',
)

function handleFocusLane(lane: FactoryLane): void {
  boardRef.value?.focusLane(lane)
}

/** 未结束的运行仍占着这些待办；停止后才能重新领取。 */
const claimedIds = computed(() => {
  if (!store.run || store.run.status === 'stopped') return []
  return store.tasks.map((task) => task.id)
})

const isGithubTracker = computed(() => store.config?.tracker.type === 'github-issues')
const deliveryMode = computed<'local' | 'pr'>(() =>
  store.config?.tracker.type === 'github-issues' ? store.config.tracker.mergeMode : 'local',
)
const usage = computed(() => runUsage(store.tasks))

const newRunOpen = ref(false)
const newRunCandidates = computed(() =>
  isGithubTracker.value
    ? githubCandidates(store.githubIssues)
    : backlogCandidates(store.backlog, claimedIds.value),
)
const newRunVerifyCommand = computed(() => store.config?.commands.verify ?? '')
const newRunDefaultConcurrency = computed(() => store.config?.agent.maxConcurrency ?? 4)
const newRunError = computed(() =>
  isGithubTracker.value ? store.githubClaimError : store.createRunError,
)

/** 打开前刷新一次来源列表，避免弹窗还展示已经领取或被删除的任务。 */
async function handleOpenNewRun(): Promise<void> {
  if (!root.value) return
  store.clearNewRunErrors()
  newRunOpen.value = true
  await loadSources(root.value)
}

function handleSelectRunTab(runId: string): void {
  if (!root.value) return
  void store.selectRun(root.value, runId)
}

function handleCloseRunTab(runId: string): void {
  if (!root.value) return
  void store.closeRun(root.value, runId)
}

async function handleCreateNewRun(input: { ids: string[]; concurrency: number }): Promise<void> {
  const value = root.value
  if (!value) return
  let ok: boolean
  if (isGithubTracker.value) {
    ok = await store.claimGithubIssues(value, input.ids.map(Number), input.concurrency)
    // 领取只落一条 pending 运行；与本地创建口径一致，确认后直接交给调度器。
    if (ok && store.run) await store.resumeRun(value, store.run.id)
  } else {
    ok = await store.createRun(value, input.ids, input.concurrency)
  }
  if (!ok) return

  newRunOpen.value = false
  // store 已把新运行挂进页签并选中；这里只刷新待办/GitHub 列表，
  // 不再重读运行列表，避免把刚创建的页签覆盖掉。
  await loadSources(value)
  await nextTick()
  boardRef.value?.focusLane('queued')
}

async function loadSources(value: string): Promise<void> {
  if (isGithubTracker.value) {
    await store.loadGithubIssues(value)
    return
  }
  await store.loadBacklog(value)
}

async function loadBoard(value: string): Promise<void> {
  await Promise.all([loadSources(value), store.loadRun(value)])
}

function handleGithubRefresh(): void {
  if (root.value) void store.loadGithubIssues(root.value)
}

function handleGithubClaim(numbers: number[]): void {
  if (root.value) void store.claimGithubIssues(root.value, numbers)
}

onMounted(async () => {
  startClock()
  if (!root.value) return
  await store.refresh(root.value)
  await loadBoard(root.value)
  store.subscribeEvents(root.value)
})

onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
  clock = null
})

watch(root, async (value, previous) => {
  if (value === previous) return
  newRunOpen.value = false
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

function handleRetryWriteback(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.retryGithubWriteback(root.value, store.run.id, taskId)
}

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

function handleTakeover(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.takeoverTask(root.value, store.run.id, taskId)
}

/** 看板卡片与检查器共用：传入卡片 id，未传时交回当前选中任务。 */
function handleReturn(taskId?: string): void {
  const target = taskId ?? selectedTaskId()
  if (!root.value || !store.run || !target) return
  void store.returnTask(root.value, store.run.id, target)
}

function handleRetry(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.retryTask(root.value, store.run.id, taskId)
}

/** 显式回退：用户主动把当前 Docker 任务改回本地 worktree 执行。 */
function handleRetryLocal(): void {
  const taskId = selectedTaskId()
  if (!root.value || !store.run || !taskId) return
  void store.retryTask(root.value, store.run.id, taskId, { sandbox: 'worktree' })
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

function handlePauseRun(): void {
  if (!root.value || !store.run) return
  void store.pauseRun(root.value, store.run.id)
}

function handleResumeRun(): void {
  if (!root.value || !store.run) return
  void store.resumeRun(root.value, store.run.id)
}

function handleSaveConfig(): void {
  if (!root.value) return
  void store.saveConfig(root.value)
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

.storage-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border: 1px solid var(--warning);
  border-radius: var(--radius-md, 8px);
  background: var(--warning-glow);
  color: var(--warning);
  font-size: var(--text-2xs, 11px);
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
  /* 纵向滚动交给每条泳道的卡片区，整列不再一起滚。 */
  overflow: hidden;
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
