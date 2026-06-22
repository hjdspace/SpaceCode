<template>
  <div class="edit-tool-card" :class="[statusClass]">
    <div class="edit-header" @click="toggleExpand">
      <div class="edit-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <FileEdit v-else :size="14" />
      </div>
      <span class="edit-label">{{ t('toolCards.edit') }}</span>
      <span class="edit-path">{{ filePath }}</span>
      <button
        class="panel-btn"
        @click.stop="openInPanel"
        :title="t('infoPanel.openInPanel')"
      >
        <ExternalLink :size="13" />
      </button>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <div v-if="isExpanded" class="edit-body">
      <!-- 专业 Diff 展示 -->
      <div v-if="diffFile" class="git-diff-wrapper">
        <DiffView
          :key="diffViewKey"
          :diff-file="diffFile"
          :diff-view-mode="DiffModeEnum.Unified"
          :diff-view-highlight="true"
          class="git-diff-container"
        />
      </div>

      <!-- 无 diff 数据时的回退显示 -->
      <div v-else class="empty-diff">
        <span>{{ t('toolCards.editNoChanges') }}</span>
      </div>

      <!-- Result 输出 -->
      <div v-if="toolCall.output" class="result-section">
        <div class="block-label">{{ t('toolCards.editResult') }}</div>
        <pre class="code-block result-text"><code>{{ toolCall.output }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { FileEdit, ChevronDown, ExternalLink, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import { DiffView, DiffModeEnum } from '@git-diff-view/vue'
import { generateDiffFile } from '@git-diff-view/file'
import '@git-diff-view/vue/styles/diff-view.css'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const appStore = useAppStore()
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const filePath = computed(() => props.toolCall.input?.file_path || props.toolCall.input?.path || t('toolCards.editUnknownFile'))

function toggleExpand() { isExpanded.value = !isExpanded.value }

// Diff 数据源
const oldString = computed(() => props.toolCall.input?.old_string || '')
const newString = computed(() => props.toolCall.input?.new_string || '')
const hasDiffData = computed(() => !!(oldString.value || newString.value))
const fileLanguage = computed(() => appStore.getLanguageFromPath(filePath.value))
const diffViewKey = computed(() => [
  props.toolCall.id,
  filePath.value,
  oldString.value.length,
  newString.value.length,
  props.toolCall.status,
].join(':'))

// 创建 DiffFile 实例（用于 DiffView 组件）
const diffFile = computed(() => {
  if (!hasDiffData.value) return null

  const fileName = filePath.value.split(/[/\\]/).pop() || 'file'

  // 使用 generateDiffFile 自动比较两个文件内容并生成 diff
  const file = generateDiffFile(
    `${fileName}.old`,
    oldString.value,
    `${fileName}.new`,
    newString.value,
    fileLanguage.value,
    fileLanguage.value
  )

  // 根据当前主题初始化
  const isDarkTheme = document.documentElement.getAttribute('data-theme')?.includes('dark')
  file.initTheme(isDarkTheme ? 'dark' : 'light')
  file.init()
  file.buildUnifiedDiffLines()

  return file
})

const diffStats = computed(() => {
  const oldLines = oldString.value.split('\n').length
  const newLines = newString.value.split('\n').length
  return {
    additions: Math.max(0, newLines - oldLines),
    deletions: Math.max(0, oldLines - newLines)
  }
})

// HTML 转义（XSS 防护）
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function openInPanel() {
  const rawFp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!rawFp) return
  const fp = appStore.resolveSessionPath(rawFp)

  const modifiedContent = await api.readFile(fp)
  if (modifiedContent === null) return

  let originalContent = ''
  let originalContentResolved = false
  try {
    const projectRoot = appStore.projectRoot
    if (projectRoot) {
      // strip the project root prefix and normalize to forward slashes — git
      // expects POSIX-style paths in `git show HEAD:<path>` even on Windows.
      const relativePath = fp
        .replace(projectRoot, '')
        .replace(/^[/\\]/, '')
        .replace(/\\/g, '/')
      if (relativePath) {
        const headContent = await api.git.showFile(projectRoot, relativePath)
        if (headContent !== null) {
          originalContent = headContent
          originalContentResolved = true
        }
      }
    }
  } catch { /* not in git repo or file not tracked */ }

  if (!originalContentResolved) {
    // File is not tracked in git — treat the current edit as the only change
    // by reconstructing the pre-edit content from the tool input.
    const oldStr = props.toolCall.input?.old_string
    const newStr = props.toolCall.input?.new_string
    if (typeof oldStr === 'string' && typeof newStr === 'string' && newStr) {
      originalContent = modifiedContent.includes(newStr)
        ? modifiedContent.replace(newStr, oldStr)
        : modifiedContent
    } else {
      originalContent = modifiedContent
    }
  }

  const language = appStore.getLanguageFromPath(fp)
  appStore.showToolDiff({
    type: 'edit',
    filePath: fp,
    originalContent,
    modifiedContent,
    toolCallId: props.toolCall.id,
    language,
  })
}
</script>

<style lang="scss" scoped>
.edit-tool-card {
  border-radius: 6px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  overflow: hidden;
  font-size: 13px;
}

.edit-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;

  &:hover {
    background: rgba(255,255,255,0.03);
  }
}

.edit-icon-wrapper {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: rgba(249, 115, 22, 0.12);
  color: #fb923c;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.status-running .edit-icon-wrapper {
  background: rgba(59, 130, 246, 0.12);
  color: #60a5fa;
}

.status-error .edit-icon-wrapper {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}

.edit-label {
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #fb923c;
  flex-shrink: 0;
}

.edit-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
}

.panel-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;

  &:hover {
    background: rgba(255,255,255,0.1);
    color: var(--text-primary);
  }
}

.expand-icon {
  color: var(--text-tertiary);
  transition: transform 0.15s;

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.edit-body {
  border-top: 1px solid var(--surface-border);
}

/* Git Diff View 容器 */
.git-diff-wrapper {
  margin: 8px;
  border-radius: 6px;
  overflow: hidden;
}

.git-diff-container {
  max-height: 400px;
  overflow-y: auto;

  /* 覆盖默认样式以匹配当前主题 */
  --gdc-bg-color: var(--gdc-bg-color, #0d1117);
  --gdc-text-color: var(--gdc-text-color, #c9d1d9);
  --gdc-border-color: var(--gdc-border-color, #30363d);

  /* 添加行 */
  --gdc-add-bg-color: var(--gdc-add-bg-color, rgba(46, 160, 67, 0.15));
  --gdc-add-text-color: var(--gdc-add-text-color, #3fb950);
  --gdc-add-gutter-bg-color: var(--gdc-add-gutter-bg-color, rgba(46, 160, 67, 0.25));

  /* 删除行 */
  --gdc-remove-bg-color: var(--gdc-remove-bg-color, rgba(248, 81, 73, 0.15));
  --gdc-remove-text-color: var(--gdc-remove-text-color, #f85149);
  --gdc-remove-gutter-bg-color: var(--gdc-remove-gutter-bg-color, rgba(248, 81, 73, 0.25));

  /* Gutter */
  --gdc-gutter-bg-color: var(--gdc-gutter-bg-color, #161b22);
  --gdc-gutter-text-color: var(--gdc-gutter-text-color, #6e7681);

  &::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 4px;

    &:hover {
      background: rgba(255, 255, 255, 0.25);
    }
  }
}

.empty-diff {
  padding: 20px;
  text-align: center;
  color: #6e7681;
  font-size: 12px;
}

.result-section {
  padding: 10px 12px;
  border-top: 1px solid var(--surface-border);
}

.block-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 6px;
  font-weight: 500;
  color: var(--text-tertiary);
}

.code-block {
  margin: 0;
  padding: 10px 12px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

.result-text {
  background: #0d1117;
  color: #c9d1d9;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>