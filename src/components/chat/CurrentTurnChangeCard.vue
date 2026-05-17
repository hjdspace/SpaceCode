<template>
  <div class="turn-change-card" :class="{ 'is-latest': isLatest }">
    <div class="card-header">
      <div class="header-left">
        <span class="icon">📝</span>
        <h3 class="title">
          {{ t('chat.turnChangesTitle', { count: filesChangedCount }) }}
          <span class="stats">
            +{{ totalInsertions }} -{{ totalDeletions }}
          </span>
        </h3>
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
          {{ undoButtonText }}
        </button>
      </div>
    </div>

    <div class="file-list" v-if="filesChanged.length > 0">
      <div
        v-for="(file, index) in filesChanged"
        :key="file.path"
        class="file-item"
      >
        <button
          class="file-header"
          @click="toggleFileDiff(index)"
          :aria-label="expandedFileIndex === index ? hideDiffAria(file.path) : showDiffAria(file.path)"
        >
          <span class="file-icon">{{ getFileIcon(file.path) }}</span>
          <span class="file-name">{{ getRelativePath(file.path) }}</span>
          <span class="file-stats">
            <span class="insertions">+{{ file.insertions }}</span>
            <span class="deletions">-{{ file.deletions }}</span>
          </span>
          <span class="expand-icon">{{ expandedFileIndex === index ? '▼' : '▶' }}</span>
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
      No files changed in this turn.
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { api } from '@/services/electronAPI'
import WorkspaceDiffSurface from './WorkspaceDiffSurface.vue'
import type { TurnChangeCardData, FileChangedEntry } from '@/types'

const props = defineProps<{
  cardData: TurnChangeCardData
}>()

const { t } = useI18n()
const chatStore = useChatStore()

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
  chatStore.rewindingTurnId === props.cardData.targetUserMessageId
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
  const workDir = props.cardData.workDir || chatStore.workingDirectory
  if (!workDir) return absolutePath
  
  if (absolutePath.startsWith(workDir)) {
    const relative = absolutePath.slice(workDir.length).replace(/^[/\\]/, '')
    return relative || absolutePath.split('/').pop() || absolutePath
  }
  
  return absolutePath.split('/').pop() || absolutePath
}

function getFileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  const iconMap: Record<string, string> = {
    ts: '📘', tsx: '⚛️', js: '📜', jsx: '⚛️',
    vue: '💚', py: '🐍', json: '📋', md: '📝',
    css: '🎨', scss: '🎨', html: '🌐', sh: '🖥️',
  }
  return iconMap[ext || ''] || '📄'
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
    const sessionId = chatStore.currentSessionId!
    const result = await api.session.getTurnCheckpointDiff(
      sessionId,
      props.cardData.targetUserMessageId,
      file.path,
      props.cardData.checkpoint.target.userMessageIndex
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
    await chatStore.undoTurn(
      chatStore.currentSessionId!,
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
  background-color: var(--color-surface-elevated, #2a2a2a);
  border: 1px solid var(--color-border, #3c3c3c);
  border-radius: var(--radius-lg, 12px);
  padding: 16px;
  margin: 16px 0;
  box-shadow: var(--shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.2));
  transition: all 0.3s ease;

  &.is-latest {
    border-left: 4px solid var(--color-primary, #6366f1);
  }

  &:hover {
    box-shadow: var(--shadow-md, 0 4px 16px rgba(0, 0, 0, 0.25));
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  gap: 12px;

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;

    .icon {
      font-size: 18px;
    }

    .title {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-text-primary, #ffffff);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;

      .stats {
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-secondary, #cccccc);

        .insertions {
          color: var(--color-diff-added-text, #10b981);
        }

        .deletions {
          color: var(--color-diff-removed-text, #ef4444);
        }
      }
    }
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;

    .subtitle {
      font-size: 12px;
      color: var(--color-text-tertiary, #888888);
    }

    .undo-btn {
      padding: 6px 12px;
      border-radius: var(--radius-md, 6px);
      font-size: 13px;
      font-weight: 500;
      color: var(--color-primary, #6366f1);
      background-color: transparent;
      border: 1px solid var(--color-primary, #6366f1);
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;

      &:hover:not(:disabled) {
        background-color: var(--color-primary-hover, rgba(99, 102, 241, 0.15));
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }
  }
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-item {
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
  transition: all 0.2s ease;

  &:hover {
    background-color: var(--color-surface-hover, rgba(255, 255, 255, 0.03));
  }
}

.file-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font-family: inherit;
  font-size: 13px;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
  }

  .file-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    color: var(--color-text-secondary, #cccccc);
  }

  .file-stats {
    display: flex;
    gap: 8px;
    font-size: 12px;
    font-weight: 500;
    flex-shrink: 0;

    .insertions {
      color: var(--color-diff-added-text, #10b981);
    }

    .deletions {
      color: var(--color-diff-removed-text, #ef4444);
    }
  }

  .expand-icon {
    font-size: 10px;
    color: var(--color-text-tertiary, #888888);
    flex-shrink: 0;
    transition: transform 0.2s ease;
  }
}

.diff-loading,
.diff-error {
  padding: 12px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-tertiary, #888888);
  background-color: var(--color-surface-base, rgba(30, 30, 30, 0.5));
}

.diff-error {
  color: var(--color-error, #ef4444);
}

.diff-viewer {
  border-top: 1px solid var(--color-border, #3c3c3c);
}

.no-files {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-tertiary, #888888);
}
</style>
