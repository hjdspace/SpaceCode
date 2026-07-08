<template>
  <div class="turn-change-card" :class="{ 'is-latest': isLatest }">
    <div class="card-header">
      <div class="header-left">
        <span class="card-icon" aria-hidden="true">
          <FileEdit :size="14" :stroke-width="2" />
        </span>
        <h3 class="title">
          {{ t('chat.turnChangesTitle', { count: filesChangedCount }) }}
        </h3>
        <span class="stats" aria-hidden="true">
          <span class="insertions">+{{ totalInsertions }}</span>
          <span class="deletions">−{{ totalDeletions }}</span>
        </span>
      </div>

      <div class="header-right">
        <span v-if="!isLatest" class="subtitle">
          {{ t('chat.turnChangesHistoricalSubtitle') }}
        </span>
        <button
          @click="handleUndo"
          :disabled="isUndoing"
          class="undo-btn"
          :aria-label="undoButtonLabel"
        >
          <RotateCcw :size="13" :stroke-width="2" />
          <span>{{ undoButtonText }}</span>
        </button>
      </div>
    </div>

    <div class="file-list" v-if="filesChanged.length > 0">
      <div
        v-for="(file, index) in filesChanged"
        :key="file.path"
        class="file-item"
        :class="{ 'is-expanded': expandedFileIndex === index }"
      >
        <button
          class="file-header"
          @click="toggleFileDiff(index)"
          :aria-label="expandedFileIndex === index ? hideDiffAria(file.path) : showDiffAria(file.path)"
        >
          <ChevronRight
            class="expand-icon"
            :size="13"
            :stroke-width="2.25"
          />
          <FileText class="file-icon" :size="13" :stroke-width="1.75" />
          <span class="file-name">{{ getRelativePath(file.path) }}</span>
          <span class="file-stats">
            <span class="insertions">+{{ file.insertions }}</span>
            <span class="deletions">−{{ file.deletions }}</span>
          </span>
        </button>

        <div v-if="expandedFileIndex === index && loadingDiff === file.path" class="diff-loading">
          {{ t('chat.turnChangesDiffLoading') }}
        </div>

        <div v-else-if="expandedFileIndex === index && diffError[file.path]" class="diff-error">
          {{ diffError[file.path] || t('chat.turnChangesDiffUnavailable') }}
        </div>

        <WorkspaceDiffSurface
          v-else-if="expandedFileIndex === index && diffContent[file.path]"
          :value="diffContent[file.path]"
          :path="file.path"
          class="diff-viewer"
        />
      </div>
    </div>

    <div v-else class="no-files">
      {{ t('chat.turnChangesNoFiles') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatSessionStore } from '@/stores/chat'
import { api } from '@/services/electronAPI'
import { FileEdit, FileText, ChevronRight, RotateCcw } from 'lucide-vue-next'
import WorkspaceDiffSurface from './WorkspaceDiffSurface.vue'
import type { TurnChangeCardData, FileChangedEntry } from '@/types'

const props = defineProps<{
  cardData: TurnChangeCardData
}>()

const { t } = useI18n()
const sessionStore = useChatSessionStore()

const expandedFileIndex = ref<number | null>(null)
const diffContent = ref<Record<string, string>>({})
const diffError = ref<Record<string, string | null>>({})
const loadingDiff = ref<string | null>(null)

const isLatest = computed(() => props.cardData.isLatest)
const filesChanged = computed<FileChangedEntry[]>(() => {
  return props.cardData.checkpoint.code.filesChanged.filter(
    (f): f is FileChangedEntry => 'path' in f
  )
})

const filesChangedCount = computed(() => filesChanged.value.length)
const totalInsertions = computed(() => 
  filesChanged.value.reduce((sum, f) => sum + (f.insertions || 0), 0)
)
const totalDeletions = computed(() => 
  filesChanged.value.reduce((sum, f) => sum + (f.deletions || 0), 0)
)

const isUndoing = computed(() => 
  sessionStore.rewindingTurnId === props.cardData.targetUserMessageId
)

const undoButtonText = computed(() => 
  isUndoing.value ? t('chat.turnChangesUndoing') : (
    isLatest.value ? t('chat.turnChangesLatestUndo') : t('chat.turnChangesHistoricalUndo')
  )
)

const undoButtonLabel = computed(() =>
  isLatest.value ? t('chat.turnChangesLatestCardLabel') : t('chat.turnChangesHistoricalCardLabel')
)

function getRelativePath(absolutePath: string): string {
  const workDir = props.cardData.workDir || sessionStore.workingDirectory
  if (!workDir) return absolutePath
  
  if (absolutePath.startsWith(workDir)) {
    const relative = absolutePath.slice(workDir.length).replace(/^[/\\]/, '')
    return relative || absolutePath.split('/').pop() || absolutePath
  }
  
  return absolutePath.split('/').pop() || absolutePath
}

function showDiffAria(path: string): string {
  return t('chat.turnChangesShowDiffAria', { path })
}

function hideDiffAria(path: string): string {
  return t('chat.turnChangesHideDiffAria', { path })
}

async function toggleFileDiff(index: number) {
  if (expandedFileIndex.value === index) {
    expandedFileIndex.value = null
    return
  }
  
  const file = filesChanged.value[index]
  if (!file) return
  
  expandedFileIndex.value = index
  
  if (diffContent.value[file.path]) return
  
  loadingDiff.value = file.path
  diffError.value[file.path] = null
  
  try {
    const sessionId = sessionStore.currentSessionId!
    const projectPath = sessionStore.workingDirectory
    const result = await api.session.getTurnCheckpointDiff(
      sessionId,
      props.cardData.targetUserMessageId,
      file.path,
      props.cardData.checkpoint.target.userMessageIndex,
      projectPath
    )
    
    if (result.state === 'ok' && result.diff) {
      diffContent.value[file.path] = result.diff
    } else {
      throw new Error(result.error || 'Failed to load diff')
    }
  } catch (err) {
    console.error('[CurrentTurnChangeCard] Failed to load diff:', err)
    diffError.value[file.path] = err instanceof Error ? err.message : 'Unknown error'
  } finally {
    loadingDiff.value = null
  }
}

async function handleUndo() {
  try {
    await sessionStore.undoTurn(
      sessionStore.currentSessionId!,
      props.cardData.targetUserMessageId,
      props.cardData.checkpoint.target.userMessageIndex
    )
  } catch (err) {
    console.error('[CurrentTurnChangeCard] Undo failed:', err)
  }
}

watch(() => props.cardData.checkpoint, () => {
  expandedFileIndex.value = null
  diffContent.value = {}
  diffError.value = {}
})
</script>

<style lang="scss" scoped>
.turn-change-card {
  background: var(--bg-elevated, #2a2928);
  border: 1px solid var(--border-default, rgba(255, 255, 255, 0.09));
  border-radius: var(--radius-lg, 10px);
  margin: 16px 0;
  overflow: hidden;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.2));
  transition:
    border-color 150ms ease,
    box-shadow 250ms ease;

  &.is-latest {
    border-left: 3px solid var(--accent-primary, #d97757);
  }

  &:hover {
    border-color: var(--border-strong, rgba(255, 255, 255, 0.16));
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05));

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    flex-wrap: wrap;
  }

  .card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: rgba(217, 119, 87, 0.12);
    color: var(--accent-primary, #d97757);
    flex-shrink: 0;
  }

  .title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #faf9f5);
    line-height: 1.3;
  }

  .stats {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-glass, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.08));
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.6;

    .insertions {
      color: var(--gdc-add-text-color, #5c7040);
    }
    .deletions {
      color: var(--gdc-remove-text-color, #c44e3f);
    }
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;

  .subtitle {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted, rgba(255, 255, 255, 0.5));
  }
}

.undo-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  background: var(--surface-glass, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--surface-border, rgba(255, 255, 255, 0.08));
  cursor: pointer;
  transition: all 150ms ease;
  white-space: nowrap;

  svg {
    flex-shrink: 0;
  }

  &:hover:not(:disabled) {
    color: var(--accent-primary, #d97757);
    background: rgba(217, 119, 87, 0.10);
    border-color: rgba(217, 119, 87, 0.35);
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.file-list {
  display: flex;
  flex-direction: column;
  padding: 4px;
  gap: 1px;
}

.file-item {
  border-radius: 6px;
  overflow: hidden;
  transition: background 150ms ease;

  &.is-expanded {
    background: var(--surface-glass, rgba(255, 255, 255, 0.04));

    .expand-icon {
      transform: rotate(90deg);
      color: var(--accent-primary, #d97757);
    }
  }
}

.file-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font-family: inherit;
  border-radius: 6px;
  transition: background 150ms ease;

  &:hover {
    background: var(--surface-glass-hover, rgba(255, 255, 255, 0.07));
  }

  .expand-icon {
    color: var(--text-muted, rgba(255, 255, 255, 0.5));
    flex-shrink: 0;
    transition: transform 150ms ease, color 150ms ease;
  }

  .file-icon {
    color: var(--text-muted, rgba(255, 255, 255, 0.5));
    flex-shrink: 0;
  }

  .file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 12px;
    color: var(--text-primary, #faf9f5);
  }

  .file-stats {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;

    .insertions {
      color: var(--gdc-add-text-color, #5c7040);
    }
    .deletions {
      color: var(--gdc-remove-text-color, #c44e3f);
    }
  }
}

.diff-loading,
.diff-error {
  padding: 14px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted, rgba(255, 255, 255, 0.5));
  border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05));
  background: var(--surface-glass, rgba(255, 255, 255, 0.04));
}

.diff-error {
  color: var(--error, #c44e3f);
}

.diff-viewer {
  border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05));
  background: var(--bg-tertiary, #1c1b1a);
}

.no-files {
  padding: 18px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted, rgba(255, 255, 255, 0.5));
}
</style>
