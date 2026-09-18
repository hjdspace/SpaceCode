<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <FilePlus v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.write') }}</span>
      <template v-if="filePath">
        <span class="tool-separator">·</span>
        <span class="tool-target">{{ filePath }}</span>
      </template>
      <span v-if="toolCall.status === 'running'" class="tool-meta status-running">{{ t('toolCards.writeStreaming') }}</span>
      <span v-else-if="outputSummary" class="tool-meta" :class="summaryClass">{{ outputSummary }}</span>
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

    <div v-if="showBody && toolCall.input.content" class="tool-body">
      <StreamingCodeBlock
        :code="toolCall.input.content"
        :file-path="filePath"
        :language="fileLanguage"
        :streaming="isStreaming"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { FilePlus, ChevronDown, ExternalLink, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import StreamingCodeBlock from './StreamingCodeBlock.vue'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const appStore = useAppStore()
const { t } = useI18n()

const statusClass = computed(() => `status-${props.toolCall.status}`)
const filePath = computed(() => {
  const fp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (fp) return fp
  // 流式期间 input 尚未填充，不显示"未知文件"，留空让模板隐藏
  if (props.toolCall.status === 'running') return ''
  return t('toolCards.writeUnknownFile')
})
const fileLanguage = computed(() => appStore.getLanguageFromPath(filePath.value || ''))
const isStreaming = computed(
  () => props.toolCall.status === 'running' && !!props.toolCall.input?.content,
)
// 流式期间自动展开实时代码流; 用户手动展开后保持展开
const showBody = computed(() => isExpanded.value || isStreaming.value)
const outputSummary = computed(() => {
  const out = props.toolCall.output || ''
  if (out.includes('successfully')) return t('toolCards.writeSuccess')
  if (out.includes('Error') || out.includes('error')) return t('toolCards.writeFailed')
  return null
})
const summaryClass = computed(() => {
  const out = props.toolCall.output || ''
  if (out.includes('successfully')) return 'status-completed'
  if (out.includes('Error') || out.includes('error')) return 'status-error'
  return ''
})

function toggleExpand() { isExpanded.value = !isExpanded.value }

async function openInPanel() {
  const rawFp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!rawFp) return
  const fp = appStore.resolveSessionPath(rawFp)

  // 可在内置浏览器预览的产物（html）直接用 webview 打开
  if (/\.html?$/i.test(fp)) {
    appStore.openFileInWebview(fp)
    return
  }

  const modifiedContent = await api.readFile(fp)
  if (modifiedContent === null) return

  let originalContent = ''
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
        }
      }
    }
  } catch { /* not in git repo or file not tracked */ }

  const language = appStore.getLanguageFromPath(fp)
  appStore.showToolDiff({
    type: 'write',
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

.tool-meta {
  &.status-completed { color: var(--success); }
  &.status-error { color: var(--error); }
  &.status-running { color: var(--accent-primary); }
}
</style>
