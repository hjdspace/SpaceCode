<template>
  <div class="scm-panel">
    <!-- Header: branch info + actions -->
    <div class="scm-header">
      <div class="branch-info" @click="showBranchDropdown = !showBranchDropdown">
        <GitBranch :size="14" />
        <span class="branch-name">{{ scmStore.branch || 'No branch' }}</span>
        <ChevronDown :size="12" />
      </div>
      <div class="scm-actions">
        <button class="scm-action-btn" @click="handleRefresh" title="Refresh">
          <RefreshCw :size="14" :class="{ spinning: scmStore.isLoading }" />
        </button>
        <button class="scm-action-btn" @click="handlePull" title="Pull">
          <ArrowDown :size="14" />
        </button>
        <button class="scm-action-btn" @click="handlePush" title="Push">
          <ArrowUp :size="14" />
        </button>
        <button class="scm-action-btn" @click="handleStash" title="Stash">
          <Archive :size="14" />
        </button>
      </div>
    </div>

    <!-- Branch dropdown -->
    <div v-if="showBranchDropdown" class="branch-dropdown" @click.stop>
      <div class="branch-dropdown-header">
        <span>Branches</span>
        <button class="branch-create-btn" @click="showCreateBranch = true">
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
      <div v-if="remoteBranches.length > 0" class="branch-section-title">REMOTE</div>
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
      <textarea
        v-model="scmStore.commitMessage"
        class="commit-input"
        :placeholder="'Message (Ctrl+Enter to commit on ' + (scmStore.branch || 'HEAD') + ')'"
        rows="2"
        @keydown.ctrl.enter="handleCommit"
      ></textarea>
      <div class="commit-actions">
        <button
          class="ai-commit-btn"
          title="AI 生成提交消息 (分析更改并生成符合规范的提交消息)"
          @click="handleGenerateCommitMessage"
          :class="{ generating: scmStore.isGeneratingCommitMessage }"
        >
          <Sparkles :size="14" :class="{ spin: scmStore.isGeneratingCommitMessage }" />
        </button>
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
              提交
            </button>
            <button class="commit-menu-item" @click="handleCommitAmend(); showCommitMenu = false">
              提交（修改）
            </button>
            <div class="commit-menu-divider"></div>
            <button class="commit-menu-item" @click="handleCommitAndPush(); showCommitMenu = false">
              提交和推送
            </button>
            <button class="commit-menu-item" @click="handleCommitAndSync(); showCommitMenu = false">
              提交和同步
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Staged changes -->
    <div class="change-group">
      <div class="group-header" @click="stagedCollapsed = !stagedCollapsed">
        <ChevronRight :size="12" :class="{ rotated: !stagedCollapsed }" />
        <span class="group-title">更改</span>
        <div class="group-actions-right">
          <button class="group-icon-btn" title="Discard All Changes" @click.stop="handleDiscardAll">
            <Trash2 :size="14" />
          </button>
          <button class="group-icon-btn" title="Stage All Changes" @click.stop="handleStageAll">
            <Check :size="14" />
          </button>
          <button class="group-icon-btn" title="Refresh" @click.stop="handleRefresh">
            <RefreshCw :size="14" />
          </button>
          <button class="group-icon-btn more" title="More Actions" @click.stop="showMoreMenu = !showMoreMenu">
            <MoreHorizontal :size="14" />
          </button>
        </div>
      </div>
      <div v-show="!stagedCollapsed" class="group-content">
        <!-- Staged files -->
        <template v-if="scmStore.staged.length > 0">
          <div class="sub-group-label">已暂存的更改</div>
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
              <button class="file-action-btn" @click.stop="handleCopyPath(file)" title="Copy Path"><Copy :size="12" /></button>
              <button class="file-action-btn" @click.stop="handleUnstage(file)" title="Unstage"><Undo2 :size="12" /></button>
              <button class="file-action-btn" @click.stop="handleStage(file)" title="Stage"><Plus :size="12" /></button>
            </div>
          </div>
        </template>
        <!-- Unstaged + Untracked -->
        <template v-if="scmStore.unstaged.length > 0 || scmStore.untracked.length > 0">
          <div class="sub-group-label" @click.stop="handleStageAll" title="Click to stage all changes">更改 <span class="sub-count">{{ scmStore.unstaged.length + scmStore.untracked.length }}</span></div>
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
              <button class="file-action-btn" @click.stop="handleCopyPath(file)" title="Copy Path"><Copy :size="12" /></button>
              <button class="file-action-btn discard" @click.stop="handleDiscard(file)" title="Discard Changes"><Undo2 :size="12" /></button>
              <button class="file-action-btn" @click.stop="handleStage(file)" title="Stage"><Plus :size="12" /></button>
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
              <button class="file-action-btn" @click.stop="handleStage(file)" title="Stage"><Plus :size="12" /></button>
            </div>
          </div>
        </template>
        <div v-if="scmStore.totalChanges === 0 && scmStore.isRepo && !scmStore.isLoading" class="no-changes">
          没有更改
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

    <!-- Git Graph / Graph Section -->
    <div class="graph-section">
      <div class="graph-header" @click="graphCollapsed = !graphCollapsed">
        <ChevronRight :size="12" :class="{ rotated: !graphCollapsed }" />
        <span class="graph-title">图形</span>
        <div class="graph-toolbar">
          <button class="graph-tool-btn" :class="{ active: graphViewMode === 'auto' }" @click.stop="graphViewMode = 'auto'" title="Auto Layout">
            <GitMerge :size="13" />
            <span>自动</span>
          </button>
          <button class="graph-tool-btn" :class="{ active: graphViewMode === 'linear' }" @click.stop="graphViewMode = 'linear'" title="Linear">
            <CircleDot :size="13" />
          </button>
          <button class="graph-tool-btn" @click.stop="handleFetchAll" title="Fetch All">
            <ArrowDownToLine :size="13" />
          </button>
          <button class="graph-tool-btn" @click.stop="handlePull" title="Pull">
            <ArrowDown :size="13" />
          </button>
          <button class="graph-tool-btn" @click.stop="handlePush" title="Push">
            <ArrowUp :size="13" />
          </button>
          <button class="graph-tool-btn" @click.stop="handleRefreshGraph" title="Refresh Graph">
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
        <Check :size="12" /> 暂存所有更改
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
          <button class="dialog-btn cancel" @click="showCreateBranch = false">取消</button>
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
  if (normalized.length <= maxLen) return normalized
  const parts = normalized.split('/')
  if (parts.length <= 1) return parts[0]
  return '...' + '/' + parts.slice(-2).join('/')
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
  appStore.showInfoPanel('diff')
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
}

async function handleGenerateCommitMessage(): Promise<void> {
  if (scmStore.totalChanges === 0) return
  try {
    const message = await scmStore.generateCommitMessage()
    if (message) {
      scmStore.commitMessage = message
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
  refreshTimer = setInterval(() => {
    scmStore.refresh()
  }, 15000)
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  document.removeEventListener('click', handleClickOutside)
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

.commit-input {
  width: 100%;
  padding: 6px 8px;
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
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--surface-border);
  transition: all var(--transition-fast);
  cursor: pointer;

  &:hover {
    background: rgba(var(--accent-primary-rgb, 59,130,246), 0.08);
    color: var(--accent-primary);
    border-color: var(--accent-primary);
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
    background: #6ecf9e;
    color: white;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
    &:hover { background: #5bc48e; }
  }

  &.dropdown {
    width: 32px;
    padding: 0;
    background: #6ecf9e;
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
  border-bottom: 1px solid var(--surface-border);
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
  overflow-y: auto;
  max-height: 220px;
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

// --- Git Graph Section ---
.graph-section {
  border-top: 1px solid var(--surface-border);
  flex-shrink: 0;
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
  max-height: 260px;
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
  h4 { font-size: 14px; font-weight: 600; color: var(--text-primary); }
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
