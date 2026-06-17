<template>
  <div class="sc-env-panel">
    <!-- Header -->
    <div class="sc-panel-header">
      <span class="sc-panel-title">{{ t('sessionContext.gitTools') }}</span>
      <div class="sc-header-actions">
        <button class="sc-icon-btn" :title="t('sessionContext.more')">
          <MoreHorizontal :size="14" />
        </button>
        <button class="sc-icon-btn" :title="t('sessionContext.close')" @click="sessionContext.closeEnvPanel()">
          <X :size="14" />
        </button>
      </div>
    </div>

    <!-- Env rows -->
    <div class="sc-env-section">
      <!-- Changes: click → open right panel with review view -->
      <button class="sc-row" @click="sessionContext.openRightPanel('review')">
        <FilePlus :size="13" class="sc-row-icon" />
        <span class="sc-row-label">{{ t('sessionContext.changes') }}</span>
        <span class="sc-stat-add">+{{ sessionContext.gitAdditions }}</span>
        <span class="sc-stat-del">-{{ sessionContext.gitDeletions }}</span>
      </button>

      <!-- Branch: click → toggle branch dropdown -->
      <button class="sc-row" @click="sessionContext.toggleBranchDropdown()">
        <GitBranch :size="13" class="sc-row-icon" />
        <span class="sc-row-label">{{ scmStore.branch || 'main' }}</span>
        <ChevronDown :size="11" class="sc-row-arrow" :class="{ rotated: sessionContext.showBranchDropdown }" />
      </button>

      <!-- Commit -->
      <button class="sc-row" @click="sessionContext.openCommitDialog()">
        <GitCommit :size="13" class="sc-row-icon" />
        <span class="sc-row-label">{{ t('sessionContext.commit') }}</span>
      </button>
    </div>

    <!-- Progress section -->
    <div class="sc-progress-section" v-if="sessionContext.tasks.length > 0">
      <div class="sc-progress-header">
        <span class="sc-progress-title">
          {{ t('sessionContext.progress', { completed: taskProgress.completed, total: taskProgress.total }) }}
        </span>
      </div>
      <div class="sc-progress-bar">
        <div class="sc-progress-fill" :style="{ width: progressPercent + '%' }" />
      </div>
    </div>

    <!-- Task list -->
    <div class="sc-task-list" v-if="sessionContext.tasks.length > 0">
      <!-- Completed group -->
      <div class="sc-task-group" v-if="completedTasks.length > 0">
        <button class="sc-group-header" @click="toggleGroup('completed')">
          <ChevronDown :size="12" class="sc-group-arrow" :class="{ collapsed: !groups.completed }" />
          <CheckCircle2 :size="14" class="sc-group-icon completed" />
          <span>{{ t('sessionContext.completedCount', { count: completedTasks.length }) }}</span>
        </button>
        <Transition name="sc-group-slide">
          <div v-if="groups.completed" class="sc-group-body">
            <div
              v-for="task in completedTasks"
              :key="task.id || task.content"
              class="sc-task-item completed"
              :class="{ subtask: task.isSubtask }"
            >
              <CheckCircle2 :size="14" class="sc-task-status-icon" />
              <span class="sc-task-text">{{ task.content }}</span>
            </div>
          </div>
        </Transition>
      </div>

      <!-- In-progress items (shown inline) -->
      <div
        v-for="task in inProgressTasks"
        :key="task.id || task.content"
        class="sc-task-item in_progress"
        :class="{ subtask: task.isSubtask }"
      >
        <Loader2 :size="14" class="sc-task-status-icon sc-spin" />
        <span class="sc-task-text">{{ task.content }}</span>
      </div>

      <!-- Pending group -->
      <div class="sc-task-group" v-if="pendingTasks.length > 0">
        <button class="sc-group-header" @click="toggleGroup('pending')">
          <ChevronDown :size="12" class="sc-group-arrow" :class="{ collapsed: !groups.pending }" />
          <Circle :size="14" class="sc-group-icon pending" />
          <span>{{ t('sessionContext.pendingCount', { count: pendingTasks.length }) }}</span>
        </button>
        <Transition name="sc-group-slide">
          <div v-if="groups.pending" class="sc-group-body">
            <div
              v-for="task in pendingTasks"
              :key="task.id || task.content"
              class="sc-task-item pending"
              :class="{ subtask: task.isSubtask }"
            >
              <Circle :size="14" class="sc-task-status-icon" />
              <span class="sc-task-text">{{ task.content }}</span>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Continue button -->
    <div class="sc-panel-footer" v-if="sessionContext.tasks.length > 0 && hasPendingOrInProgress">
      <button class="sc-continue-btn" @click="$emit('continue')">
        {{ t('sessionContext.continue') }}
      </button>
    </div>

    <!-- Branch dropdown overlay (slides from left) -->
    <Transition name="sc-branch-slide">
      <div v-if="sessionContext.showBranchDropdown" class="sc-branch-overlay" @click.self="sessionContext.closeBranchDropdown()">
        <div class="sc-branch-dropdown">
          <div class="sc-branch-header">
            <Search :size="13" class="sc-branch-search-icon" />
            <input
              v-model="branchSearch"
              class="sc-branch-search-input"
              type="text"
              :placeholder="t('sessionContext.searchBranch')"
            />
          </div>
          <div class="sc-branch-section-label">{{ t('sessionContext.branches') }}</div>
          <div class="sc-branch-list">
            <button
              v-for="b in filteredBranches"
              :key="b.name"
              class="sc-branch-item"
              :class="{ active: b.current }"
              @click="handleCheckout(b.name)"
            >
              <GitBranch :size="13" class="sc-branch-icon" />
              <span class="sc-branch-name">{{ b.name }}</span>
              <Check v-if="b.current" :size="14" class="sc-branch-check" />
            </button>
            <div v-if="scmStore.unstaged.length + scmStore.untracked.length > 0" class="sc-branch-info">
              {{ t('sessionContext.uncommittedChanges', { count: scmStore.unstaged.length + scmStore.untracked.length }) }}
            </div>
            <div v-if="filteredBranches.length === 0" class="sc-branch-empty">
              {{ t('sessionContext.noMatchingBranches') }}
            </div>
          </div>
          <div class="sc-branch-footer">
            <button class="sc-branch-footer-btn" @click="handleCreateBranch">
              <Plus :size="13" />
              {{ t('sessionContext.createAndCheckout') }}
            </button>
            <button class="sc-branch-footer-btn" disabled>
              <Network :size="13" />
              {{ t('sessionContext.gitGraph') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  MoreHorizontal, X, FilePlus, GitBranch, GitCommit, ChevronDown,
  CheckCircle2, Loader2, Circle, Search, Check, Plus, Network
} from 'lucide-vue-next'
import { useSessionContext } from '@/stores/sessionContext'
import { useScmStore } from '@/stores/scm'

defineEmits<{ continue: [] }>()

const { t } = useI18n()
const sessionContext = useSessionContext()
const scmStore = useScmStore()

const branchSearch = ref('')
const groups = reactive({ completed: true, pending: false })

const taskProgress = computed(() => sessionContext.taskProgress)
const progressPercent = computed(() => {
  const { completed, total } = taskProgress.value
  return total > 0 ? (completed / total) * 100 : 0
})

const completedTasks = computed(() => sessionContext.tasks.filter(t => t.status === 'completed'))
const inProgressTasks = computed(() => sessionContext.tasks.filter(t => t.status === 'in_progress'))
const pendingTasks = computed(() => sessionContext.tasks.filter(t => t.status === 'pending'))
const hasPendingOrInProgress = computed(() => pendingTasks.value.length > 0 || inProgressTasks.value.length > 0)

const filteredBranches = computed(() => {
  const q = branchSearch.value.toLowerCase().trim()
  const branches = scmStore.branches
  if (!q) return branches
  return branches.filter(b => b.name.toLowerCase().includes(q))
})

function toggleGroup(group: 'completed' | 'pending') {
  groups[group] = !groups[group]
}

async function handleCheckout(branchName: string) {
  try {
    await scmStore.checkoutBranch(branchName)
    sessionContext.closeBranchDropdown()
  } catch (e: any) {
    console.error('[EnvPanel] Checkout failed:', e)
  }
}

async function handleCreateBranch() {
  const name = branchSearch.value.trim()
  if (!name) return
  try {
    const result = await scmStore.createBranch(name, true)
    if (result?.success) {
      branchSearch.value = ''
      sessionContext.closeBranchDropdown()
    }
  } catch (e: any) {
    console.error('[EnvPanel] Create branch failed:', e)
  }
}
</script>

<style lang="scss" scoped>
.sc-env-panel {
  position: absolute;
  right: 12px;
  top: 12px;
  width: 300px;
  max-height: calc(100% - 24px);
  z-index: 20;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  // Glassmorphism
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border: 1px solid var(--glass-border);
  border-radius: 14px;
  box-shadow:
    var(--glass-shadow-1),
    var(--glass-shadow-2),
    var(--glass-inset);
}

// Header
.sc-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--glass-divider);
  flex-shrink: 0;
}

.sc-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.sc-header-actions {
  display: flex;
  gap: 2px;
}

.sc-icon-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms ease;

  &:hover { background: var(--glass-hover); color: var(--text-primary); }
}

// Env section
.sc-env-section {
  border-bottom: 1px solid var(--glass-divider);
  padding: 2px 0;
}

.sc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 150ms ease;
  border: none;
  background: transparent;
  color: var(--text-primary);
  width: 100%;
  text-align: left;
  font-family: inherit;
  font-size: 12px;

  &:hover { background: var(--glass-hover); }
}

.sc-row-icon { color: var(--text-muted); flex-shrink: 0; }
.sc-row-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-row-arrow {
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform 200ms ease;
  &.rotated { transform: rotate(180deg); }
}

.sc-stat-add { color: var(--success); font-family: var(--font-mono); font-size: 11px; }
.sc-stat-del { color: var(--error); font-family: var(--font-mono); font-size: 11px; }

// Progress
.sc-progress-section {
  padding: 10px 14px 6px;
  flex-shrink: 0;
}

.sc-progress-header {
  margin-bottom: 8px;
}

.sc-progress-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.sc-progress-bar {
  height: 2px;
  background: var(--glass-divider);
  border-radius: 1px;
  overflow: hidden;
}

.sc-progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 1px;
  transition: width 0.4s ease;
}

// Task list
.sc-task-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;

  &::-webkit-scrollbar { width: 5px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 3px; }
}

.sc-task-group {
  margin: 2px 0;
}

.sc-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  cursor: pointer;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  width: 100%;
  text-align: left;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  transition: background 150ms ease;

  &:hover { background: var(--glass-hover); }
}

.sc-group-arrow {
  color: var(--text-muted);
  transition: transform 200ms ease;
  flex-shrink: 0;
  &.collapsed { transform: rotate(-90deg); }
}

.sc-group-icon {
  flex-shrink: 0;
  &.completed { color: var(--success); }
  &.pending { color: var(--text-muted); }
}

.sc-group-body {
  overflow: hidden;
}

.sc-task-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 14px 5px 36px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-secondary);

  &.completed {
    color: var(--text-muted);
    .sc-task-text { text-decoration: line-through; }
    .sc-task-status-icon { color: var(--success); }
  }
  &.in_progress {
    color: var(--text-primary);
    .sc-task-status-icon { color: var(--accent-primary); }
  }
  &.pending {
    .sc-task-status-icon { color: var(--text-muted); }
  }
  &.subtask { padding-left: 52px; }
}

.sc-task-status-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  margin-top: 1px;
}

.sc-task-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.sc-spin { animation: sc-spin-anim 1s linear infinite; }
@keyframes sc-spin-anim {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// Group slide transition
.sc-group-slide-enter-active { transition: all 0.2s ease-out; }
.sc-group-slide-leave-active { transition: all 0.15s ease-in; }
.sc-group-slide-enter-from,
.sc-group-slide-leave-to {
  opacity: 0;
  max-height: 0;
}
.sc-group-slide-enter-to,
.sc-group-slide-leave-from {
  opacity: 1;
  max-height: 500px;
}

// Footer
.sc-panel-footer {
  padding: 8px 12px;
  border-top: 1px solid var(--glass-divider);
  flex-shrink: 0;
}

.sc-continue-btn {
  width: 100%;
  height: 30px;
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  background: var(--glass-hover);
  color: var(--text-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 150ms ease;

  &:hover { background: var(--glass-hover); color: var(--text-primary); }
}

// Branch dropdown overlay
.sc-branch-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
}

.sc-branch-dropdown {
  width: 280px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border-right: 1px solid var(--glass-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 4px 0 16px rgba(0, 0, 0, 0.3);
}

.sc-branch-header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--glass-divider);
  position: relative;
}

.sc-branch-search-icon {
  position: absolute;
  left: 22px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.sc-branch-search-input {
  width: 100%;
  height: 30px;
  padding: 0 10px 0 30px;
  background: var(--glass-hover);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  transition: border-color 150ms ease;

  &:focus { border-color: var(--accent-primary); }
  &::placeholder { color: var(--text-muted); }
}

.sc-branch-section-label {
  padding: 8px 14px 4px;
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
}

.sc-branch-list {
  flex: 1;
  overflow-y: auto;
  padding: 2px 0;

  &::-webkit-scrollbar { width: 5px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 3px; }
}

.sc-branch-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 150ms ease;
  border: none;
  background: transparent;
  color: var(--text-primary);
  width: 100%;
  text-align: left;
  font-family: inherit;
  font-size: 13px;

  &:hover { background: var(--glass-hover); }
  &.active .sc-branch-name { font-weight: 500; }
}

.sc-branch-icon { color: var(--text-muted); flex-shrink: 0; }
.sc-branch-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-branch-check { color: var(--success); flex-shrink: 0; }

.sc-branch-info {
  padding: 0 14px 6px 40px;
  font-size: 11px;
  color: var(--text-muted);
}

.sc-branch-empty {
  padding: 20px 14px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}

.sc-branch-footer {
  border-top: 1px solid var(--glass-divider);
  padding: 4px 0;
}

.sc-branch-footer-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 150ms ease;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  width: 100%;
  text-align: left;
  font-family: inherit;
  font-size: 12px;

  &:hover { background: var(--glass-hover); color: var(--text-primary); }
  &:disabled { cursor: not-allowed; opacity: 0.4; &:hover { background: transparent; color: var(--text-secondary); } }
}

// Branch slide transition
.sc-branch-slide-enter-active { transition: all 0.2s ease-out; }
.sc-branch-slide-leave-active { transition: all 0.15s ease-in; }
.sc-branch-slide-enter-from { opacity: 0; .sc-branch-dropdown { transform: translateX(-20px); } }
.sc-branch-slide-leave-to { opacity: 0; .sc-branch-dropdown { transform: translateX(-20px); } }
</style>
