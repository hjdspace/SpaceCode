<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <FileEdit v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.edit') }}</span>
      <span class="tool-separator">·</span>
      <span class="tool-target">{{ filePath }}</span>
      <div class="tool-actions">
        <button
          class="action-btn"
          @click.stop="openInPanel"
          :title="t('infoPanel.openInPanel')"
        >
          <ExternalLink :size="14" />
        </button>
        <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
      </div>
    </div>

    <div v-if="isExpanded" class="tool-body">
      <div class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.fileContent') }}</div>
        <div class="tool-section-body diff-section-body">
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
        </div>
      </div>

      <!-- Result 输出 -->
      <div v-if="toolCall.output" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.editResult') }}</div>
        <div class="tool-section-body">
          <pre class="code-block result-text"><code>{{ toolCall.output }}</code></pre>
        </div>
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
@use './tool-card.scss' as *;

.diff-section-body {
  padding: 0;
}

/* Git Diff View 容器 */
.git-diff-wrapper {
  border-radius: 6px;
  overflow: hidden;
}

.git-diff-container {
  max-height: 400px;
  overflow-y: auto;

  /* 覆盖默认样式以匹配当前主题 */
  --gdc-bg-color: var(--code-bg, #0d1117);
  --gdc-text-color: var(--code-fg, #c9d1d9);
  --gdc-border-color: var(--surface-border, #30363d);

  /* 添加行 */
  --gdc-add-bg-color: rgba(46, 160, 67, 0.15);
  --gdc-add-text-color: #3fb950;
  --gdc-add-gutter-bg-color: rgba(46, 160, 67, 0.25);

  /* 删除行 */
  --gdc-remove-bg-color: rgba(248, 81, 73, 0.15);
  --gdc-remove-text-color: #f85149;
  --gdc-remove-gutter-bg-color: rgba(248, 81, 73, 0.25);

  /* Gutter */
  --gdc-gutter-bg-color: #161b22;
  --gdc-gutter-text-color: #6e7681;

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
  color: var(--text-muted);
  font-size: 12px;
}

.code-block {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

.result-text {
  background: var(--code-bg, #0d1117);
  color: var(--code-fg, #c9d1d9);
}
</style>
