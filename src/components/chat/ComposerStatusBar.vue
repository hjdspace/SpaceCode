<template>
  <div
    v-if="visible"
    class="composer-status-bar"
    @mouseleave="handleBarLeave"
  >
    <!-- 左侧：任务进度 -->
    <div
      v-if="hasTasks"
      ref="taskZoneRef"
      class="status-zone task-zone"
      :class="{ 'has-tasks': hasTasks }"
      @mouseenter="handleTaskEnter"
      @mouseleave="handleTaskLeave"
      @click="openTasksPanel"
      @keydown.enter.prevent="openTasksPanel"
      @keydown.space.prevent="openTasksPanel"
      role="button"
      tabindex="0"
    >
      <Loader2 v-if="hasInProgressTasks" :size="14" class="zone-icon spin" />
      <ClipboardList v-else :size="14" class="zone-icon" />
      <span class="zone-label">{{ taskSummary }}</span>
    </div>

    <span v-if="hasTasks && hasChanges" class="status-divider" aria-hidden="true">·</span>

    <!-- 右侧：文件改动 -->
    <div
      v-if="hasChanges"
      ref="changesZoneRef"
      class="status-zone changes-zone"
      :class="{ 'has-changes': hasChanges }"
      @mouseenter="handleChangesEnter"
      @mouseleave="handleChangesLeave"
      @click="openChangesPanel"
      @keydown.enter.prevent="openChangesPanel"
      @keydown.space.prevent="openChangesPanel"
      role="button"
      tabindex="0"
      :title="t('composerStatus.openReview')"
      :aria-label="t('composerStatus.openReview')"
    >
      <span class="zone-label">{{ changesSummary }}</span>
      <span v-if="hasChanges" class="changes-stats">
        <span class="stat-add">+{{ sessionContext.gitAdditions }}</span>
        <span class="stat-del">-{{ sessionContext.gitDeletions }}</span>
      </span>
    </div>

    <!-- 任务详情弹出层 -->
    <Transition name="status-popup">
      <div
        v-if="showTaskPopup && hasTasks"
        ref="taskPopupRef"
        class="status-popup task-popup"
        @mouseenter="handleTaskEnter"
        @mouseleave="handleTaskLeave"
      >
        <div class="popup-header">
          <ClipboardList :size="14" />
          <span>{{ t('composerStatus.taskProgress', { completed: taskProgress.completed, total: taskProgress.total }) }}</span>
        </div>
        <div class="popup-body">
          <div
            v-for="task in sessionContext.tasks"
            :key="task.id || task.content"
            class="popup-task-item"
            :class="[task.status, { subtask: task.isSubtask }]"
          >
            <span class="task-status-icon" :class="task.status">
              <CheckCircle2 v-if="task.status === 'completed'" :size="14" />
              <Loader2 v-else-if="task.status === 'in_progress'" :size="14" class="spin" />
              <Circle v-else :size="14" />
            </span>
            <span class="task-content">{{ task.id ? `#${task.id} ` : '' }}{{ task.content }}</span>
            <span v-if="task.blockedBy?.length" class="task-blocked">
              <Lock :size="10" />
              #{{ task.blockedBy.join(', #') }}
            </span>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 文件改动详情弹出层 -->
    <Transition name="status-popup">
      <div
        v-if="showChangesPopup && hasChanges"
        ref="changesPopupRef"
        class="status-popup changes-popup"
        @mouseenter="handleChangesEnter"
        @mouseleave="handleChangesLeave"
      >
        <div class="popup-header">
          <FileDiff :size="14" />
          <span>{{ t('composerStatus.fileChanges', { count: sessionContext.changedFiles.length }) }}</span>
          <span class="popup-header-stats">
            <span class="stat-add">+{{ sessionContext.gitAdditions }}</span>
            <span class="stat-del">-{{ sessionContext.gitDeletions }}</span>
          </span>
        </div>
        <div class="popup-body">
          <button
            v-for="file in sessionContext.changedFiles"
            :key="file.path"
            class="popup-file-item"
            @click="openFileDiff(file.path)"
          >
            <FileText :size="13" class="file-icon" />
            <span class="file-name" :title="file.path">{{ file.path.split(/[/\\]/).pop() || file.path }}</span>
            <span class="file-path" :title="file.path">{{ getDirPath(file.path) }}</span>
            <span class="file-stats">
              <span class="stat-add">+{{ file.insertions }}</span>
              <span class="stat-del">-{{ file.deletions }}</span>
            </span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionContext } from '@/stores/sessionContext'
import { useAppStore } from '@/stores/app'
import {
  ClipboardList, Loader2, CheckCircle2, Circle, Lock,
  FileDiff, FileText
} from 'lucide-vue-next'

const { t } = useI18n()
const sessionContext = useSessionContext()
const appStore = useAppStore()

const HOVER_DELAY_MS = 180

const taskZoneRef = ref<HTMLElement | null>(null)
const changesZoneRef = ref<HTMLElement | null>(null)
const taskPopupRef = ref<HTMLElement | null>(null)
const changesPopupRef = ref<HTMLElement | null>(null)

const taskHover = ref(false)
const changesHover = ref(false)
const showTaskPopup = ref(false)
const showChangesPopup = ref(false)

let taskEnterTimer: ReturnType<typeof setTimeout> | null = null
let taskLeaveTimer: ReturnType<typeof setTimeout> | null = null
let changesEnterTimer: ReturnType<typeof setTimeout> | null = null
let changesLeaveTimer: ReturnType<typeof setTimeout> | null = null

const taskProgress = computed(() => sessionContext.taskProgress)
const hasTasks = computed(() => sessionContext.tasks.length > 0)
const hasChanges = computed(() => (
  sessionContext.changedFiles.length > 0 ||
  sessionContext.gitAdditions > 0 ||
  sessionContext.gitDeletions > 0
))
const hasInProgressTasks = computed(() => sessionContext.tasks.some(t => t.status === 'in_progress'))

const visible = computed(() => hasTasks.value || hasChanges.value)

const taskSummary = computed(() => {
  const { completed, total } = taskProgress.value
  return t('composerStatus.stepProgress', { completed, total })
})

const changesSummary = computed(() => {
  return t('composerStatus.filesChanged', { count: sessionContext.changedFiles.length })
})

function getDirPath(path: string): string {
  const root = appStore.projectRoot
  let rel = path
  if (root && path.startsWith(root)) {
    rel = path.slice(root.length).replace(/^[/\\]/, '')
  }
  const parts = rel.split(/[/\\]/)
  parts.pop()
  return parts.length > 0 ? parts.join('/') + '/' : ''
}

function clearTimers() {
  if (taskEnterTimer) { clearTimeout(taskEnterTimer); taskEnterTimer = null }
  if (taskLeaveTimer) { clearTimeout(taskLeaveTimer); taskLeaveTimer = null }
  if (changesEnterTimer) { clearTimeout(changesEnterTimer); changesEnterTimer = null }
  if (changesLeaveTimer) { clearTimeout(changesLeaveTimer); changesLeaveTimer = null }
}

function openTasksPanel() {
  sessionContext.openRightPanel('tasks')
}

function openChangesPanel() {
  sessionContext.openReviewPanel()
  showChangesPopup.value = false
  changesHover.value = false
}

function openFileDiff(path: string) {
  sessionContext.openReviewWithFile(path)
  showChangesPopup.value = false
  changesHover.value = false
}

function handleTaskEnter() {
  if (changesLeaveTimer) { clearTimeout(changesLeaveTimer); changesLeaveTimer = null }
  taskHover.value = true
  if (taskLeaveTimer) { clearTimeout(taskLeaveTimer); taskLeaveTimer = null }
  if (taskEnterTimer) return
  taskEnterTimer = setTimeout(() => {
    taskEnterTimer = null
    if (taskHover.value) {
      showChangesPopup.value = false
      showTaskPopup.value = true
    }
  }, HOVER_DELAY_MS)
}

function handleTaskLeave() {
  taskHover.value = false
  if (taskEnterTimer) { clearTimeout(taskEnterTimer); taskEnterTimer = null }
  if (taskLeaveTimer) return
  taskLeaveTimer = setTimeout(() => {
    taskLeaveTimer = null
    if (!taskHover.value) {
      showTaskPopup.value = false
    }
  }, HOVER_DELAY_MS)
}

function handleChangesEnter() {
  if (taskLeaveTimer) { clearTimeout(taskLeaveTimer); taskLeaveTimer = null }
  changesHover.value = true
  if (changesLeaveTimer) { clearTimeout(changesLeaveTimer); changesLeaveTimer = null }
  if (changesEnterTimer) return
  changesEnterTimer = setTimeout(() => {
    changesEnterTimer = null
    if (changesHover.value) {
      showTaskPopup.value = false
      showChangesPopup.value = true
    }
  }, HOVER_DELAY_MS)
}

function handleChangesLeave() {
  changesHover.value = false
  if (changesEnterTimer) { clearTimeout(changesEnterTimer); changesEnterTimer = null }
  if (changesLeaveTimer) return
  changesLeaveTimer = setTimeout(() => {
    changesLeaveTimer = null
    if (!changesHover.value) {
      showChangesPopup.value = false
    }
  }, HOVER_DELAY_MS)
}

function handleBarLeave(e: MouseEvent) {
  const related = e.relatedTarget as HTMLElement | null
  if (!related) {
    showTaskPopup.value = false
    showChangesPopup.value = false
    taskHover.value = false
    changesHover.value = false
  }
}

onUnmounted(clearTimers)
</script>

<style lang="scss" scoped>
.composer-status-bar {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 5px 10px;
  border-radius: var(--radius-full, 9999px);
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  z-index: 30;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--surface-border-strong);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }
}

.status-zone {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full, 9999px);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  user-select: none;

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
}

.task-popup {
  left: 0;
  transform: none;
}

.changes-popup {
  left: auto;
  right: 0;
  transform: none;
}

.zone-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.zone-label {
  white-space: nowrap;
}

.changes-stats {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 2px;
}

.status-divider {
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  padding: 0 1px;
  flex-shrink: 0;
}

.stat-add,
.stat-del {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 11px;
  font-weight: 600;
}

.stat-add { color: var(--success); }
.stat-del { color: var(--error); }

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.status-popup {
  position: absolute;
  bottom: calc(100% + 10px);
  min-width: 280px;
  max-width: min(420px, 90vw);
  max-height: 320px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.14);
  z-index: 31;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.popup-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--surface-border);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  flex-shrink: 0;
}

.popup-header-stats {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.popup-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.popup-task-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-secondary);
  transition: background 0.12s ease;

  &.completed {
    color: var(--text-muted);
    .task-content { text-decoration: line-through; }
  }

  &.in_progress {
    color: var(--text-primary);
  }

  &.subtask { padding-left: 30px; }

  &:hover { background: var(--surface-hover); }
}

.task-status-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;

  &.completed { color: var(--success); }
  &.in_progress { color: var(--accent-primary); }
  &.pending { color: var(--text-muted); }
}

.task-content {
  flex: 1;
  min-width: 0;
}

.task-blocked {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--warning);
  font-size: 10px;
  padding: 1px 4px;
  background: var(--warning-bg, rgba(245, 158, 11, 0.1));
  border-radius: 3px;
}

.popup-file-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;

  &:hover { background: var(--surface-hover); }
}

.file-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.file-name {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  flex-shrink: 0;
  font-size: 11px;
}

.file-path {
  flex: 1;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-stats {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.status-popup-enter-active,
.status-popup-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.status-popup-enter-from,
.status-popup-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
