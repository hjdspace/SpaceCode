<template>
  <div class="chat-context-toolbar">
    <!-- Project Selector -->
    <div class="ctx-selector" ref="projectSelectorRef">
      <button class="ctx-trigger" :class="{ active: showProjectDropdown }" @click="toggleProjectDropdown">
        <Folder :size="13" class="ctx-icon" />
        <span class="ctx-label">{{ projectName }}</span>
        <ChevronDown :size="11" class="ctx-arrow" :class="{ open: showProjectDropdown }" />
      </button>

      <Transition name="ctx-dropdown">
        <div v-if="showProjectDropdown" class="ctx-dropdown" v-click-outside="closeProjectDropdown">
          <div class="ctx-search">
            <Search :size="13" class="ctx-search-icon" />
            <input
              ref="projectSearchInput"
              v-model="projectSearch"
              type="text"
              :placeholder="t('contextToolbar.searchProjects')"
            />
            <button v-if="projectSearch" class="ctx-search-clear" @click="projectSearch = ''">
              <X :size="11" />
            </button>
          </div>

          <div class="ctx-list">
            <button
              v-for="p in filteredProjects"
              :key="p"
              class="ctx-item"
              :class="{ selected: isCurrent(p) }"
              @click="switchToProject(p)"
            >
              <Folder :size="14" class="ctx-item-icon" />
              <div class="ctx-item-body">
                <span class="ctx-item-name">{{ displayName(p) }}</span>
                <span v-if="p !== displayName(p)" class="ctx-item-sub">{{ shortPath(p) }}</span>
              </div>
              <Check v-if="isCurrent(p)" :size="14" class="ctx-item-check" />
            </button>
            <div v-if="filteredProjects.length === 0" class="ctx-empty">
              {{ t('contextToolbar.noProjects') }}
            </div>
          </div>

          <div class="ctx-divider" />

          <button class="ctx-action" @click="addNewProject">
            <FolderPlus :size="14" class="ctx-action-icon" />
            <span>{{ t('contextToolbar.addNewProject') }}</span>
            <ChevronRight :size="12" class="ctx-action-arrow" />
          </button>
          <button class="ctx-action" @click="clearProject">
            <FolderMinus :size="14" class="ctx-action-icon" />
            <span>{{ t('contextToolbar.noProject') }}</span>
          </button>
        </div>
      </Transition>
    </div>

    <!-- Git Branch Selector (Code / Design 模式显示) -->
    <div v-if="!isWorkMode" class="ctx-selector" ref="branchSelectorRef">
      <button class="ctx-trigger" :class="{ active: showBranchDropdown }" @click="toggleBranchDropdown">
        <GitBranch :size="13" class="ctx-icon" />
        <span class="ctx-label">{{ currentBranch }}</span>
        <ChevronDown :size="11" class="ctx-arrow" :class="{ open: showBranchDropdown }" />
      </button>

      <Transition name="ctx-dropdown">
        <div v-if="showBranchDropdown" class="ctx-dropdown" v-click-outside="closeBranchDropdown">
          <div class="ctx-search">
            <Search :size="13" class="ctx-search-icon" />
            <input
              ref="branchSearchInput"
              v-model="branchSearch"
              type="text"
              :placeholder="t('sessionContext.searchBranch')"
            />
            <button v-if="branchSearch" class="ctx-search-clear" @click="branchSearch = ''">
              <X :size="11" />
            </button>
          </div>

          <div class="ctx-section-label">{{ t('sessionContext.branches') }}</div>

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
                <span v-if="b.current && uncommittedCount > 0" class="ctx-item-sub">
                  {{ t('sessionContext.uncommittedChanges', { count: uncommittedCount }) }}
                </span>
              </div>
              <Check v-if="b.current" :size="14" class="ctx-item-check" />
            </button>
            <div v-if="filteredBranches.length === 0" class="ctx-empty">
              {{ t('sessionContext.noMatchingBranches') }}
            </div>
          </div>

          <div class="ctx-divider" />

          <button class="ctx-action" @click="createNewBranch">
            <Plus :size="14" class="ctx-action-icon" />
            <span>{{ t('sessionContext.createAndCheckout') }}</span>
          </button>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Folder, FolderPlus, FolderMinus, GitBranch, ChevronDown, ChevronRight,
  Search, Check, Plus, X
} from 'lucide-vue-next'
import { vClickOutside } from '@/directives/vClickOutside'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useScmStore, type ScmBranch } from '@/stores/scm'
import { useSessionContext } from '@/stores/sessionContext'
import { useOpenProjectWorkflow } from '@/composables/useOpenProjectWorkflow'
import { useDesignStore } from '@/stores/design'
import { useDesignSession } from '@/composables/useDesignSession'
import { getRecentProjectRoots, normalizeProjectPathKey, pathsEqual } from '@/utils/recentProjectRoots'

const { t } = useI18n()
const appStore = useAppStore()
const sessionStore = useChatSessionStore()
const scmStore = useScmStore()
const sessionContext = useSessionContext()
const { openProjectFromPicker, openProjectByPath } = useOpenProjectWorkflow()
const designStore = useDesignStore()
const { switchWorkingDirectory } = useDesignSession()

// ── Work / Code / Design 模式适配 ──────────────────────────────
const isWorkMode = computed(() => appStore.mode === 'work')
const isDesignMode = computed(() => appStore.mode === 'design')

/** 当前模式下的工作目录路径 */
const currentWorkspacePath = computed(() => {
  if (isWorkMode.value) return appStore.workWorkspace
  if (isDesignMode.value) return designStore.designWorkspace
  return appStore.projectRoot
})

// --- Project Selector ---
const showProjectDropdown = ref(false)
const projectSearch = ref('')
const projectSelectorRef = ref<HTMLElement | null>(null)
const projectSearchInput = ref<HTMLInputElement | null>(null)

const projectName = computed(() => {
  const root = currentWorkspacePath.value
  if (!root) return t('contextToolbar.noProject')
  return root.split(/[/\\]/).filter(Boolean).pop() || root
})

const allProjectsList = computed(() => {
  const stored = getRecentProjectRoots()
  const fromStore = [...new Set(sessionStore.allProjects.filter(Boolean))]
  const seen = new Set<string>()
  const merged: string[] = []

  const pushUnique = (p: string) => {
    const k = normalizeProjectPathKey(p)
    if (!p.trim() || seen.has(k)) return
    seen.add(k)
    merged.push(p)
  }

  stored.forEach(pushUnique)
  fromStore.forEach(pushUnique)

  return merged
})

const filteredProjects = computed(() => {
  const q = projectSearch.value.trim().toLowerCase()
  if (!q) return allProjectsList.value
  return allProjectsList.value.filter(p =>
    displayName(p).toLowerCase().includes(q) || p.toLowerCase().includes(q)
  )
})

function displayName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length <= 2) return path
  return '…/' + parts.slice(-2).join('/')
}

function isCurrent(path: string): boolean {
  return pathsEqual(path, currentWorkspacePath.value)
}

function toggleProjectDropdown() {
  showProjectDropdown.value = !showProjectDropdown.value
  if (showProjectDropdown.value) {
    projectSearch.value = ''
    nextTick(() => projectSearchInput.value?.focus())
  }
}

function closeProjectDropdown() {
  showProjectDropdown.value = false
  projectSearch.value = ''
}

function switchToProject(path: string) {
  closeProjectDropdown()
  if (isCurrent(path)) return
  if (isWorkMode.value) {
    appStore.setWorkWorkspace(path)
  } else if (isDesignMode.value) {
    switchWorkingDirectory(path)
  } else {
    openProjectByPath(path)
  }
}

async function addNewProject() {
  closeProjectDropdown()
  if (isWorkMode.value) {
    // Work 模式：打开工作区引导（文件夹选择器）
    appStore.showWorkOnboarding = true
  } else {
    await openProjectFromPicker()
  }
}

function clearProject() {
  closeProjectDropdown()
  if (isWorkMode.value) {
    appStore.clearWorkWorkspace()
  } else {
    appStore.closeProject()
    sessionStore.switchProject('')
  }
}

// --- Branch Selector ---
const showBranchDropdown = ref(false)
const branchSearch = ref('')
const branchSelectorRef = ref<HTMLElement | null>(null)
const branchSearchInput = ref<HTMLInputElement | null>(null)

const currentBranch = computed(() => scmStore.branch || 'main')

const uncommittedCount = computed(() =>
  scmStore.unstaged.length + scmStore.untracked.length + scmStore.conflicted.length
)

const filteredBranches = computed(() => {
  const q = branchSearch.value.trim().toLowerCase()
  const list = scmStore.branches
  if (!q) return list
  return list.filter(b => b.name.toLowerCase().includes(q))
})

function toggleBranchDropdown() {
  showBranchDropdown.value = !showBranchDropdown.value
  if (showBranchDropdown.value) {
    branchSearch.value = ''
    scmStore.refreshBranches()
    nextTick(() => branchSearchInput.value?.focus())
  }
}

function closeBranchDropdown() {
  showBranchDropdown.value = false
  branchSearch.value = ''
}

async function checkoutBranch(name: string) {
  closeBranchDropdown()
  const b = scmStore.branches.find(br => br.name === name)
  if (b?.current) return
  await scmStore.checkoutBranch(name)
}

function createNewBranch() {
  closeBranchDropdown()
  sessionContext.openCreateBranchDialog()
}

// --- Lifecycle ---
onMounted(() => {
  if (currentWorkspacePath.value) {
    scmStore.refreshBranches()
  }
})
</script>

<style lang="scss" scoped>
.chat-context-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0 0;
  flex-shrink: 0;
  position: relative;
}

.ctx-selector {
  position: relative;
}

/* ── Trigger (pill chip) ── */
.ctx-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 7px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted, #888);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
  max-width: 220px;
  line-height: 1.4;

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.04));
    color: var(--text-secondary, #555);
  }

  &.active {
    background: var(--bg-hover, rgba(0, 0, 0, 0.04));
    color: var(--text-primary, #333);
  }

  .ctx-icon {
    flex-shrink: 0;
    opacity: 0.55;
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

/* ── Dropdown Card ── */
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
    0 4px 24px rgba(0, 0, 0, 0.08),
    0 1px 4px rgba(0, 0, 0, 0.04);
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

/* ── Search ── */
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
    font-size: 13px;
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
      background: rgba(0, 0, 0, 0.06);
      color: var(--text-primary, #333);
    }
  }
}

/* ── Section Label ── */
.ctx-section-label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted, #aaa);
  padding: 6px 9px 3px;
}

/* ── List ── */
.ctx-list {
  max-height: 220px;
  overflow-y: auto;
  margin: 1px 0;

  /* thin scrollbar */
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.08);
    border-radius: 4px;
  }
}

/* ── Item ── */
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
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.08s ease;
  text-align: left;

  &:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.035));
  }

  &.selected {
    .ctx-item-name {
      font-weight: 600;
      color: var(--text-primary, #222);
    }
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
    font-size: 13px;
    line-height: 1.3;
  }

  .ctx-item-sub {
    font-size: 11.5px;
    color: var(--text-muted, #999);
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.2;
  }

  .ctx-item-check {
    flex-shrink: 0;
    color: var(--accent-primary, #2563eb);
  }
}

.ctx-empty {
  padding: 14px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted, #aaa);
}

/* ── Divider ── */
.ctx-divider {
  height: 1px;
  background: var(--border-subtle, rgba(0, 0, 0, 0.05));
  margin: 3px 2px;
}

/* ── Action Items ── */
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
  font-size: 13px;
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

  .ctx-action-arrow {
    margin-left: auto;
    opacity: 0.35;
  }
}

/* ── Dropdown Transition (Vue) ── */
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
