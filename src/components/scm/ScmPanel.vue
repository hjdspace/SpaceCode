<template>
  <div class="scm-panel">
    <!-- Header: branch info + actions -->
    <div class="scm-header">
      <div class="branch-info" @click="showBranchDropdown = !showBranchDropdown">
        <GitBranch :size="14" />
        <span class="branch-name">{{ scmStore.branch || t('scm.noBranch') }}</span>
        <ChevronDown :size="12" />
      </div>
      <div class="scm-actions">
        <button class="scm-action-btn" @click="handleRefresh" :title="t('scm.refresh')" aria-label="刷新">
          <RefreshCw :size="14" :class="{ spinning: scmStore.isLoading }" />
        </button>
        <button class="scm-action-btn" @click="handlePull" :title="t('scm.pull')" aria-label="拉取">
          <ArrowDown :size="14" />
        </button>
        <button class="scm-action-btn" @click="handlePush" :title="t('scm.push')" aria-label="推送">
          <ArrowUp :size="14" />
        </button>
        <button class="scm-action-btn" @click="handleStash" :title="t('scm.stash')" aria-label="暂存">
          <Archive :size="14" />
        </button>
      </div>
    </div>

    <!-- Branch dropdown -->
    <div v-if="showBranchDropdown" class="branch-dropdown" @click.stop>
      <div class="branch-dropdown-header">
        <span>{{ t('scm.branches') }}</span>
        <button class="branch-create-btn" @click="showCreateBranch = true" aria-label="新建分支">
          <Plus :size="12" />
        </button>
      </div>
      <div class="branch-list">
        <button
          v-for="b in localBranches"
          :key="b.name"
          class="branch-item"
          :class="{ active: b.current }"
          @click="handleCheckout(b.name)"
        >
          <GitBranch :size="12" />
          <span>{{ b.name }}</span>
          <Check v-if="b.current" :size="12" />
        </button>
      </div>
      <div v-if="remoteBranches.length > 0" class="branch-section-title">{{ t('scm.remote').toUpperCase() }}</div>
      <div class="branch-list">
        <button
          v-for="b in remoteBranches"
          :key="b.name"
          class="branch-item"
          @click="handleCheckout(b.name)"
        >
          <GitBranch :size="12" />
          <span>{{ b.name.replace('remotes/', '') }}</span>
        </button>
      </div>
    </div>

    <!-- Commit input section -->
    <div class="commit-section">
      <div class="commit-input-wrapper">
        <textarea
          ref="commitTextarea"
          v-model="scmStore.commitMessage"
          class="commit-input"
          :placeholder="t('scm.messagePlaceholder', { branch: scmStore.branch || 'HEAD' })"
          :rows="commitTextareaRows"
          @input="autoResizeTextarea"
          @keydown.ctrl.enter="handleCommit"
        ></textarea>
        <button
          class="ai-commit-btn"
          title="AI 生成提交消息"
          @click="handleGenerateCommitMessage"
          :class="{ generating: scmStore.isGeneratingCommitMessage }"
        >
          <Sparkles :size="14" :class="{ spin: scmStore.isGeneratingCommitMessage }" />
        </button>
      </div>
      <div class="commit-actions">
        <button
          class="commit-btn primary"
          @click="handleCommit()"
        >
          <Check :size="14" /> 提交
        </button>
        <div class="dropdown-wrapper">
          <button
            class="commit-btn dropdown"
            @click.stop="showCommitMenu = !showCommitMenu"
          >
            <ChevronDown :size="14" />
          </button>
          <div v-if="showCommitMenu" class="commit-dropdown-menu" @click.stop>
            <button class="commit-menu-item" @click="handleCommit(); showCommitMenu = false">
              {{ t('scm.commit') }}
            </button>
            <button class="commit-menu-item" @click="handleCommitAmend(); showCommitMenu = false">
              {{ t('scm.commitAmend') }}
            </button>
            <div class="commit-menu-divider"></div>
            <button class="commit-menu-item" @click="handleCommitAndPush(); showCommitMenu = false">
              {{ t('scm.commitAndPush') }}
            </button>
            <button class="commit-menu-item" @click="handleCommitAndSync(); showCommitMenu = false">
              {{ t('scm.commitAndSync') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Upper section: Changes (resizable) -->
    <div
      class="changes-container"
      :style="{ flex: changesFlex + ' 1 0%' }"
    >
      <!-- Staged changes -->
      <div class="change-group">
        <div class="group-header" @click="stagedCollapsed = !stagedCollapsed">
          <ChevronRight :size="12" :class="{ rotated: !stagedCollapsed }" />
          <span class="group-title">{{ t('scm.changes') }}</span>
          <div class="group-actions-right">
            <button class="group-icon-btn" :title="t('scm.discardAllChanges')" @click.stop="handleDiscardAll" aria-label="放弃所有更改">
              <Trash2 :size="14" />
            </button>
            <button class="group-icon-btn" :title="t('scm.stageAllChanges')" @click.stop="handleStageAll" aria-label="暂存所有更改">
              <Check :size="14" />
            </button>
            <button class="group-icon-btn" :title="t('scm.refresh')" @click.stop="handleRefresh" aria-label="刷新">
              <RefreshCw :size="14" />
            </button>
            <button class="group-icon-btn more" :title="t('scm.moreActions')" @click.stop="showMoreMenu = !showMoreMenu" aria-label="更多操作">
              <MoreHorizontal :size="14" />
            </button>
          </div>
        </div>
        <div v-show="!stagedCollapsed" class="group-content">
          <!-- Staged files -->
          <template v-if="scmStore.staged.length > 0">
            <div class="sub-group-label">{{ t('scm.stagedChanges') }}</div>
            <div
              v-for="file in scmStore.staged"
              :key="'staged-' + file.path"
              class="change-file-row"
              :class="{ selected: scmStore.selectedFile?.path === file.path && scmStore.selectedFileStaged }"
              @click="handleSelectFile(file, true)"
            >
              <span class="file-status-badge staged">{{ getStatusLetter(file) }}</span>
              <span class="file-lang-icon">{{ getLangIcon(file.path) }}</span>
              <span class="file-name" :title="file.path">{{ getFileName(file.path) }}</span>
              <span class="file-path-truncated" :title="file.path">{{ truncatePath(file.path) }}</span>
              <div class="file-actions">
                <button class="file-action-btn" @click.stop="handleCopyPath(file)" :title="t('scm.copyPath')" aria-label="复制路径"><Copy :size="12" /></button>
                <button class="file-action-btn" @click.stop="handleUnstage(file)" :title="t('scm.unstage')" aria-label="取消暂存"><Undo2 :size="12" /></button>
                <button class="file-action-btn" @click.stop="handleStage(file)" :title="t('scm.stage')" aria-label="暂存"><Plus :size="12" /></button>
              </div>
            </div>
          </template>
          <!-- Unstaged + Untracked -->
          <template v-if="scmStore.unstaged.length > 0 || scmStore.untracked.length > 0">
            <div class="sub-group-label" @click.stop="handleStageAll" :title="t('scm.stageAllChanges')">{{ t('scm.changesCount') }} <span class="sub-count">{{ scmStore.unstaged.length + scmStore.untracked.length }}</span></div>
            <div
              v-for="file in scmStore.unstaged"
              :key="'unstaged-' + file.path"
              class="change-file-row"
              :class="{ selected: scmStore.selectedFile?.path === file.path && !scmStore.selectedFileStaged }"
              @click="handleSelectFile(file, false)"
            >
              <span class="file-status-badge" :class="getStatusClass(file)">{{ getStatusLetter(file) }}</span>
              <span class="file-lang-icon">{{ getLangIcon(file.path) }}</span>
              <span class="file-name" :title="file.path">{{ getFileName(file.path) }}</span>
              <span class="file-path-truncated" :title="file.path">{{ truncatePath(file.path) }}</span>
              <div class="file-actions">
                  <button class="file-action-btn" @click.stop="handleCopyPath(file)" :title="t('scm.copyPath')" aria-label="复制路径"><Copy :size="12" /></button>
                  <button class="file-action-btn discard" @click.stop="handleDiscard(file)" :title="t('scm.discardChanges')" aria-label="放弃更改"><Undo2 :size="12" /></button>
                  <button class="file-action-btn" @click.stop="handleStage(file)" :title="t('scm.stage')" aria-label="暂存"><Plus :size="12" /></button>
                </div>
            </div>
            <div
              v-for="file in scmStore.untracked"
              :key="'untracked-' + file.path"
              class="change-file-row untracked-row"
              :class="{ selected: scmStore.selectedFile?.path === file.path && !scmStore.selectedFileStaged }"
              @click="handleSelectFile(file, false)"
            >
              <span class="file-status-badge untracked">U</span>
              <span class="file-lang-icon">{{ getLangIcon(file.path) }}</span>
              <span class="file-name" :title="file.path">{{ getFileName(file.path) }}</span>
              <span class="file-path-truncated" :title="file.path">{{ truncatePath(file.path) }}</span>
              <div class="file-actions">
                  <button class="file-action-btn" @click.stop="handleStage(file)" :title="t('scm.stage')" aria-label="暂存"><Plus :size="12" /></button>
                </div>
            </div>
          </template>
          <div v-if="scmStore.totalChanges === 0 && scmStore.isRepo && !scmStore.isLoading" class="no-changes">
            {{ t('scm.noChanges') }}
          </div>
        </div>
      </div>

      <!-- Conflicts -->
      <div v-if="scmStore.conflicted.length > 0" class="change-group conflicts">
        <div class="group-header" @click="conflictsCollapsed = !conflictsCollapsed">
          <ChevronRight :size="12" :class="{ rotated: !conflictsCollapsed }" />
          <span class="group-title conflict-title">合并冲突</span>
          <span class="group-count conflict-count">{{ scmStore.conflicted.length }}</span>
        </div>
        <div v-show="!conflictsCollapsed" class="group-content">
          <div
            v-for="file in scmStore.conflicted"
            :key="'conflict-' + file.path"
            class="change-file-row conflict"
            @click="handleSelectFile(file, false)"
          >
            <span class="file-status-badge conflict">C</span>
            <span class="file-name" :title="file.path">{{ getFileName(file.path) }}</span>
            <span class="file-path-truncated" :title="file.path">{{ truncatePath(file.path) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Resize Handle (draggable splitter) -->
    <div
      class="resize-handle"
      @mousedown="startResize"
      :class="{ active: isResizing }"
    ></div>

    <!-- Git Graph / Graph Section (fills remaining space) -->
    <div
      class="graph-section"
      :style="{ flex: graphFlex + ' 1 0%' }"
    >
      <div class="graph-header" @click="graphCollapsed = !graphCollapsed">
        <ChevronRight :size="12" :class="{ rotated: !graphCollapsed }" />
        <span class="graph-title">图形</span>
        <div class="graph-toolbar">
          <button class="graph-tool-btn" :class="{ active: graphViewMode === 'auto' }" @click.stop="graphViewMode = 'auto'" title="Auto Layout">
            <GitMerge :size="13" />
            <span>自动</span>
          </button>
          <button class="graph-tool-btn" :class="{ active: graphViewMode === 'linear' }" @click.stop="graphViewMode = 'linear'" title="Linear" aria-label="线性视图">
            <CircleDot :size="13" />
          </button>
          <button class="graph-tool-btn" @click.stop="handleFetchAll" title="Fetch All" aria-label="获取全部">
            <ArrowDownToLine :size="13" />
          </button>
          <button class="graph-tool-btn" @click.stop="handlePull" title="Pull" aria-label="拉取">
            <ArrowDown :size="13" />
          </button>
          <button class="graph-tool-btn" @click.stop="handlePush" title="Push" aria-label="推送">
            <ArrowUp :size="13" />
          </button>
          <button class="graph-tool-btn" @click.stop="handleRefreshGraph" title="Refresh Graph" aria-label="刷新图形">
            <RefreshCw :size="13" :class="{ spinning: graphLoading }" />
          </button>
        </div>
      </div>
      <div v-show="!graphCollapsed" class="graph-content">
        <div v-if="graphLoading" class="graph-loading">加载中...</div>
        <div v-else-if="scmStore.log.length === 0 && scmStore.isRepo" class="no-commits">没有提交记录</div>
        <div v-else class="commit-graph-list">
          <div
            v-for="(entry, idx) in scmStore.log"
            :key="entry.hash"
            class="commit-row"
            :class="{ selected: selectedCommitHash === entry.hash }"
            @click="selectCommit(entry)"
          >
            <!-- Graph decoration column (left dots/lines) -->
            <div class="graph-deco">
              <span class="deco-dot" :class="{ current: entry.refs.includes('HEAD') || idx === 0 }"></span>
            </div>
            <!-- Commit info -->
            <div class="commit-info">
              <div class="commit-subject" :title="entry.subject">{{ entry.subject }}</div>
              <div class="commit-meta">
                <span v-if="entry.refs" class="commit-refs">
                  <span v-if="entry.refs.includes('HEAD')" class="ref-tag head">
                    <CircleDot :size="10" /> {{ scmStore.branch }}
                  </span>
                  <span v-for="(ref, ri) in parseRefs(entry.refs).filter(r => r.type === 'tag')" :key="ri" class="ref-tag tag">
                    <Tag :size="10" /> {{ ref.name }}
                  </span>
                  <span v-for="(ref, ri) in parseRefs(entry.refs).filter(r => r.type === 'remote')" :key="'r'+ri" class="ref-tag remote">
                    <Cloud :size="10" /> {{ ref.name }}
                  </span>
                </span>
                <span v-if="getRelativeDate(entry.date)" class="commit-date">{{ getRelativeDate(entry.date) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Not a repo -->
    <div v-if="!scmStore.isRepo && !scmStore.isLoading" class="empty-scm">
      <div class="empty-icon">
        <GitBranch :size="28" />
      </div>
      <h4>源代码管理</h4>
      <p>若要查看更改建议，请打开文件夹。</p>
    </div>

    <!-- Error -->
    <div v-if="scmStore.error" class="scm-error">
      <AlertCircle :size="14" />
      <span>{{ scmStore.error }}</span>
    </div>

    <!-- More Actions Dropdown Menu -->
    <div v-if="showMoreMenu" class="more-menu" @click.stop>
      <button class="more-menu-item" @click="handleStageAll(); showMoreMenu = false">
        <Check :size="12" /> {{ t('scm.stageAllChanges') }}
      </button>
      <button class="more-menu-item" @click="handleUnstageAll(); showMoreMenu = false">
        <Undo2 :size="12" /> 取消暂存所有更改
      </button>
      <button class="more-menu-item danger" @click="handleDiscardAll(); showMoreMenu = false">
        <Trash2 :size="12" /> 丢弃所有更改
      </button>
      <div class="more-menu-divider"></div>
      <button class="more-menu-item" @click="handleRefresh(); showMoreMenu = false">
        <RefreshCw :size="12" /> 刷新状态
      </button>
    </div>

    <!-- Create branch dialog -->
    <div v-if="showCreateBranch" class="create-branch-dialog" @click.self="showCreateBranch = false">
      <div class="dialog-content">
        <h4>创建分支</h4>
        <input
          v-model="newBranchName"
          class="branch-name-input"
          placeholder="分支名称"
          @keydown.enter="handleCreateBranch"
          ref="branchInput"
        />
        <div class="dialog-actions">
          <button class="dialog-btn cancel" @click="showCreateBranch = false">{{ t('common.cancel') }}</button>
          <button class="dialog-btn create" :disabled="!newBranchName.trim()" @click="handleCreateBranch">
            创建并切换
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useScmStore } from '@/stores/scm'
import { useAppStore } from '@/stores/app'
import {
  GitBranch, Plus, Check, ChevronRight, ChevronDown,
  RefreshCw, ArrowUp, ArrowDown, Archive, Undo2, AlertCircle,
  MoreHorizontal, Copy, Tag, Cloud, CircleDot,
  GitMerge, ArrowDownToLine, Trash2, Sparkles
} from 'lucide-vue-next'
import type { ScmFile, ScmLogEntry } from '@/stores/scm'

const scmStore = useScmStore()
const appStore = useAppStore()
const { t } = useI18n()

const stagedCollapsed = ref(false)
const conflictsCollapsed = ref(false)
const graphCollapsed = ref(false)
const showBranchDropdown = ref(false)
const showCreateBranch = ref(false)
const newBranchName = ref('')
const branchInput = ref<HTMLInputElement | null>(null)
const graphLoading = ref(false)
const graphViewMode = ref<'auto' | 'linear'>('auto')
const selectedCommitHash = ref<string | null>(null)
const showMoreMenu = ref(false)
const showCommitMenu = ref(false)
const commitTextarea = ref<HTMLTextAreaElement | null>(null)
const commitTextareaRows = ref(2)

const COMMIT_TEXTAREA_MIN_ROWS = 2
const COMMIT_TEXTAREA_MAX_ROWS = 12

// --- Resize handle state (flex-based) ---
const isResizing = ref(false)
const changesFlex = ref(2)
const graphFlex = ref(1)
let removeResizeListeners: (() => void) | null = null

function startResize(e: MouseEvent): void {
  e.preventDefault()
  isResizing.value = true

  const panel = (e.currentTarget as HTMLElement).closest('.scm-panel') as HTMLElement
  if (!panel) return

  const changesEl = panel.querySelector('.changes-container') as HTMLElement
  const graphEl = panel.querySelector('.graph-section') as HTMLElement
  if (!changesEl || !graphEl) return

  const startY = e.clientY
  const startChangesHeight = changesEl.getBoundingClientRect().height
  const startGraphHeight = graphEl.getBoundingClientRect().height

  function onMouseMove(moveEvent: MouseEvent): void {
    const deltaY = moveEvent.clientY - startY
    const newChangesHeight = Math.max(80, startChangesHeight + deltaY)
    const newGraphHeight = Math.max(80, startGraphHeight - deltaY)
    const total = newChangesHeight + newGraphHeight
    changesFlex.value = newChangesHeight / total
    graphFlex.value = newGraphHeight / total
  }

  function onMouseUp(): void {
    isResizing.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    removeResizeListeners = null
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)

  removeResizeListeners = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    isResizing.value = false
  }

  document.body.style.cursor = 'ns-resize'
  document.body.style.userSelect = 'none'
}

let refreshTimer: ReturnType<typeof setInterval> | null = null

const localBranches = computed(() =>
  scmStore.branches.filter(b => !b.isRemote)
)
const remoteBranches = computed(() =>
  scmStore.branches.filter(b => b.isRemote)
)

// --- File helpers ---

function getLangIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'TS', tsx: 'TS', js: 'JS', jsx: 'JS',
    vue: 'Vue', py: 'PY', rs: 'RS', go: 'GO',
    java: 'JV', kt: 'KT', swift: 'SV',
    c: 'C', cpp: 'C++', h: 'H', hpp: 'H++',
    md: 'MD', json: 'JN', yaml: 'YM', yml: 'YM',
    html: 'HT', css: 'CS', scss: 'SC', less: 'LS',
    sh: 'SH', bash: 'Bash', sql: 'SQL', xml: 'XM',
    svg: 'SVG', png: 'IMG', jpg: 'IMG', gif: 'IMG',
  }
  return map[ext] || '?'
}

function getFileName(path: string): string {
  // Handle both forward and backward slashes
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
}

function truncatePath(path: string, maxLen = 20): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  if (parts.length <= 1) return '' // 无目录部分，不显示
  const dirParts = parts.slice(0, -1) // 去掉文件名，只保留目录
  const dirPath = dirParts.join('/')
  if (dirPath.length <= maxLen) return dirPath
  return '.../' + dirParts.slice(-2).join('/')
}

function getStatusClass(file: ScmFile): string {
  return file.status
}

function getStatusLetter(file: ScmFile): string {
  const map: Record<string, string> = {
    modified: 'M', added: 'A', deleted: 'D',
    renamed: 'R', copied: 'C', untracked: 'U',
    ignored: 'I', conflict: 'C',
  }
  return map[file.status] || file.statusCode
}

function handleCopyPath(file: ScmFile): void {
  navigator.clipboard.writeText(file.path).catch(() => {})
}

function autoResizeTextarea(): void {
  const el = commitTextarea.value
  if (!el) return
  const text = el.value
  const lineCount = text.split('\n').length
  const wrappedLines = text.split('\n').reduce((acc, line) => {
    if (!line) return acc + 1
    const charWidth = el.clientWidth > 0 ? el.clientWidth / (parseFloat(getComputedStyle(el).fontSize) * 0.6) : 80
    return acc + Math.max(1, Math.ceil(line.length / charWidth))
  }, 0)
  commitTextareaRows.value = Math.min(Math.max(wrappedLines, COMMIT_TEXTAREA_MIN_ROWS, lineCount), COMMIT_TEXTAREA_MAX_ROWS)
}

// --- Commit helpers ---

interface ParsedRef { name: string; type: 'head' | 'local' | 'remote' | 'tag' }

function parseRefs(refsStr: string): ParsedRef[] {
  const result: ParsedRef[] = []
  for (const part of refsStr.split(', ')) {
    const trimmed = part.trim()
    if (!trimmed || trimmed === 'HEAD') continue
    if (trimmed.startsWith('tag: ')) result.push({ name: trimmed.substring(5), type: 'tag' })
    else if (trimmed.startsWith('origin/')) result.push({ name: trimmed.replace('origin/', ''), type: 'remote' })
    else result.push({ name: trimmed, type: 'local' })
  }
  return result
}

function getRelativeDate(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d`
    return new Date(dateStr).toLocaleDateString()
  } catch { return '' }
}

function selectCommit(entry: ScmLogEntry): void {
  selectedCommitHash.value = entry.hash
}

// --- Action handlers ---

function handleSelectFile(file: ScmFile, isStaged: boolean): void {
  scmStore.selectFile(file, isStaged)
  appStore.openScmDiff(file.path)
}

async function handleStage(file: ScmFile): Promise<void> {
  await scmStore.stagePaths([file.path])
}

async function handleUnstage(file: ScmFile): Promise<void> {
  await scmStore.unstagePaths([file.path])
}

async function handleStageAll(): Promise<void> {
  await scmStore.stageAllFiles()
}

async function handleDiscardAll(): Promise<void> {
  const allPaths = [
    ...scmStore.unstaged.map(f => f.path),
    ...scmStore.untracked.map(f => f.path),
  ]
  if (allPaths.length === 0) return
  // Confirm before discarding
  if (!confirm(`确定要丢弃 ${allPaths.length} 个文件的更改吗？此操作不可恢复。`)) return
  await scmStore.discardFileChanges(allPaths)
}

async function handleUnstageAll(): Promise<void> {
  await scmStore.unstageAllFiles()
}

async function handleDiscard(file: ScmFile): Promise<void> {
  await scmStore.discardFileChanges([file.path])
}

async function handleCommit(): Promise<void> {
  if (!scmStore.commitMessage.trim() || scmStore.stagedCount === 0) return
  await scmStore.commitChanges()
  nextTick(() => autoResizeTextarea())
}

async function handleGenerateCommitMessage(): Promise<void> {
  if (scmStore.stagedCount === 0) return
  try {
    const message = await scmStore.generateCommitMessage()
    if (message) {
      scmStore.commitMessage = message
      nextTick(() => autoResizeTextarea())
    }
  } catch (e: any) {
    console.error('[ScmPanel] AI commit message generation failed:', e)
    // Show error briefly - could use a toast/notification in future
    scmStore.error = e.message || 'Failed to generate commit message'
    setTimeout(() => { if (scmStore.error === e.message) scmStore.error = null }, 4000)
  }
}

async function handleCommitAmend(): Promise<void> {
  if (!scmStore.commitMessage.trim() || scmStore.stagedCount === 0) return
  await scmStore.commitChanges(undefined, true)
}

async function handleCommitAndPush(): Promise<void> {
  if (!scmStore.commitMessage.trim() || scmStore.stagedCount === 0) return
  const result = await scmStore.commitChanges()
  if (result?.success) {
    await scmStore.push()
  }
}

async function handleCommitAndSync(): Promise<void> {
  if (!scmStore.commitMessage.trim() || scmStore.stagedCount === 0) return
  // Sync = pull first, then commit, then push
  await scmStore.pull()
  const result = await scmStore.commitChanges()
  if (result?.success) {
    await scmStore.push()
  }
}

async function handleRefresh(): Promise<void> {
  await scmStore.refresh()
  await scmStore.refreshBranches()
}

async function handlePull(): Promise<void> {
  await scmStore.pull()
}

async function handlePush(): Promise<void> {
  await scmStore.push()
}

async function handleStash(): Promise<void> {
  if (scmStore.unstagedCount > 0) {
    await scmStore.stash()
  } else {
    await scmStore.stashPop()
  }
}

async function handleCheckout(ref: string): Promise<void> {
  await scmStore.checkoutBranch(ref)
  showBranchDropdown.value = false
}

async function handleCreateBranch(): Promise<void> {
  if (!newBranchName.value.trim()) return
  await scmStore.createBranch(newBranchName.value.trim(), true)
  newBranchName.value = ''
  showCreateBranch.value = false
  showBranchDropdown.value = false
}

async function handleRefreshGraph(): Promise<void> {
  graphLoading.value = true
  await scmStore.refreshLog(50)
  graphLoading.value = false
}

async function handleFetchAll(): Promise<void> {
  // Fetch all remotes - uses git fetch --all
  await scmStore.fetchAll()
}

watch(showCreateBranch, (val) => {
  if (val) nextTick(() => branchInput.value?.focus())
})

watch(() => appStore.projectRoot, async () => {
  await scmStore.refresh()
  await scmStore.refreshBranches()
  await scmStore.refreshLog(50)
})

// Click outside to close menus
function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.more-menu') && !target.closest('.group-icon-btn.more')) {
    showMoreMenu.value = false
  }
  if (!target.closest('.commit-dropdown-menu') && !target.closest('.commit-btn.dropdown')) {
    showCommitMenu.value = false
  }
}

onMounted(async () => {
  await scmStore.refresh()
  await scmStore.refreshBranches()
  await scmStore.refreshLog(50)
  // Polling as fallback (event-driven refresh is primary via git:statusChanged)
  refreshTimer = setInterval(() => {
    scmStore.refresh()
  }, 60000)
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  scmStore.stopWatching()
  document.removeEventListener('click', handleClickOutside)
  if (removeResizeListeners) removeResizeListeners()
})
</script>

<style lang="scss" scoped>
.scm-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

// --- Header ---
.scm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-bottom: 1px solid var(--surface-border);
  gap: 4px;
  min-height: 34px;
}

.branch-info {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 11px;
  color: var(--text-primary);
  transition: background var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); }

  .branch-name {
    font-weight: 500;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.scm-actions {
  display: flex;
  gap: 1px;
}

.scm-action-btn {
  @include reset-button;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  transition: all var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--accent-primary);
  }

  .spinning { animation: spin 1s linear infinite; }
}

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

// --- Branch Dropdown ---
.branch-dropdown {
  position: absolute;
  top: 38px;
  left: 4px;
  right: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 100;
  max-height: 280px;
  overflow-y: auto;
  @include scrollbar-thin;
}

.branch-dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-bottom: 1px solid var(--surface-border);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.branch-create-btn {
  @include reset-button;
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  &:hover { background: var(--accent-primary); color: white; }
}

.branch-list { padding: 3px; }

.branch-section-title {
  padding: 5px 10px 3px;
  font-size: 9px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.branch-item {
  @include reset-button;
  display: flex; align-items: center; gap: 5px;
  width: 100%; padding: 5px 7px;
  border-radius: var(--radius-sm);
  font-size: 11px; color: var(--text-primary);
  text-align: left;

  &:hover { background: var(--surface-glass-hover); }
  &.active { color: var(--accent-primary); }
  span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}

// --- Commit Section ---
.commit-section {
  padding: 6px 8px;
  border-bottom: 1px solid var(--surface-border);
}

.commit-input-wrapper {
  position: relative;
}

.commit-input {
  width: 100%;
  padding: 6px 36px 6px 8px; /* right padding to avoid overlap with Sparkles button */
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 11px;
  resize: vertical;
  min-height: 40px;
  outline: none;
  transition: border-color var(--transition-fast);
  line-height: 1.4;

  &:focus { border-color: var(--accent-primary); }
  &::placeholder { color: var(--text-muted); opacity: 0.7; }
}

.commit-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
  gap: 2px;
}

.ai-commit-btn {
  @include reset-button;
  position: absolute;
  bottom: 6px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  transition: all var(--transition-fast);
  cursor: pointer;
  z-index: 1;

  &:hover {
    background: rgba(var(--accent-primary-rgb, 59,130,246), 0.1);
    color: var(--accent-primary);
  }

  &.generating {
    color: var(--accent-primary);
    animation: ai-pulse 1.2s ease-in-out infinite;

    .spin {
      animation: spin 1s linear infinite;
    }
  }
}

@keyframes ai-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.commit-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 30px;
  font-size: 12px;
  font-weight: 500;
  transition: all var(--transition-fast);
  cursor: pointer;

  &.primary {
    flex: 1;
    background: var(--success);
    color: white;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
    &:hover { background: #5bc48e; }
  }

  &.dropdown {
    width: 32px;
    padding: 0;
    background: var(--success);
    color: white;
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    &:hover { background: #5bc48e; }
  }
}

.dropdown-wrapper {
  position: relative;
  display: inline-block;
}

.commit-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 150;
  min-width: 140px;
  padding: 3px;
}

.commit-menu-item {
  @include reset-button;
  display: block;
  width: 100%;
  padding: 6px 10px;
  border-radius: var(--radius-xs);
  font-size: 12px;
  color: var(--text-primary);
  text-align: left;

  &:hover { background: var(--surface-glass-hover); }
}

.commit-menu-divider {
  height: 1px;
  background: var(--surface-border);
  margin: 2px 4px;
}

// --- Change Groups ---
.change-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px 8px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
  min-height: 26px;

  &:hover { background: var(--surface-glass-hover); }

  .rotated { transform: rotate(90deg); }
  svg:first-child { transition: transform var(--transition-fast); color: var(--text-muted); }
}

.group-title {
  flex: 1;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
}

.group-actions-right {
  display: flex;
  align-items: center;
  gap: 1px;
  margin-left: auto;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.group-header:hover .group-actions-right {
  opacity: 1;
}

.group-icon-btn {
  @include reset-button;
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  transition: all var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); color: var(--text-primary); }
  &.more:hover { background: transparent; }
}

.group-content {
  flex: 1;
  overflow-y: auto;
  @include scrollbar-thin;
  padding: 0 2px 3px;
}

.sub-group-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-secondary, var(--text-muted));
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 4px 8px 2px;

  .sub-count {
    margin-left: 4px;
    color: var(--accent-primary);
  }
}

// --- File Rows ---
.change-file-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  min-height: 26px;

  &:hover { background: var(--surface-glass-hover); }
  &.selected { background: var(--surface-glass-active); }
  &.conflict .file-name { color: var(--error); }
}

.file-status-badge {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  width: 16px; height: 16px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 2px;
  flex-shrink: 0;
  letter-spacing: 0.02em;

  &.modified { color: #d97706; background: rgba(217,119,6,0.12); }
  &.added   { color: #16a34a; background: rgba(22,163,74,0.12); }
  &.deleted { color: #dc2626; background: rgba(220,38,38,0.12); }
  &.renamed { color: #2563eb; background: rgba(37,99,235,0.12); }
  &.untracked { color: var(--text-muted); background: var(--surface-glass); }
  &.conflict { color: #dc2626; background: rgba(220,38,38,0.15); }
  &.staged { color: #16a34a; background: rgba(22,163,74,0.15); }
}

.file-lang-icon {
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 700;
  color: var(--text-muted);
  background: var(--surface-glass);
  padding: 1px 3px;
  border-radius: 2px;
  flex-shrink: 0;
  min-width: 20px;
  text-align: center;
  letter-spacing: 0.01em;
}

.file-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 90px;
  flex-shrink: 0;
}

.file-path-truncated {
  flex: 1;
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.file-actions {
  display: flex;
  gap: 1px;
  opacity: 0;
  transition: opacity var(--transition-fast);

  .change-file-row:hover & { opacity: 1; }
}

.file-action-btn {
  @include reset-button;
  width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  transition: all var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); color: var(--accent-primary); }
  &.discard:hover { color: var(--error); }
}

.no-changes {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 8px;
}

// --- Conflict ---
.conflict-title { color: var(--error) !important; }
.conflict-count { background: rgba(220,53,69,0.15) !important; color: var(--error) !important; }

// --- Resize Handle ---
.resize-handle {
  height: 4px;
  cursor: ns-resize;
  background: var(--surface-border);
  transition: background var(--transition-fast);
  flex-shrink: 0;
  position: relative;
  z-index: 10;

  &:hover, &.active {
    background: var(--accent-primary);
  }

  &::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 24px;
    height: 2px;
    background: var(--text-muted);
    border-radius: 1px;
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  &:hover::after, &.active::after {
    opacity: 1;
    background: white;
  }
}

// --- Changes Container (upper resizable section) ---
.changes-container {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 80px;
}

// --- Git Graph Section (lower section, fills remaining space) ---
.graph-section {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 80px;
}

.graph-header {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px 8px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
  min-height: 26px;

  &:hover { background: var(--surface-glass-hover); }
  .rotated { transform: rotate(90deg); }
  svg:first-child { transition: transform var(--transition-fast); color: var(--text-muted); }
}

.graph-title {
  flex: 1;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
}

.graph-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.graph-tool-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 5px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  color: var(--text-muted);
  transition: all var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); color: var(--text-primary); }
  &.active { color: var(--accent-primary); background: rgba(var(--accent-primary-rgb, 59,130,246), 0.08); }

  .spinning { animation: spin 1s linear infinite; }
}

.graph-content {
  flex: 1;
  overflow-y: auto;
  @include scrollbar-thin;
}

.graph-loading, .no-commits, .no-changes {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 16px 8px;
}

.commit-graph-list { padding: 0 4px 4px; }

.commit-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 3px 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); }
  &.selected { background: var(--surface-glass-active); }
}

.graph-deco {
  width: 18px;
  flex-shrink: 0;
  padding-top: 6px;
  display: flex;
  justify-content: center;
}

.deco-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  border: 2px solid var(--bg-elevated);

  &.current { background: var(--accent-primary); }
}

.commit-info {
  flex: 1;
  min-width: 0;
  padding-top: 1px;
}

.commit-subject {
  font-size: 11px;
  color: var(--text-primary);
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.commit-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 1px;
  flex-wrap: wrap;
}

.commit-refs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
}

.ref-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 9px;
  font-weight: 600;
  padding: 0 5px;
  border-radius: var(--radius-full);
  line-height: 1.5;

  &.head { color: var(--accent-primary); background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.3); }
  &.tag  { color: #d97706; background: rgba(217,119,6,0.12); }
  &.remote { color: #7c3aed; background: rgba(124,58,237,0.12); }
}

.commit-date {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
}

// --- Empty state ---
.empty-scm {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 32px 16px;
  text-align: center;

  .empty-icon {
    width: 48px; height: 48px;
    border-radius: var(--radius-lg);
    background: var(--surface-glass);
    border: 1px solid var(--surface-border);
    @include flex-center;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  h4 { font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary); }
  p  { font-size: 11px; color: var(--text-muted); line-height: 1.5; max-width: 200px; }
}

.scm-error {
  display: flex; align-items: center; gap: 5px;
  padding: 6px 10px;
  margin: 3px 6px;
  background: rgba(220,53,69,0.1);
  border-radius: var(--radius-sm);
  color: var(--error);
  font-size: 10px;
  span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}

// --- More Actions Menu ---
.more-menu {
  position: absolute;
  top: auto;
  right: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 150;
  min-width: 160px;
  padding: 3px;
}

.more-menu-item {
  @include reset-button;
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 6px 8px;
  border-radius: var(--radius-xs);
  font-size: 11px; color: var(--text-primary);
  text-align: left;

  &:hover { background: var(--surface-glass-hover); }
  &.danger { color: var(--error); &:hover { background: rgba(220,53,69,0.08); } }

  svg { flex-shrink: 0; color: var(--text-muted); }
  &.danger svg { color: var(--error); opacity: 0.7; }
}

.more-menu-divider {
  height: 1px;
  background: var(--surface-border);
  margin: 2px 4px;
}

// --- Dialog ---
.create-branch-dialog {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 200;
}

.dialog-content {
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  padding: 14px;
  width: 88%;
  box-shadow: var(--shadow-lg);
  h4 { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
}

.branch-name-input {
  width: 100%;
  padding: 7px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 11px;
  outline: none;
  &:focus { border-color: var(--accent-primary); }
}

.dialog-actions {
  display: flex; justify-content: flex-end; gap: 6px;
  margin-top: 10px;
}

.dialog-btn {
  @include reset-button;
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  font-size: 11px; font-weight: 500;

  &.cancel { color: var(--text-muted); &:hover { background: var(--surface-glass-hover); } }
  &.create  { background: var(--accent-primary); color: white; &:hover:not(:disabled) { background: var(--accent-primary-hover); } &:disabled { opacity: 0.45; cursor: not-allowed; } }
}
</style>
