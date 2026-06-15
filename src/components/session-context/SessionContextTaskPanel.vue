<template>
  <div class="sc-right-panel">
    <!-- Tab bar -->
    <div class="sc-tabs">
      <button
        class="sc-tab"
        :class="{ active: sessionContext.rightPanelView === 'tasks' }"
        @click="sessionContext.switchRightPanelView('tasks')"
      >
        <ClipboardList :size="13" />
        {{ t('sessionContext.gitTools') }}
      </button>
      <button
        class="sc-tab"
        :class="{ active: sessionContext.rightPanelView === 'review' }"
        @click="sessionContext.switchRightPanelView('review')"
      >
        <FileDiff :size="13" />
        {{ t('sessionContext.review') }}
      </button>
      <div class="sc-tab-spacer" />
      <button class="sc-icon-btn" :title="t('sessionContext.close')" @click="sessionContext.closeRightPanel()">
        <X :size="14" />
      </button>
    </div>

    <!-- Tasks view -->
    <div v-if="sessionContext.rightPanelView === 'tasks'" class="sc-tasks-view">
      <div class="sc-progress-section" v-if="sessionContext.tasks.length > 0">
        <div class="sc-progress-header">
          <CheckCircle2 :size="14" />
          <span>{{ t('sessionContext.progress', { completed: taskProgress.completed, total: taskProgress.total }) }}</span>
        </div>
        <div class="sc-progress-bar">
          <div class="sc-progress-fill" :style="{ width: progressPercent + '%' }" />
        </div>
      </div>

      <div class="sc-task-list">
        <div
          v-for="task in sessionContext.tasks"
          :key="task.id || task.content"
          class="sc-task-item"
          :class="[task.status, { subtask: task.isSubtask }]"
        >
          <span class="sc-task-icon" :class="task.status">
            <CheckCircle2 v-if="task.status === 'completed'" :size="15" />
            <Loader2 v-else-if="task.status === 'in_progress'" :size="15" class="sc-spin" />
            <Circle v-else :size="15" />
          </span>
          <span class="sc-task-text">
            {{ task.id ? `#${task.id} ` : '' }}{{ task.content }}
          </span>
          <span v-if="task.blockedBy?.length" class="sc-task-blocked">
            <Lock :size="11" />
            #{{ task.blockedBy.join(', #') }}
          </span>
        </div>

        <div v-if="sessionContext.tasks.length === 0" class="sc-task-empty">
          {{ t('sessionContext.noTasks') }}
        </div>
      </div>
    </div>

    <!-- Review view (file changes with diff) -->
    <div v-else class="sc-review-view">
      <!-- Toolbar -->
      <div class="sc-review-toolbar">
        <span class="sc-review-label">{{ t('sessionContext.review') }}</span>
        <div class="sc-review-stats">
          <span class="sc-stat-add">+{{ sessionContext.gitAdditions }}</span>
          <span class="sc-stat-del">-{{ sessionContext.gitDeletions }}</span>
        </div>
        <div class="sc-review-actions">
          <button class="sc-action-btn" @click="sessionContext.openCommitDialog()">
            {{ t('sessionContext.commitOrPush') }}
          </button>
        </div>
      </div>

      <!-- File list -->
      <div class="sc-file-list">
        <template v-for="file in sessionContext.changedFiles" :key="file.path">
          <button
            class="sc-file-row"
            :class="{ expanded: sessionContext.isReviewFileExpanded(file.path) }"
            @click="handleToggleFile(file.path)"
          >
            <span class="sc-file-dot" />
            <span class="sc-file-name" :title="file.path">{{ getFileName(file.path) }}</span>
            <span class="sc-file-path" :title="file.path">{{ getDirPath(file.path) }}</span>
            <span class="sc-file-stats">
              <span class="sc-stat-add">+{{ file.insertions }}</span>
              <span class="sc-stat-del">-{{ file.deletions }}</span>
            </span>
            <ChevronRight :size="12" class="sc-file-arrow" :class="{ rotated: sessionContext.isReviewFileExpanded(file.path) }" />
          </button>

          <!-- Expanded diff -->
          <div v-if="sessionContext.isReviewFileExpanded(file.path)" class="sc-diff-block">
            <div v-if="loadingDiffs.has(file.path)" class="sc-diff-loading">
              {{ t('sessionContext.loadingDiff') }}
            </div>
            <div v-else-if="diffErrors[file.path]" class="sc-diff-error">
              {{ diffErrors[file.path] }}
            </div>
            <div v-else-if="diffData[file.path]" class="sc-diff-lines">
              <template v-for="(line, idx) in diffData[file.path]" :key="idx">
                <div class="sc-diff-line" :class="line.type">
                  <span class="sc-ln old">{{ line.oldNum || '' }}</span>
                  <span class="sc-ln new">{{ line.newNum || '' }}</span>
                  <span class="sc-prefix">{{ line.prefix }}</span>
                  <span class="sc-code">{{ line.content }}</span>
                </div>
              </template>
            </div>
            <div v-else class="sc-diff-empty">{{ t('sessionContext.noDiffAvailable') }}</div>
          </div>
        </template>

        <div v-if="sessionContext.changedFiles.length === 0" class="sc-file-empty">
          <FileDiff :size="24" />
          <span>{{ t('sessionContext.noFileChanges') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ClipboardList, FileDiff, X, ChevronRight,
  CheckCircle2, Loader2, Circle, Lock
} from 'lucide-vue-next'
import { useSessionContext } from '@/stores/sessionContext'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'

const { t } = useI18n()
const sessionContext = useSessionContext()
const appStore = useAppStore()

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header'
  content: string
  oldNum?: number
  newNum?: number
  prefix: string
}

const diffData = reactive<Record<string, DiffLine[]>>({})
const diffErrors = reactive<Record<string, string>>({})
const loadingDiffs = ref<Set<string>>(new Set())

const taskProgress = computed(() => sessionContext.taskProgress)
const progressPercent = computed(() => {
  const { completed, total } = taskProgress.value
  return total > 0 ? (completed / total) * 100 : 0
})

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

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

async function handleToggleFile(path: string) {
  sessionContext.toggleReviewFile(path)
  if (sessionContext.isReviewFileExpanded(path) && !diffData[path] && !loadingDiffs.value.has(path)) {
    await loadFileDiff(path)
  }
}

async function loadFileDiff(path: string) {
  const cwd = appStore.projectRoot
  if (!cwd) {
    diffErrors[path] = t('sessionContext.noProjectRoot')
    return
  }

  loadingDiffs.value.add(path)
  try {
    const result = await api.git.getDiff(cwd, path, false)
    if (result?.hunks) {
      diffData[path] = parseDiffHunks(result.hunks)
    } else {
      diffErrors[path] = t('sessionContext.diffUnavailable')
    }
  } catch (e: any) {
    diffErrors[path] = e.message || t('sessionContext.failedToLoadDiff')
  } finally {
    loadingDiffs.value.delete(path)
  }
}

function parseDiffHunks(hunks: any[]): DiffLine[] {
  const lines: DiffLine[] = []
  for (const hunk of hunks) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart

    lines.push({
      type: 'header',
      content: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      prefix: '',
    })

    if (hunk.content) {
      const contentLines = hunk.content.split('\n')
      for (const line of contentLines) {
        if (line.startsWith('+')) {
          lines.push({ type: 'add', content: line.substring(1), newNum: newLine++, prefix: '+' })
        } else if (line.startsWith('-')) {
          lines.push({ type: 'remove', content: line.substring(1), oldNum: oldLine++, prefix: '-' })
        } else {
          lines.push({ type: 'context', content: line.startsWith(' ') ? line.substring(1) : line, oldNum: oldLine++, newNum: newLine++, prefix: ' ' })
        }
      }
    }
  }
  return lines
}
</script>

<style lang="scss" scoped>
.sc-right-panel {
  width: 420px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  border-left: 1px solid var(--surface-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

// Tabs
.sc-tabs {
  display: flex;
  align-items: center;
  padding: 0 8px;
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;
  height: 38px;
  gap: 2px;
}

.sc-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  border-bottom: 2px solid transparent;
  transition: all 150ms ease;

  &.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent-primary);
  }
  &:hover:not(.active) { color: var(--text-secondary); }
}

.sc-tab-spacer { flex: 1; }

.sc-icon-btn {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 150ms ease;
  flex-shrink: 0;

  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

// Tasks view
.sc-tasks-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sc-progress-section {
  padding: 10px 16px 6px;
  flex-shrink: 0;
}

.sc-progress-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.sc-progress-bar {
  height: 2px;
  background: var(--bg-tertiary);
  border-radius: 1px;
  overflow: hidden;
}

.sc-progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 1px;
  transition: width 0.4s ease;
}

.sc-task-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px 12px;

  &::-webkit-scrollbar { width: 5px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
}

.sc-task-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 4px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-secondary);

  &.completed {
    color: var(--text-muted);
    .sc-task-text { text-decoration: line-through; }
    .sc-task-icon { color: var(--success); }
  }
  &.in_progress {
    color: var(--text-primary);
    .sc-task-icon { color: var(--accent-primary); }
  }
  &.pending { .sc-task-icon { color: var(--text-muted); } }
  &.subtask { padding-left: 28px; }
}

.sc-task-icon {
  width: 16px; height: 16px;
  flex-shrink: 0;
  margin-top: 1px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sc-task-text { flex: 1; min-width: 0; }

.sc-task-blocked {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  color: var(--warning);
  font-size: 11px;
  padding: 1px 5px;
  background: rgba(217, 119, 6, 0.1);
  border-radius: 3px;
}

.sc-task-empty {
  padding: 20px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}

.sc-spin { animation: sc-spin-anim 1s linear infinite; }
@keyframes sc-spin-anim {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// Review view
.sc-review-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sc-review-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;
}

.sc-review-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.sc-review-stats { display: flex; gap: 5px; }

.sc-review-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.sc-action-btn {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
  transition: all 150ms ease;

  &:hover { background: var(--bg-hover); color: var(--text-secondary); }
}

.sc-file-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;

  &::-webkit-scrollbar { width: 5px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
}

.sc-file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  transition: background 150ms ease;
  border: none;
  background: transparent;
  color: var(--text-primary);
  width: 100%;
  text-align: left;
  font-family: inherit;
  font-size: 12px;

  &:hover { background: var(--bg-hover); }
  &.expanded { background: var(--bg-hover); }
}

.sc-file-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent-primary);
  flex-shrink: 0;
}

.sc-file-name {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-primary);
  flex-shrink: 0;
}

.sc-file-path {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-file-stats {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
}

.sc-file-arrow {
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform 200ms ease;
  &.rotated { transform: rotate(90deg); }
}

.sc-stat-add { color: var(--success); font-family: var(--font-mono); font-size: 11px; }
.sc-stat-del { color: var(--error); font-family: var(--font-mono); font-size: 11px; }

.sc-file-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--text-muted);
  font-size: 12px;
}

// Diff block
.sc-diff-block {
  border-top: 1px solid var(--surface-border);
  background: var(--bg-primary);
  overflow: hidden;
}

.sc-diff-loading,
.sc-diff-error,
.sc-diff-empty {
  padding: 12px 16px;
  font-size: 11px;
  color: var(--text-muted);
}

.sc-diff-error { color: var(--error); }

.sc-diff-lines {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
}

.sc-diff-line {
  display: flex;
  padding: 0 8px;
  white-space: pre;

  &.add {
    background: rgba(34, 197, 94, 0.08);
    .sc-prefix { color: var(--success); }
  }
  &.remove {
    background: rgba(239, 68, 68, 0.08);
    .sc-prefix { color: var(--error); }
  }
  &.header {
    background: rgba(59, 130, 246, 0.08);
    color: var(--accent-primary);
    padding: 4px 8px;
    font-weight: 500;
  }
}

.sc-ln {
  width: 36px;
  text-align: right;
  padding-right: 8px;
  color: var(--text-muted);
  flex-shrink: 0;
  user-select: none;
  opacity: 0.5;
}

.sc-prefix {
  width: 14px;
  flex-shrink: 0;
  text-align: center;
}

.sc-code {
  flex: 1;
  color: var(--text-secondary);
}
</style>
