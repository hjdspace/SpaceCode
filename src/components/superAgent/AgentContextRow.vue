<template>
  <div v-if="repoRoot" class="agent-context-row" data-testid="agent-context-row">
    <!-- Workspace name (read-only display) -->
    <span class="ctx-workspace" :title="repoRoot">
      <Folder :size="13" class="ctx-icon" />
      <span class="ctx-name">{{ workspaceName }}</span>
    </span>

    <span class="ctx-sep" aria-hidden="true">/</span>

    <!-- Directory selector dropdown -->
    <div class="ctx-selector">
      <button
        class="ctx-trigger"
        data-testid="agent-context-dir-trigger"
        :class="{ active: showDirDropdown }"
        @click="toggleDirDropdown"
      >
        <FolderOpen :size="13" class="ctx-icon" />
        <span class="ctx-label">{{ dirDisplayName }}</span>
        <ChevronDown :size="11" class="ctx-arrow" :class="{ open: showDirDropdown }" />
      </button>

      <Transition name="ctx-dropdown">
        <div v-if="showDirDropdown" class="ctx-dropdown" data-testid="agent-context-dir-dropdown" v-click-outside="closeDirDropdown">
          <div class="ctx-search">
            <Search :size="13" class="ctx-search-icon" />
            <input
              ref="dirSearchInput"
              v-model="dirSearch"
              type="text"
              :placeholder="t('superAgent.contextRow.searchDirs')"
            />
            <button v-if="dirSearch" class="ctx-search-clear" @click="dirSearch = ''">
              <X :size="11" />
            </button>
          </div>

          <div class="ctx-list">
            <button
              v-for="p in filteredDirs"
              :key="p"
              class="ctx-item"
              data-testid="agent-context-dir-item"
              :class="{ selected: isCurrentDir(p) }"
              @click="switchDirectory(p)"
            >
              <Folder :size="14" class="ctx-item-icon" />
              <div class="ctx-item-body">
                <span class="ctx-item-name">{{ dirDisplayNameFor(p) }}</span>
                <span v-if="p !== dirDisplayNameFor(p)" class="ctx-item-sub">{{ shortPath(p) }}</span>
              </div>
              <Check v-if="isCurrentDir(p)" :size="14" class="ctx-item-check" />
            </button>
            <div v-if="filteredDirs.length === 0" class="ctx-empty">
              {{ t('superAgent.contextRow.noDirs') }}
            </div>
          </div>

          <div class="ctx-divider" />

          <button class="ctx-action" @click="addNewDirectory">
            <FolderPlus :size="14" class="ctx-action-icon" />
            <span>{{ t('superAgent.contextRow.addDir') }}</span>
          </button>
        </div>
      </Transition>
    </div>

    <!-- Git branch (only when directory is a git repo) -->
    <template v-if="currentBranch">
      <span class="ctx-sep" aria-hidden="true">·</span>
      <div class="ctx-selector">
        <button
          class="ctx-trigger"
          data-testid="agent-context-branch-trigger"
          :class="{ active: showBranchDropdown }"
          @click="toggleBranchDropdown"
        >
          <GitBranch :size="13" class="ctx-icon" />
          <span class="ctx-label">{{ currentBranch }}</span>
          <ChevronDown :size="11" class="ctx-arrow" :class="{ open: showBranchDropdown }" />
        </button>

        <Transition name="ctx-dropdown">
          <div v-if="showBranchDropdown" class="ctx-dropdown" data-testid="agent-context-branch-dropdown" v-click-outside="closeBranchDropdown">
            <div class="ctx-search">
              <Search :size="13" class="ctx-search-icon" />
              <input
                ref="branchSearchInput"
                v-model="branchSearch"
                type="text"
                :placeholder="t('superAgent.contextRow.searchBranches')"
              />
              <button v-if="branchSearch" class="ctx-search-clear" @click="branchSearch = ''">
                <X :size="11" />
              </button>
            </div>

            <div class="ctx-list">
              <button
                v-for="b in filteredBranches"
                :key="b.name"
                class="ctx-item"
                :class="{ selected: b.current }"
                @click="checkoutBranch(b.name)"
              >
                <GitBranch :size="14" class="ctx-item-icon" />
                <div class="ctx-item-body">
                  <span class="ctx-item-name">{{ b.name }}</span>
                </div>
                <Check v-if="b.current" :size="14" class="ctx-item-check" />
              </button>
              <div v-if="filteredBranches.length === 0" class="ctx-empty">
                {{ t('superAgent.contextRow.noBranches') }}
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </template>

    <!-- Session rebuild hint toast -->
    <Transition name="ctx-hint-fade">
      <span v-if="rebuildHint" class="ctx-rebuild-hint" data-testid="agent-context-rebuild-hint">
        <RefreshCw :size="12" />
        {{ rebuildHint }}
      </span>
    </Transition>
  </div>
</template>

<script setup lang="ts">
/**
 * Agent 上下文行。
 *
 * 在复用的 SessionComposer（ChatInput）上方挂一条上下文行：
 * 工作区名 + 目录选择下拉（工作区目录间切换）+ git 分支（若目录是 git 仓库）。
 *
 * 目录切换语义与 IDE 的「多目录域 Working Directory」一致：重建会话。
 * Super Agent 的 Router 会话归主进程，切目录 = 重新 bind 到新项目根。
 */
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Folder, FolderOpen, FolderPlus, GitBranch, ChevronDown,
  Search, Check, X, RefreshCw,
} from 'lucide-vue-next'
import { vClickOutside } from '@/components/common/vClickOutside'
import { useSuperAgentStore } from '@/stores/superAgent'
import { useScmStore } from '@/stores/scm'
import { useOpenProjectWorkflow } from '@/composables/useOpenProjectWorkflow'
import { api } from '@/services/electronAPI'
import type { GitBranch as GitBranchInfo } from '@/services/electronAPI'
import { getRecentProjectRoots, normalizeProjectPathKey, pathsEqual } from '@/utils/recentProjectRoots'

const { t } = useI18n()
const superAgentStore = useSuperAgentStore()
const scmStore = useScmStore()
const { openProjectByPath } = useOpenProjectWorkflow()

const repoRoot = computed(() => superAgentStore.boundRepoRoot)

const workspaceName = computed(() =>
  repoRoot.value ? repoRoot.value.split(/[\\/]/).filter(Boolean).pop() || repoRoot.value : '',
)

// ── Directory selector ──────────────────────────────────────────
const showDirDropdown = ref(false)
const dirSearch = ref('')
const dirSearchInput = ref<HTMLInputElement | null>(null)
const dirDisplayName = computed(() => {
  const root = repoRoot.value
  if (!root) return t('superAgent.contextRow.noDir')
  return root.split(/[\\/]/).filter(Boolean).pop() || root
})

const allDirs = computed(() => {
  const stored = getRecentProjectRoots()
  const seen = new Set<string>()
  const merged: string[] = []
  const pushUnique = (p: string) => {
    const k = normalizeProjectPathKey(p)
    if (!p.trim() || seen.has(k)) return
    seen.add(k)
    merged.push(p)
  }
  stored.forEach(pushUnique)
  return merged
})

const filteredDirs = computed(() => {
  const q = dirSearch.value.trim().toLowerCase()
  if (!q) return allDirs.value
  return allDirs.value.filter(p =>
    dirDisplayNameFor(p).toLowerCase().includes(q) || p.toLowerCase().includes(q),
  )
})

function dirDisplayNameFor(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return path
  return '…/' + parts.slice(-2).join('/')
}

function isCurrentDir(path: string): boolean {
  return pathsEqual(path, repoRoot.value || '')
}

function toggleDirDropdown() {
  showDirDropdown.value = !showDirDropdown.value
  if (showDirDropdown.value) {
    dirSearch.value = ''
    nextTick(() => dirSearchInput.value?.focus())
  }
}

function closeDirDropdown() {
  showDirDropdown.value = false
  dirSearch.value = ''
}

/**
 * Switching directory = rebuild session (same as IDE multi-directory domain).
 *
 * Super Agent 的 Router 会话归主进程，切目录 = 重新 bind 到新项目根。
 * openProjectByPath 会同步 stores + 复用/新建会话 + 派发 session-created 事件，
 * SuperAgentView 的 watch(() => appStore.projectRoot) 随后重新绑定镜像。
 */
function switchDirectory(path: string) {
  closeDirDropdown()
  if (isCurrentDir(path)) return
  rebuildHint.value = t('superAgent.contextRow.rebuilding')
  openProjectByPath(path)
  setTimeout(() => { rebuildHint.value = '' }, 3000)
}

async function addNewDirectory() {
  closeDirDropdown()
  try {
    const result = await api.selectFolder()
    if (!result.canceled && result.filePaths[0]) {
      switchDirectory(result.filePaths[0])
    }
  } catch (error) {
    console.error('[AgentContextRow] Failed to select folder:', error)
  }
}

// ── Git branch ──────────────────────────────────────────────────
const showBranchDropdown = ref(false)
const branchSearch = ref('')
const branchSearchInput = ref<HTMLInputElement | null>(null)
const branches = ref<GitBranchInfo[]>([])

const currentBranch = computed(() => {
  const found = branches.value.find(b => b.current)
  return found?.name || ''
})

const filteredBranches = computed(() => {
  const q = branchSearch.value.trim().toLowerCase()
  if (!q) return branches.value
  return branches.value.filter(b => b.name.toLowerCase().includes(q))
})

async function loadBranches() {
  const cwd = repoRoot.value
  if (!cwd) {
    branches.value = []
    return
  }
  try {
    branches.value = (await api.git.getBranches(cwd)) || []
  } catch {
    branches.value = []
  }
}

function toggleBranchDropdown() {
  showBranchDropdown.value = !showBranchDropdown.value
  if (showBranchDropdown.value) {
    branchSearch.value = ''
    loadBranches()
    nextTick(() => branchSearchInput.value?.focus())
  }
}

function closeBranchDropdown() {
  showBranchDropdown.value = false
  branchSearch.value = ''
}

async function checkoutBranch(name: string) {
  closeBranchDropdown()
  const b = branches.value.find(br => br.name === name)
  if (b?.current) return
  try {
    // 通过 scmStore checkout 与 IDE 主聊天保持一致：
    // checkout 后自动 refresh git status + refreshBranches
    await scmStore.checkoutBranch(name)
    await loadBranches()
  } catch (error) {
    console.error('[AgentContextRow] checkout failed:', error)
  }
}

// ── Rebuild hint ────────────────────────────────────────────────
const rebuildHint = ref('')

// ── Lifecycle ───────────────────────────────────────────────────
onMounted(() => {
  if (repoRoot.value) loadBranches()
})

watch(repoRoot, () => {
  branches.value = []
  if (repoRoot.value) loadBranches()
})
</script>

<style lang="scss" scoped>
.agent-context-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px 0;
  flex-shrink: 0;
  position: relative;
  flex-wrap: wrap;
}

.ctx-workspace {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctx-icon {
  flex-shrink: 0;
  opacity: 0.55;
}

.ctx-sep {
  color: var(--text-muted);
  font-size: var(--text-sm);
  opacity: 0.4;
}

.ctx-selector {
  position: relative;
}

.ctx-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 7px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted, #888);
  font-size: var(--text-md);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
  max-width: 220px;
  line-height: var(--leading-normal);

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.04));
    color: var(--text-secondary, #555);
  }

  &.active {
    background: var(--bg-hover, rgba(0, 0, 0, 0.04));
    color: var(--text-primary, #333);
  }

  .ctx-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
    color: var(--text-secondary, #555);
  }

  .ctx-arrow {
    flex-shrink: 0;
    opacity: 0.35;
    transition: transform 0.15s ease;

    &.open {
      transform: rotate(180deg);
      opacity: 0.6;
    }
  }
}

/* ── Dropdown ── */
.ctx-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  min-width: 280px;
  max-width: 360px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.06));
  border-radius: 10px;
  box-shadow:
    var(--shadow-lg),
    var(--shadow-sm);
  z-index: 200;
  padding: 5px;
  animation: ctx-in 0.12s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes ctx-in {
  from {
    opacity: 0;
    transform: translateY(3px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.ctx-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.06));
  border-radius: 7px;
  background: var(--bg-tertiary, #f8f8f8);
  margin-bottom: 3px;

  &:focus-within {
    border-color: var(--accent-primary, #2563eb);
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.08);
  }

  .ctx-search-icon {
    flex-shrink: 0;
    color: var(--text-muted, #999);
    opacity: 0.6;
  }

  input {
    flex: 1;
    border: none;
    background: transparent;
    outline: none;
    font-size: var(--text-md);
    font-family: inherit;
    color: var(--text-primary, #333);
    min-width: 0;

    &::placeholder {
      color: var(--text-muted, #aaa);
    }
  }

  .ctx-search-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted, #999);
    cursor: pointer;
    flex-shrink: 0;

    &:hover {
      background: var(--bg-hover);
      color: var(--text-primary, #333);
    }
  }
}

.ctx-list {
  max-height: 220px;
  overflow-y: auto;
  @include scrollbar-overlay;
  margin: 1px 0;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-primary, #333);
  font-size: var(--text-md);
  font-family: inherit;
  cursor: pointer;
  transition: background 0.08s ease;
  text-align: left;

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.035));
  }

  &.selected .ctx-item-name {
    font-weight: 600;
    color: var(--text-primary, #222);
  }

  .ctx-item-icon {
    flex-shrink: 0;
    color: var(--text-muted, #aaa);
    opacity: 0.6;
  }

  .ctx-item-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .ctx-item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-md);
    line-height: var(--leading-compact);
  }

  .ctx-item-sub {
    font-size: var(--text-xs-plus);
    color: var(--text-muted, #999);
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: var(--leading-tighter);
  }

  .ctx-item-check {
    flex-shrink: 0;
    color: var(--accent-primary, #2563eb);
  }
}

.ctx-empty {
  padding: 14px 8px;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-muted, #aaa);
}

.ctx-divider {
  height: 1px;
  background: var(--border-subtle, rgba(0, 0, 0, 0.05));
  margin: 3px 2px;
}

.ctx-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary, #666);
  font-size: var(--text-md);
  font-family: inherit;
  cursor: pointer;
  transition: background 0.08s ease, color 0.08s ease;

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.035));
    color: var(--text-primary, #333);
  }

  .ctx-action-icon {
    flex-shrink: 0;
    color: var(--text-muted, #aaa);
    opacity: 0.6;
  }
}

/* ── Rebuild hint toast ── */
.ctx-rebuild-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent);
  color: var(--accent-primary);
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;

  svg {
    animation: ctx-spin 1s linear infinite;
  }
}

@keyframes ctx-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.ctx-hint-fade-enter-active,
.ctx-hint-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.ctx-hint-fade-enter-from,
.ctx-hint-fade-leave-to {
  opacity: 0;
  transform: translateY(2px);
}

/* ── Dropdown transition ── */
.ctx-dropdown-enter-active {
  transition: all 0.12s cubic-bezier(0.16, 1, 0.3, 1);
}
.ctx-dropdown-leave-active {
  transition: all 0.08s ease;
}
.ctx-dropdown-enter-from,
.ctx-dropdown-leave-to {
  opacity: 0;
  transform: translateY(3px) scale(0.98);
}
</style>
