<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <FileText v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.read') }}</span>
      <template v-if="filePath">
        <span class="tool-separator">·</span>
        <span class="tool-target">{{ filePath }}</span>
      </template>
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

    <div v-if="isExpanded && (fileContent || toolCall.status === 'completed')" class="tool-body">
      <StreamingCodeBlock
        v-if="fileContent"
        :code="fileContent.code"
        :file-path="filePath"
        :language="fileLanguage"
        :start-line="fileContent.startLine"
      />
      <div v-else class="empty-content">{{ t('toolCards.readEmptyFile') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { FileText, ChevronDown, ExternalLink, Loader2, X } from 'lucide-vue-next'
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
  if (props.toolCall.status === 'running') return ''
  return t('toolCards.readUnknownFile')
})
const fileLanguage = computed(() => appStore.getLanguageFromPath(filePath.value || ''))

/** 引擎 Read 输出每行带 N→/N\t 行号前缀 (addLineNumbers) */
const LINE_NUMBER_PREFIX = /^\s*(\d+)[\u2192\t]/

/** 剥离行号前缀后交给 StreamingCodeBlock 渲染, 并保留分段读取时的真实起始行号 */
const fileContent = computed<{ code: string; startLine: number } | null>(() => {
  const raw = props.toolCall.output || ''
  if (!raw) return null
  const lines = raw.split('\n')
  const firstMatch = lines[0].match(LINE_NUMBER_PREFIX)
  if (!firstMatch) return { code: raw, startLine: 1 }
  return {
    code: lines.map(line => line.replace(LINE_NUMBER_PREFIX, '')).join('\n'),
    startLine: Number(firstMatch[1]),
  }
})

function toggleExpand() { isExpanded.value = !isExpanded.value }

async function openInPanel() {
  const rawFp = props.toolCall.input?.file_path || props.toolCall.input?.path
  if (!rawFp) return
  const fp = appStore.resolveSessionPath(rawFp)

  const content = await api.readFile(fp)
  if (content === null) return

  const language = appStore.getLanguageFromPath(fp)
  appStore.showToolDiff({
    type: 'read',
    filePath: fp,
    originalContent: content,
    modifiedContent: content,
    toolCallId: props.toolCall.id,
    language,
  })
}
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

.empty-content {
  padding: 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
</style>
