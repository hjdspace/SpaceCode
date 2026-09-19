<template>
  <div class="memory-settings">
    <header class="ms-header">
      <div class="ms-header-left">
        <span class="ms-header-icon">
          <BookOpenText :size="16" />
        </span>
        <div class="ms-header-titles">
          <h2 class="ms-title">{{ t('memorySettings.title') }}</h2>
          <p class="ms-subtitle">{{ t('memorySettings.projects') }}</p>
        </div>
      </div>
      <div class="ms-header-right">
        <nav class="ms-breadcrumb" :aria-label="t('memorySettings.title')">
          <template v-for="(part, index) in breadcrumbParts" :key="`${part}-${index}`">
            <ChevronRight v-if="index > 0" :size="14" class="ms-crumb-sep" />
            <span class="ms-crumb" :class="{ 'is-current': index === breadcrumbParts.length - 1 }">{{ part }}</span>
          </template>
        </nav>
        <button
          type="button"
          class="s-btn s-btn-secondary ms-refresh"
          :disabled="isRefreshing"
          @click="handleRefresh"
        >
          <RefreshCw :size="15" :class="{ spinning: isRefreshing }" />
          <span>{{ t('memorySettings.refresh') }}</span>
        </button>
      </div>
    </header>

    <div v-if="memoryStore.error" class="ms-error">{{ memoryStore.error }}</div>

    <div class="ms-body">
      <aside class="ms-sidebar">
        <div class="ms-panel-header">
          <Database :size="15" class="ms-panel-icon" />
          <span class="ms-panel-title">{{ t('memorySettings.resourceManager') }}</span>
          <span v-if="memoryStore.isLoadingProjects" class="ms-panel-meta">{{ t('common.loading') }}</span>
        </div>

        <div class="ms-search">
          <Search :size="15" class="ms-search-icon" />
          <input
            v-model="resourceQuery"
            class="ms-search-input"
            type="text"
            spellcheck="false"
            :placeholder="t('memorySettings.resourceSearchPlaceholder')"
            :aria-label="t('memorySettings.resourceSearchPlaceholder')"
          />
          <button
            v-if="resourceQuery"
            type="button"
            class="ms-search-clear"
            :aria-label="t('memorySettings.clearSearch')"
            :title="t('memorySettings.clearSearch')"
            @click="resourceQuery = ''"
          >
            <X :size="14" />
          </button>
        </div>

        <div class="ms-tree">
          <div v-if="memoryStore.projects.length === 0 && !memoryStore.isLoadingProjects" class="ms-empty">
            <FolderGit2 :size="18" />
            <span>{{ t('memorySettings.emptyProjects') }}</span>
          </div>
          <div v-else-if="filteredProjects.length === 0" class="ms-empty">
            <Search :size="18" />
            <span>{{ t('memorySettings.noProjectMatches') }}</span>
          </div>
          <template v-else>
            <div v-for="project in filteredProjects" :key="project.id" class="ms-project">
              <button
                type="button"
                class="ms-project-row"
                :class="{ 'is-active': project.id === memoryStore.selectedProjectId }"
                :title="project.label"
                :aria-expanded="project.id === expandedProjectId"
                :aria-label="t('memorySettings.toggleFolder', { name: projectDisplayName(project.label) })"
                @click="handleProjectToggle(project.id)"
              >
                <Folder :size="15" class="ms-project-icon" />
                <span class="ms-project-label">{{ projectDisplayName(project.label) }}</span>
                <span v-if="!project.exists" class="ms-project-missing">{{ t('memorySettings.missing') }}</span>
              </button>

              <div v-if="project.id === expandedProjectId" class="ms-project-files">
                <div
                  v-if="project.id === memoryStore.selectedProjectId && memoryStore.isLoadingFiles"
                  class="ms-tree-hint"
                >
                  {{ t('common.loading') }}
                </div>
                <div v-else-if="project.id !== memoryStore.selectedProjectId || visibleTreeRows.length === 0" class="ms-tree-hint">
                  {{ t('memorySettings.emptyFiles') }}
                </div>
                <template v-else>
                  <button
                    v-for="row in visibleTreeRows"
                    :key="row.id"
                    type="button"
                    class="ms-tree-row"
                    :class="{ 'is-active': row.kind === 'file' && row.path === selectedFilePath, 'is-nested': row.depth > 1 }"
                    :style="{ '--ms-depth': row.depth }"
                    :aria-expanded="row.kind === 'folder' ? !row.collapsed : undefined"
                    :aria-label="row.kind === 'folder' ? t('memorySettings.toggleFolder', { name: row.name }) : undefined"
                    @click="handleTreeRowClick(row)"
                  >
                    <template v-if="row.kind === 'folder'">
                      <ChevronRight v-if="row.collapsed" :size="14" />
                      <ChevronDown v-else :size="14" />
                      <Folder :size="14" class="ms-tree-folder-icon" />
                      <span class="ms-tree-name is-folder">{{ row.name }}</span>
                    </template>
                    <template v-else>
                      <FileText :size="14" class="ms-tree-file-icon" />
                      <span class="ms-tree-name">{{ row.name }}</span>
                    </template>
                  </button>
                </template>
              </div>
            </div>
          </template>
        </div>
      </aside>

      <section class="ms-detail">
        <div class="ms-detail-header">
          <div class="ms-detail-heading">
            <h3 class="ms-detail-title">
              {{ selectedFilePath ? fileNameFromPath(selectedFilePath) : t('memorySettings.noFileSelected') }}
            </h3>
            <span v-if="isDirty" class="ms-badge">{{ t('memorySettings.unsaved') }}</span>
            <span v-else-if="memoryStore.lastSavedAt" class="ms-badge">{{ t('memorySettings.saved') }}</span>
          </div>
          <div class="ms-detail-meta">
            <span v-if="memoryStore.selectedFile">{{ formatBytes(memoryStore.selectedFile.bytes) }}</span>
            <span v-if="memoryStore.selectedFile?.updatedAt">{{ formatDate(memoryStore.selectedFile.updatedAt) }}</span>
          </div>
          <p class="ms-detail-path">
            {{ selectedProject?.memoryDir ?? t('memorySettings.selectProject') }}
          </p>
        </div>

        <template v-if="memoryStore.selectedFile">
          <div v-if="isEditing" class="ms-editor">
            <div class="ms-toolbar">
              <div class="ms-toolbar-left">
                <span>{{ t('memorySettings.editor') }}</span>
                <span class="ms-toolbar-tag">MARKDOWN</span>
              </div>
              <div class="ms-toolbar-right">
                <button type="button" class="ms-text-btn" :disabled="memoryStore.isSaving" @click="handleCancelEdit">
                  {{ t('common.cancel') }}
                </button>
                <button
                  type="button"
                  class="ms-text-btn"
                  :disabled="!isDirty || memoryStore.isSaving"
                  @click="handleRevert"
                >
                  <RotateCcw :size="14" />
                  <span>{{ t('memorySettings.revert') }}</span>
                </button>
                <button
                  type="button"
                  class="s-btn s-btn-primary ms-save-btn"
                  :disabled="memoryStore.isSaving"
                  @click="handleSave"
                >
                  <Save :size="14" />
                  <span>{{ t('common.save') }}</span>
                </button>
              </div>
            </div>
            <textarea
              ref="editorRef"
              class="ms-textarea"
              :value="memoryStore.draftContent"
              spellcheck="false"
              :aria-label="t('memorySettings.editor')"
              @input="onDraftInput"
            />
          </div>

          <div v-else class="ms-preview">
            <div class="ms-toolbar">
              <div class="ms-toolbar-left">
                <span>{{ t('memorySettings.preview') }}</span>
                <span class="ms-toolbar-tag">{{ t('memorySettings.rendered') }}</span>
              </div>
              <div class="ms-toolbar-right">
                <button
                  type="button"
                  class="ms-icon-btn"
                  :aria-label="t('memorySettings.edit')"
                  :title="t('memorySettings.edit')"
                  @click="isEditing = true"
                >
                  <PencilLine :size="14" />
                </button>
              </div>
            </div>
            <div class="ms-preview-body" @click.capture="handlePreviewClick">
              <MarkdownRenderer
                :content="previewContent || ' '"
                :file-path="previewFilePath"
              />
            </div>
          </div>
        </template>

        <div v-else class="ms-detail-empty">
          <FileText :size="20" />
          <span>
            {{ memoryStore.isLoadingFile ? t('common.loading') : t('memorySettings.selectFile') }}
          </span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  BookOpenText,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  Folder,
  FolderGit2,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  X,
} from 'lucide-vue-next'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import { useMemoryStore } from '@/stores/memory'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import type { MemoryFile } from '@/types/memory'
import {
  buildMemoryFileTree,
  fileNameFromPath,
  filterMemoryFiles,
  filterMemoryProjects,
  projectDisplayName,
  resolveMarkdownMemoryLink,
  resolveMemoryFileTarget,
  stripMarkdownFrontmatter,
  type MemoryTreeNode,
} from '@/lib/memoryFiles'

interface FlatTreeRow {
  id: string
  kind: 'folder' | 'file'
  depth: number
  name: string
  path: string
  collapsed: boolean
  file: MemoryFile | null
}

const { t } = useI18n()
const memoryStore = useMemoryStore()
const appStore = useAppStore()
const settingsStore = useSettingsStore()

const resourceQuery = ref('')
const expandedProjectId = ref<string | null>(null)
const collapsedFolders = ref<Set<string>>(new Set())
const isEditing = ref(false)
const editorRef = ref<HTMLTextAreaElement | null>(null)

/** 当前项目根：优先应用当前打开的目录，其次设置里配置的项目根。 */
const activeCwd = computed(() => appStore.projectRoot || settingsStore.projectRoot || undefined)

const selectedProject = computed(
  () => memoryStore.projects.find((project) => project.id === memoryStore.selectedProjectId) ?? null,
)
const selectedFilePath = computed(() => memoryStore.selectedFile?.path ?? null)
const isDirty = computed(
  () =>
    Boolean(memoryStore.selectedFile) && memoryStore.draftContent !== memoryStore.selectedFile?.content,
)
const isRefreshing = computed(() => memoryStore.isLoadingProjects || memoryStore.isLoadingFiles)
const forceExpandFiles = computed(() => Boolean(resourceQuery.value.trim()))

const filteredProjects = computed(() =>
  filterMemoryProjects(
    memoryStore.projects,
    resourceQuery.value,
    memoryStore.selectedProjectId,
    memoryStore.files,
  ),
)
const filteredFiles = computed(() => filterMemoryFiles(memoryStore.files, resourceQuery.value))
const fileTree = computed(() => buildMemoryFileTree(filteredFiles.value))
const previewContent = computed(() => stripMarkdownFrontmatter(memoryStore.draftContent))
/** 预览里相对图片路径按记忆文件所在目录解析。 */
const previewFilePath = computed(() => {
  const file = memoryStore.selectedFile
  const memoryDir = selectedProject.value?.memoryDir
  if (!file || !memoryDir) return undefined
  return `${memoryDir.replace(/[\\/]+$/, '')}/${file.path}`
})

const breadcrumbParts = computed(() => {
  const fallbackProject = activeCwd.value ? projectDisplayName(activeCwd.value) : '~/.claude/projects'
  const projectLabel = selectedProject.value ? projectDisplayName(selectedProject.value.label) : fallbackProject
  const path = selectedFilePath.value
  return path
    ? [projectLabel, ...path.split('/').filter(Boolean)]
    : [projectLabel, t('memorySettings.noFileSelected')]
})

/** 折叠状态展开成扁平行列表，避免额外的递归组件。 */
const visibleTreeRows = computed<FlatTreeRow[]>(() => {
  const rows: FlatTreeRow[] = []
  const walk = (nodes: MemoryTreeNode[], depth: number) => {
    for (const node of nodes) {
      if (node.kind === 'folder') {
        const collapsed = isFolderCollapsed(node.path)
        rows.push({
          id: node.id,
          kind: 'folder',
          depth,
          name: node.name,
          path: node.path,
          collapsed,
          file: null,
        })
        if (!collapsed) walk(node.children, depth + 1)
      } else {
        rows.push({
          id: node.id,
          kind: 'file',
          depth,
          name: node.file.title,
          path: node.path,
          collapsed: false,
          file: node.file,
        })
      }
    }
  }
  walk(fileTree.value, 1)
  return rows
})

function isFolderCollapsed(path: string): boolean {
  return !forceExpandFiles.value && collapsedFolders.value.has(path)
}

function toggleFolder(path: string) {
  const next = new Set(collapsedFolders.value)
  if (next.has(path)) {
    next.delete(path)
  } else {
    next.add(path)
  }
  collapsedFolders.value = next
}

// ── 数据加载 ────────────────────────────────────────────────────

watch(
  activeCwd,
  (cwd) => {
    void memoryStore.fetchProjects(cwd)
  },
  { immediate: true },
)

watch(
  () => memoryStore.selectedProjectId,
  (projectId) => {
    if (!projectId) return
    expandedProjectId.value = projectId
    void memoryStore.fetchFiles(projectId)
  },
  { immediate: true },
)

watch(selectedFilePath, () => {
  isEditing.value = false
})

/** 读取失败时记住这次文件列表，避免自动重试造成请求循环。 */
let autoOpenFailedKey: string | null = null

watchEffect(() => {
  const projectId = memoryStore.selectedProjectId
  if (!projectId || memoryStore.selectedFile) return
  if (memoryStore.isLoadingFiles || memoryStore.isLoadingFile) return
  if (memoryStore.pendingOpenPath) return
  const firstFile = memoryStore.files[0]
  if (!firstFile) return
  const key = `${projectId}\0${memoryStore.files.map((file) => file.path).join('|')}`
  if (autoOpenFailedKey === key) return
  void memoryStore.openFile(projectId, firstFile.path).then((opened) => {
    if (!opened) autoOpenFailedKey = key
  })
})

/** 外部（会话里点开某个记忆文件）请求定位到具体文件。 */
let pendingOpenInFlight = false

watch(
  [() => memoryStore.pendingOpenPath, () => memoryStore.isLoadingProjects, () => memoryStore.projects],
  () => {
    void consumePendingOpenPath()
  },
  { immediate: true },
)

async function consumePendingOpenPath() {
  const rawPath = memoryStore.pendingOpenPath
  if (!rawPath || memoryStore.isLoadingProjects || pendingOpenInFlight) return
  const target = resolveMemoryFileTarget(memoryStore.projects, rawPath)
  if (!target) {
    memoryStore.setPendingOpenPath(null)
    return
  }
  if (memoryStore.selectedProjectId === target.projectId && memoryStore.selectedFile?.path === target.path) {
    memoryStore.setPendingOpenPath(null)
    return
  }

  pendingOpenInFlight = true
  try {
    // 切项目 + 直接打开目标文件：不依赖其它 watcher 的后续触发
    if (memoryStore.selectedProjectId !== target.projectId) {
      memoryStore.selectProject(target.projectId)
    }
    await memoryStore.openFile(target.projectId, target.path)
  } finally {
    pendingOpenInFlight = false
    if (memoryStore.pendingOpenPath === rawPath) {
      memoryStore.setPendingOpenPath(null)
    }
  }
}

// ── 交互 ────────────────────────────────────────────────────────

/** 有未保存改动时切走需要用户确认。 */
function canLeaveDirtyEdit(): boolean {
  if (!isEditing.value || !isDirty.value) return true
  return window.confirm(t('memorySettings.discardUnsavedConfirm'))
}

function handleRefresh() {
  if (!canLeaveDirtyEdit()) return
  void memoryStore.fetchProjects(activeCwd.value)
  const projectId = memoryStore.selectedProjectId
  if (projectId) void memoryStore.fetchFiles(projectId)
}

function handleProjectToggle(projectId: string) {
  if (expandedProjectId.value === projectId) {
    expandedProjectId.value = null
    return
  }
  if (projectId !== memoryStore.selectedProjectId && !canLeaveDirtyEdit()) return
  expandedProjectId.value = projectId
  if (projectId !== memoryStore.selectedProjectId) {
    memoryStore.selectProject(projectId)
  }
}

function handleTreeRowClick(row: FlatTreeRow) {
  if (row.kind === 'folder') {
    toggleFolder(row.path)
    return
  }
  if (row.file) handleFileOpen(row.file)
}

function handleFileOpen(file: MemoryFile) {
  const projectId = memoryStore.selectedProjectId
  if (!projectId || file.path === selectedFilePath.value) return
  if (!canLeaveDirtyEdit()) return
  void memoryStore.openFile(projectId, file.path)
}

function handleCancelEdit() {
  const file = memoryStore.selectedFile
  if (file) memoryStore.updateDraft(file.content)
  isEditing.value = false
}

function handleRevert() {
  const file = memoryStore.selectedFile
  if (file) memoryStore.updateDraft(file.content)
}

async function handleSave() {
  if (!memoryStore.selectedFile) return
  if (!isDirty.value) {
    isEditing.value = false
    return
  }
  const saved = await memoryStore.saveFile()
  if (saved) isEditing.value = false
}

function onDraftInput(event: Event) {
  const target = event.target as HTMLTextAreaElement | null
  if (target) memoryStore.updateDraft(target.value)
}

/**
 * 预览里的 Markdown 链接指向另一个记忆文件时，在页内直接打开。
 * 用捕获阶段处理：先于 MarkdownRenderer 自身的链接分发，
 * 不匹配记忆文件时直接返回，其它链接保持原有行为。
 */
function handlePreviewClick(event: MouseEvent) {
  const anchor = (event.target as HTMLElement | null)?.closest('a')
  const href = anchor?.getAttribute('href')
  const file = memoryStore.selectedFile
  const projectId = memoryStore.selectedProjectId
  if (!href || !file || !projectId) return
  const targetPath = resolveMarkdownMemoryLink(
    href,
    file.path,
    selectedProject.value?.memoryDir,
    memoryStore.files,
  )
  if (!targetPath || targetPath === file.path) return
  event.preventDefault()
  event.stopPropagation()
  if (!canLeaveDirtyEdit()) return
  void memoryStore.openFile(projectId, targetPath)
}

// ── 快捷键 ──────────────────────────────────────────────────────

function handleKeydown(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
  event.preventDefault()
  void handleSave()
}

watch(
  [isEditing, () => memoryStore.selectedFile],
  ([editing]) => {
    document.removeEventListener('keydown', handleKeydown, true)
    if (editing) document.addEventListener('keydown', handleKeydown, true)
  },
  { immediate: true },
)

watch(isEditing, (editing) => {
  if (!editing) return
  void nextTick(() => editorRef.value?.focus())
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown, true)
})

// ── 展示格式化 ──────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unitIndex]}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
</script>

<style lang="scss" scoped>
.memory-settings {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 520px;
  overflow: hidden;
  background: var(--bg-primary);
}

// ── 顶部 ────────────────────────────────────────────────────────

.ms-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  flex-shrink: 0;
  min-height: 58px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}

.ms-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.ms-header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--accent-primary);
}

.ms-header-titles {
  min-width: 0;
}

.ms-title {
  font-size: var(--text-base-plus);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ms-subtitle {
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.ms-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
}

.ms-breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: var(--text-md);
  color: var(--text-muted);
}

.ms-crumb {
  max-width: 220px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;

  &.is-current {
    font-weight: 600;
    color: var(--text-primary);
  }
}

.ms-crumb-sep {
  flex-shrink: 0;
  color: var(--text-disabled);
}

.ms-refresh {
  padding: 7px 12px;
  font-size: var(--text-md);
}

.ms-error {
  flex-shrink: 0;
  margin: 10px 16px 0;
  padding: 8px 12px;
  border: 1px solid var(--error);
  border-radius: var(--radius-sm);
  background: var(--error-glow);
  color: var(--text-primary);
  font-size: var(--text-md);
  word-break: break-word;
}

// ── 主体 ────────────────────────────────────────────────────────

.ms-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
}

.ms-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}

.ms-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.ms-panel-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.ms-panel-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ms-panel-meta {
  font-size: var(--text-sm);
  color: var(--text-muted);
  flex-shrink: 0;
}

.ms-search {
  position: relative;
  padding: 12px;
  flex-shrink: 0;
}

.ms-search-icon {
  position: absolute;
  left: 22px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}

.ms-search-input {
  width: 100%;
  height: 36px;
  padding: 0 32px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--text-md);

  &::placeholder {
    color: var(--text-disabled);
  }

  &:focus {
    border-color: var(--accent-primary);
  }
}

.ms-search-clear {
  position: absolute;
  right: 18px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-muted);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.ms-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 8px 12px;
  @include scrollbar-thin;
}

.ms-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 12px;
  text-align: center;
  font-size: var(--text-md);
  color: var(--text-muted);
}

.ms-project {
  margin-bottom: 4px;
}

.ms-project-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  text-align: left;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.is-active {
    border-color: var(--border-default);
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
}

.ms-project-icon {
  flex-shrink: 0;
  color: var(--accent-primary);
}

.ms-project-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--text-md);
  font-weight: 500;
}

.ms-project-missing {
  flex-shrink: 0;
  font-size: var(--text-2xs);
  color: var(--text-disabled);
}

.ms-project-files {
  margin: 6px 0 6px 18px;
  padding-left: 10px;
  border-left: 1px solid var(--border-subtle);
}

.ms-tree-hint {
  padding: 6px 8px;
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.ms-tree-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 32px;
  margin-bottom: 2px;
  padding: 4px 8px 4px calc(4px + (var(--ms-depth, 1) - 1) * 16px);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  text-align: left;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(6px + (var(--ms-depth, 1) - 2) * 16px);
    border-left: 1px solid var(--border-subtle);
    opacity: 0;
  }

  &.is-nested::before {
    opacity: 1;
  }

  &:hover {
    border-color: var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.is-active {
    border-color: var(--border-default);
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
}

.ms-tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--text-md);

  &.is-folder {
    font-weight: 500;
  }
}

.ms-tree-folder-icon {
  flex-shrink: 0;
  color: var(--accent-primary);
}

.ms-tree-file-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

// ── 详情 ────────────────────────────────────────────────────────

.ms-detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--bg-elevated);
}

.ms-detail-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 12px;
  flex-shrink: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.ms-detail-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ms-detail-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ms-badge {
  flex-shrink: 0;
  padding: 2px 6px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xs);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--text-2xs);
  font-weight: 500;
}

.ms-detail-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.ms-detail-path {
  grid-column: 1 / -1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.ms-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
}

.ms-toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: var(--text-2xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.ms-toolbar-tag {
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.ms-toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.ms-text-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-md);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.ms-save-btn {
  padding: 6px 12px;
  font-size: var(--text-md);
}

.ms-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.ms-editor,
.ms-preview {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.ms-textarea {
  flex: 1;
  min-height: 0;
  width: 100%;
  padding: 20px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  line-height: 1.7;
  resize: none;
  overflow: auto;
  @include scrollbar-thin;

  &:focus {
    outline: none;
  }
}

.ms-preview-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px;
  @include scrollbar-thin;
}

.ms-detail-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  font-size: var(--text-md);
  color: var(--text-muted);
}

.spinning {
  animation: ms-spin 0.9s linear infinite;
}

@keyframes ms-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1024px) {
  .ms-body {
    grid-template-columns: 230px minmax(0, 1fr);
  }
}

@media (max-width: 768px) {
  .ms-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(160px, 40%) minmax(0, 1fr);
  }

  .ms-sidebar {
    border-right: none;
    border-bottom: 1px solid var(--border-subtle);
  }
}
</style>
