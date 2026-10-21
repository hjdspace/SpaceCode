<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <FileEdit v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.edit') }}</span>
      <template v-if="filePath">
        <span class="tool-separator">·</span>
        <span class="tool-target">{{ filePath }}</span>
      </template>
      <span v-if="toolCall.status === 'running'" class="tool-meta status-running">{{ t('toolCards.editStreaming') }}</span>
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
      <!-- 专业 Diff 展示：Claude 是单段 old/new，pi 是 edits[] 多段 —— 多段共用一个圆角外框，
           块间用 ⋯ 分隔行衔接（git 折叠上下文惯例），独立间距会被误读为同一改动展示两遍 -->
      <div v-if="diffFiles.length > 0" class="git-diff-stack">
        <template v-for="(file, index) in diffFiles" :key="`${diffViewKey}:${index}`">
          <div v-if="index > 0" class="diff-separator" aria-hidden="true">⋯</div>
          <div v-if="diffFiles.length > 1" class="diff-segment-label">
            {{ t('toolCards.editSegmentTag', { index: index + 1, total: diffFiles.length }) }}
          </div>
          <DiffView
            :diff-file="file"
            :diff-view-mode="DiffModeEnum.Unified"
            :diff-view-highlight="true"
            class="git-diff-container"
          />
        </template>
      </div>

      <!-- 无 diff 数据时的回退显示 -->
      <div v-else class="empty-diff">
        <span>{{ t('toolCards.editNoChanges') }}</span>
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
import { extractEditParts, hasEditableParts } from '@/lib/editInput'
import '@git-diff-view/vue/styles/diff-view.css'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const appStore = useAppStore()
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const filePath = computed(() => {
  const fp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (fp) return fp
  if (props.toolCall.status === 'running') return ''
  return t('toolCards.editUnknownFile')
})

function toggleExpand() { isExpanded.value = !isExpanded.value }

// Diff 数据源：old/new 的字段名随引擎不同（Claude: old_string/new_string；pi: edits[].oldText/newText），
// 统一走 extractEditParts 归一化，这里不感知引擎差异
const editParts = computed(() => extractEditParts(props.toolCall.input))
const hasDiffData = computed(() => hasEditableParts(editParts.value))
const fileLanguage = computed(() => appStore.getLanguageFromPath(filePath.value))
const diffViewKey = computed(() => [
  props.toolCall.id,
  filePath.value,
  editParts.value.map(part => `${part.old.length}-${part.new.length}`).join('|'),
  props.toolCall.status,
].join(':'))

// 创建 DiffFile 实例列表（用于 DiffView 组件），每个编辑段一个
const diffFiles = computed(() => {
  if (!hasDiffData.value) return []

  const fileName = filePath.value.split(/[/\\]/).pop() || 'file'
  const isDarkTheme = document.documentElement.getAttribute('data-theme')?.includes('dark')

  return editParts.value.map((part, index) => {
    // 多段编辑时同一文件出现多个 diff，编号区分（单段保持原样不缀序号）
    const label = editParts.value.length > 1 ? `${fileName} #${index + 1}` : fileName

    // 使用 generateDiffFile 自动比较两个文件内容并生成 diff
    const file = generateDiffFile(
      `${label}.old`,
      part.old,
      `${label}.new`,
      part.new,
      fileLanguage.value,
      fileLanguage.value
    )

    // 根据当前主题初始化
    file.initTheme(isDarkTheme ? 'dark' : 'light')
    file.init()
    file.buildUnifiedDiffLines()

    return file
  })
})

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
    // 多段编辑逆序回放：后一段的 old 可能由前一段的 new 变换而来，正序替换会错位
    const parts = extractEditParts(props.toolCall.input).filter(part => part.new)
    if (parts.length > 0) {
      originalContent = modifiedContent
      for (const part of [...parts].reverse()) {
        if (originalContent.includes(part.new)) {
          originalContent = originalContent.replace(part.new, part.old)
        }
      }
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

/* 多段 diff（pi edits[] / MultiEdit）共用一个圆角外框 —— 块间靠分隔行衔接，不留独立间距 */
.git-diff-stack {
  border-radius: 6px;
  overflow: hidden;
}

/* 块间 "⋯" 分隔行：git 折叠上下文惯例，语义是"此处省略未改动行"而非另一份 diff */
.diff-separator {
  padding: 3px 0;
  text-align: center;
  font-size: var(--text-xs-plus);
  line-height: 1;
  color: var(--text-muted);
  background: var(--bg-secondary);
  user-select: none;
}

/* 多段时的段落标签（如"编辑 2/4"）：片段 diff 行号从 1 重开，需可见序号消除重复感 */
.diff-segment-label {
  padding: 4px 12px;
  font-size: var(--text-xs-plus);
  line-height: 1.2;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--surface-border, #30363d);
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

  @include scrollbar-overlay;
}

.empty-diff {
  padding: 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
</style>
