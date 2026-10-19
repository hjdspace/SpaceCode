<template>
  <div class="sc-right-panel" :class="{ fullscreen: sessionContext.rightPanelFullscreen }" :style="panelStyle">
    <!-- Resize handle (left edge, drag to adjust width) -->
    <div
      v-if="!sessionContext.rightPanelFullscreen"
      class="sc-resize-handle"
      @mousedown="startPanelResize"
      :class="{ active: isPanelResizing }"
    ></div>
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
      <button
        class="sc-icon-btn"
        :title="sessionContext.rightPanelFullscreen ? t('infoPanel.exitFullscreen') : t('infoPanel.enterFullscreen')"
        @click="sessionContext.toggleRightPanelFullscreen()"
      >
        <Minimize2 v-if="sessionContext.rightPanelFullscreen" :size="14" />
        <Maximize2 v-else :size="14" />
      </button>
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
        <span class="sc-review-scope">{{ t('sessionContext.sessionScope') }}</span>
        <div class="sc-review-stats">
          <span class="sc-stat-add">+{{ changes.sessionAdditions }}</span>
          <span class="sc-stat-del">-{{ changes.sessionDeletions }}</span>
        </div>
        <div class="sc-review-actions">
          <button
            class="sc-action-btn"
            :disabled="stageablePaths.length === 0 || stagingInProgress"
            :title="t('sessionContext.stageSessionFilesHint')"
            @click="stageSessionFiles"
          >
            {{ t('sessionContext.stageSessionFiles') }}
          </button>
          <button class="sc-action-btn" @click="sessionContext.openCommitDialog()">
            {{ t('sessionContext.commitOrPush') }}
          </button>
        </div>
      </div>

      <!-- File list: 本会话写过的文件，按轮次分组 -->
      <div class="sc-file-list">
        <div v-for="section in reviewSections" :key="section.key" class="sc-file-group">
          <div class="sc-file-group-title">{{ section.label }}</div>
          <div v-for="file in section.files" :key="file.path" class="sc-file-group-item">
            <button
              class="sc-file-row"
              :class="{ expanded: sessionContext.isReviewFileExpanded(file.path), clean: !file.stillDirty }"
              @click="handleToggleFile(file.path)"
            >
              <span class="sc-file-dot" />
              <span class="sc-file-name" :title="file.path">{{ getFileName(file.path) }}</span>
              <span class="sc-file-path" :title="file.path">{{ getDirPath(file.path) }}</span>
              <span v-if="fileLabel(file)" class="sc-file-tool">{{ fileLabel(file) }}</span>
              <span v-if="fileTag(file)" class="sc-file-tag">{{ fileTag(file) }}</span>
              <span v-if="file.external" class="sc-file-external">{{ t('sessionContext.externalBadge') }}</span>
              <span v-if="file.stillDirty" class="sc-file-stats">
                <span class="sc-stat-add">+{{ file.insertions }}</span>
                <span class="sc-stat-del">-{{ file.deletions }}</span>
              </span>
              <ChevronRight :size="12" class="sc-file-arrow" :class="{ rotated: sessionContext.isReviewFileExpanded(file.path) }" />
            </button>

            <!-- Expanded diff -->
            <div v-if="sessionContext.isReviewFileExpanded(file.path)" class="sc-diff-block">
              <div v-if="diffNote(file)" class="sc-diff-note">{{ diffNote(file) }}</div>
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
          </div>
        </div>

        <div v-if="changes.files.length === 0" class="sc-file-empty">
          <FileDiff :size="24" />
          <span>{{ t('sessionContext.noFileChanges') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ClipboardList, FileDiff, X, ChevronRight,
  CheckCircle2, Loader2, Circle, Lock,
  Maximize2, Minimize2
} from 'lucide-vue-next'
import { useSessionContext } from '@/stores/sessionContext'
import { useSessionFileChangesStore, type SessionChangeRow } from '@/stores/sessionFileChanges'
import { useScmStore } from '@/stores/scm'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import { splitPatch } from '@/services/diffFileBuilder'
import { useResizablePanel } from '@/composables/useResizablePanel'

/** review 的是哪个会话的改动；未传时回退全局当前会话 */
const props = defineProps<{
  sessionId?: string
}>()

const { t } = useI18n()
const sessionContext = useSessionContext()
const sessionFileChanges = useSessionFileChangesStore()
const appStore = useAppStore()

// ── 面板宽度拖拽缩放 ──
/** 全屏前保存的宽度，退出全屏时恢复 */
let savedPanelWidth = 420

const {
  size: panelWidth,
  isResizing: isPanelResizing,
  onMousedown: startPanelResize,
} = useResizablePanel({
  initial: 420,
  min: 300,
  max: () => Math.max(420, window.innerWidth - 400),
  direction: 'horizontal',
  reverse: true,
  overshootThreshold: 40,
  // 拖到最大后继续往左拖 → 审查面板全屏
  onOvershootMax: () => {
    if (!sessionContext.rightPanelFullscreen) {
      savedPanelWidth = panelWidth.value
      sessionContext.toggleRightPanelFullscreen()
    }
  },
  // 拖到最小后继续往右拖 → 折叠审查面板
  onOvershootMin: () => {
    if (sessionContext.rightPanelFullscreen) {
      // 全屏状态下 → 退出全屏
      sessionContext.toggleRightPanelFullscreen()
    } else {
      // 非全屏 → 收起面板
      sessionContext.closeRightPanel()
    }
  },
})

// 退出全屏时恢复全屏前的面板宽度
watch(() => sessionContext.rightPanelFullscreen, (fullscreen) => {
  if (!fullscreen && savedPanelWidth > 0) {
    panelWidth.value = savedPanelWidth
  }
})

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
/** 每行 diff 的来源口径，决定展开区顶部的说明文案 */
type DiffSource = 'git' | 'session'
const diffSources = reactive<Record<string, DiffSource>>({})

const taskProgress = computed(() => sessionContext.taskProgress)
const changes = computed(() => sessionFileChanges.summaryFor(props.sessionId || ''))
const reviewSections = computed(() => {
  const { current, earlier } = sessionFileChanges.groupedFor(props.sessionId || '')
  const sections: Array<{ key: string; label: string; files: typeof current }> = []
  if (current.length > 0) sections.push({ key: 'current', label: t('sessionContext.currentTurn'), files: current })
  if (earlier.length > 0) {
    sections.push({ key: 'earlier', label: t('sessionContext.earlierTurns', { count: earlier.length }), files: earlier })
  }
  return sections
})
const progressPercent = computed(() => {
  const { completed, total } = taskProgress.value
  return total > 0 ? (completed / total) * 100 : 0
})

const scmStore = useScmStore()
const stagingInProgress = ref(false)

/**
 * 只暂存本会话的文件。仓库里并行会话的未提交改动不该被顺手带进这次 commit，
 * 所以这里给的是会话口径的暂存入口，而不是沿用"暂存全部"。
 */
const stageablePaths = computed(() =>
  changes.value.files.filter(file => file.stillDirty).map(file => file.path),
)

async function stageSessionFiles() {
  const paths = stageablePaths.value
  if (paths.length === 0 || stagingInProgress.value) return
  stagingInProgress.value = true
  try {
    await scmStore.stagePaths(paths)
  } finally {
    stagingInProgress.value = false
  }
}

const panelStyle = computed(() => {
  if (sessionContext.rightPanelFullscreen) return undefined
  return { width: panelWidth.value + 'px' }
})

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

/** 工具事件点名的行显示工具名；间接观测的行交给 fileTag 说明 */
function fileLabel(file: SessionChangeRow): string {
  return file.origin === 'direct' ? (file.tools[file.tools.length - 1] || '') : ''
}

/** 一行的状态：仓库外（git 给不出数字）> 命令/外部观测 > 已提交或已回退 */
function fileTag(file: SessionChangeRow): string {
  if (!file.inRepo) return t('sessionContext.outsideRepoBadge')
  if (file.origin === 'command') return t('sessionContext.commandOriginBadge')
  if (!file.stillDirty) return t('sessionContext.noUncommittedChange')
  return ''
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

  const file = changes.value.files.find(f => f.path === path)
  loadingDiffs.value.add(path)
  try {
    // git 优先：未提交差异的行号才是 hunk 暂存能用得上的那份
    if (file?.stillDirty) {
      const git = await api.git.getReviewDiff(cwd, path)
      if (git?.hunks?.length) {
        setDiff(path, 'git', parseDiffHunks(git.hunks))
        return
      }
    }

    // 仓库外文件与已提交/已回退的改动只有会话备份能给答案
    const sessionId = props.sessionId
    if (sessionId) {
      const evidence = await api.session.getSessionFileDiff(sessionId, path, cwd)
      if (evidence.state === 'ok' && evidence.diff) {
        setDiff(path, 'session', parseDiffText(evidence.diff))
        return
      }
      if (evidence.state === 'evidence_lost') {
        diffErrors[path] = t('sessionContext.evidenceLostDiff')
        return
      }
    }

    // 兜底保留 A 的行为：仓库外的绝对路径由 git 服务直读磁盘，至少给全文
    const fallback = await api.git.getReviewDiff(cwd, path)
    if (fallback?.hunks?.length) {
      setDiff(path, 'git', parseDiffHunks(fallback.hunks))
      return
    }
    diffErrors[path] = file && !file.stillDirty
      ? t('sessionContext.noUncommittedChange')
      : t('sessionContext.diffUnavailable')
  } catch (e: any) {
    diffErrors[path] = e.message || t('sessionContext.failedToLoadDiff')
  } finally {
    loadingDiffs.value.delete(path)
  }
}

function setDiff(path: string, source: DiffSource, lines: DiffLine[]) {
  if (lines.length === 0) return
  diffData[path] = lines
  diffSources[path] = source
}

/** 展开区顶部的口径说明 —— diff 来自 git 还是会话备份，用户得知道自己在看什么。 */
function diffNote(file: SessionChangeRow): string {
  if (diffSources[file.path] !== 'session') return ''
  return file.inRepo
    ? t('sessionContext.sessionEvidenceNote')
    : t('sessionContext.outsideRepoEvidenceNote')
}

/**
 * 会话备份返回的是 unified diff 文本，而 git 服务给的是已解析的 hunks，
 * 这里把文本摊平成同一套行模型。空行是 hunk 之间的分隔符，不是内容行。
 */
function parseDiffText(raw: string): DiffLine[] {
  const lines: DiffLine[] = []
  for (const hunk of splitPatch(raw).hunks) {
    const hunkLines = hunk.split('\n')
    const header = hunkLines[0] ?? ''
    const pos = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header)
    let oldLine = pos ? Number(pos[1]) : 1
    let newLine = pos ? Number(pos[2]) : 1
    lines.push({ type: 'header', content: header, prefix: '' })

    for (const line of hunkLines.slice(1)) {
      if (line === '') continue
      const prefix = line[0] as string
      if (prefix === '+') {
        lines.push({ type: 'add', content: line.slice(1), newNum: newLine++, prefix })
      } else if (prefix === '-') {
        lines.push({ type: 'remove', content: line.slice(1), oldNum: oldLine++, prefix })
      } else {
        lines.push({ type: 'context', content: line.slice(1), oldNum: oldLine++, newNum: newLine++, prefix: ' ' })
      }
    }
  }
  return lines
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

async function expandPendingFile(path: string) {
  if (!sessionContext.isReviewFileExpanded(path)) {
    sessionContext.toggleReviewFile(path)
  }
  if (!diffData[path] && !loadingDiffs.value.has(path)) {
    await loadFileDiff(path)
  }
}

function applyPendingReviewFile() {
  const path = sessionContext.pendingReviewFile
  if (!path) return
  if (sessionContext.rightPanelView === 'review' && sessionContext.showRightPanel) {
    void expandPendingFile(path)
    sessionContext.clearPendingReviewFile()
  }
}

onMounted(applyPendingReviewFile)

watch(() => sessionContext.pendingReviewFile, (path) => {
  if (!path) return
  if (sessionContext.rightPanelView === 'review' && sessionContext.showRightPanel) {
    void expandPendingFile(path)
    sessionContext.clearPendingReviewFile()
  }
})

watch(() => [sessionContext.rightPanelView, sessionContext.showRightPanel], () => {
  applyPendingReviewFile()
})
</script>

<style lang="scss" scoped>
.sc-right-panel {
  flex-shrink: 0;
  background: var(--bg-secondary);
  border-left: 1px solid var(--surface-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
  position: relative;

  &.fullscreen {
    flex: 1;
    width: auto !important;
    border-left: none;
  }
}

.sc-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  background: transparent;
  z-index: 10;
  transition: background 0.2s;

  &:hover,
  &.active {
    background: var(--accent-primary);
  }
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
  @include scrollbar-overlay;
  padding: 4px 12px 12px;
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
  @include scrollbar-overlay;
  padding: 4px 0;
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

.sc-file-group-title {
  padding: 8px 12px 4px;
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
  background: var(--bg-secondary, transparent);
  position: sticky;
  top: 0;
  z-index: 1;
}

.sc-file-tool {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-muted);
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-hover);
}

.sc-file-tag {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-muted);
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-hover);
}

.sc-file-external {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--warning);
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--warning-bg, rgba(245, 158, 11, 0.1));
}

// 写过但工作区已无未提交差异（或压根不在仓库里）：保留行，但别装作有数字可看
.sc-file-row.clean {
  .sc-file-dot { background: var(--text-muted); }
  .sc-file-name { color: var(--text-muted); }
}

.sc-diff-note {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-hover);
  border-bottom: 1px solid var(--surface-border);
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
  /* 纵向由外层 .sc-file-list 负责. 只开横向的话, 横向滚动条占掉的高度会变成
     纵向溢出, 画出一条滑块铺满轨道的幽灵纵向滚动条 —— 所以纵向一并关掉. */
  overflow: auto hidden;
  @include scrollbar-overlay;
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
