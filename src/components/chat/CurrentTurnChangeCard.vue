<template>
  <div class="turn-change-card">
    <div class="card-header">
      <div class="header-left">
        <span class="card-icon" aria-hidden="true">
          <FilePlus2 :size="14" :stroke-width="1.9" />
        </span>
        <h3 class="title">
          {{ t('chat.turnChangesTitle', { count: filesChangedCount }) }}
        </h3>
        <span class="stats" aria-hidden="true">
          <span class="insertions">+{{ totalInsertions }}</span>
          <span class="deletions">-{{ totalDeletions }}</span>
        </span>
      </div>

      <div class="header-right">
        <span v-if="!isLatest" class="subtitle">
          {{ t('chat.turnChangesHistoricalSubtitle') }}
        </span>
        <button
          class="btn-text"
          :disabled="isUndoing"
          @click="handleUndo"
          :title="undoButtonLabel"
          :aria-label="undoButtonLabel"
        >
          {{ undoButtonText }}
        </button>
        <button
          class="btn-outline"
          @click="handleReview"
          :aria-label="t('chat.turnChangesReviewAria')"
        >
          {{ t('chat.turnChangesReview') }}
        </button>
      </div>
    </div>

    <div v-if="filesChanged.length > 0" class="file-list">
      <button
        v-for="file in visibleFiles"
        :key="file.path"
        class="file-row"
        :title="toRelativePath(file.path)"
        :aria-label="t('chat.turnChangesShowDiffAria', { path: toRelativePath(file.path) })"
        @mouseenter="handleFileEnter($event, file)"
        @mouseleave="handleFileLeave"
        @focus="handleFileEnter($event, file)"
        @blur="handleFileLeave"
        @click="handleFileClick(file)"
      >
        <Icon
          class="file-icon"
          :icon="getFileIcon(basenameOf(file.path))"
          :width="15"
          :height="15"
        />
        <span class="file-name">{{ toRelativePath(file.path) }}</span>
        <span class="file-stats">
          <span class="insertions">+{{ file.insertions }}</span>
          <span class="deletions">-{{ file.deletions }}</span>
        </span>
      </button>

      <button
        v-if="hiddenFileCount > 0"
        class="list-toggle"
        :aria-expanded="showAllFiles"
        @click="showAllFiles = !showAllFiles"
      >
        <ChevronDown :size="13" :stroke-width="2" :class="{ rotated: showAllFiles }" />
        <span>{{
          showAllFiles
            ? t('chat.turnChangesShowLess')
            : t('chat.turnChangesShowMore', { count: hiddenFileCount })
        }}</span>
      </button>
    </div>

    <div v-else class="no-files">
      {{ t('chat.turnChangesNoFiles') }}
    </div>

    <Teleport to="body">
      <div
        v-if="hoveredFile"
        class="turn-diff-popup"
        :style="popupStyle"
        @mouseenter="cancelHide"
        @mouseleave="handleFileLeave"
      >
        <div class="popup-header">
          <Icon
            class="file-icon"
            :icon="getFileIcon(basenameOf(hoveredFile.path))"
            :width="15"
            :height="15"
          />
          <span class="popup-path">{{ toRelativePath(hoveredFile.path) }}</span>
          <span class="popup-stats">
            <span class="insertions">+{{ hoveredFile.insertions }}</span>
            <span class="deletions">-{{ hoveredFile.deletions }}</span>
          </span>
        </div>
        <div v-if="popupState.status === 'loading'" class="popup-state">
          {{ t('chat.turnChangesDiffLoading') }}
        </div>
        <div v-else-if="popupState.status === 'error'" class="popup-state popup-error">
          {{ popupState.error || t('chat.turnChangesDiffUnavailable') }}
        </div>
        <WorkspaceDiffSurface
          v-else-if="popupState.status === 'ready'"
          :value="popupState.diff"
          :path="toRelativePath(hoveredFile.path)"
          :line-limit="POPUP_LINE_LIMIT"
          :style="{ maxHeight: `${popupBodyHeight}px`, border: 'none', borderRadius: '0' }"
        />
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatSessionStore } from '@/stores/chatSession'
import { useSessionContext } from '@/stores/sessionContext'
import { api } from '@/services/electronAPI'
import { FilePlus2, ChevronDown } from 'lucide-vue-next'
import { Icon, addCollection } from '@iconify/vue'
import fileIconSet from '@/assets/vscode-icons.json'
import { getFileIcon } from '../explorer/fileIcons'
import WorkspaceDiffSurface from './WorkspaceDiffSurface.vue'
import type { TurnChangeCardData, FileChangedEntry } from '@/types'

addCollection(fileIconSet)

const props = defineProps<{
  cardData: TurnChangeCardData
}>()

const { t } = useI18n()
const sessionStore = useChatSessionStore()
const sessionContext = useSessionContext()

const COLLAPSED_FILE_COUNT = 3
const HOVER_DELAY_MS = 160
const POPUP_MAX_HEIGHT = 420
const POPUP_MIN_HEIGHT = 160
const POPUP_GAP = 8
const POPUP_HEADER_HEIGHT = 40
const POPUP_LINE_LIMIT = 600

type DiffEntry =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; diff: string }
  | { status: 'error'; error?: string }

const diffs = ref<Record<string, DiffEntry>>({})
const showAllFiles = ref(false)
const hoveredFile = ref<FileChangedEntry | null>(null)
const popupStyle = ref<Record<string, string>>({})
const popupBodyHeight = ref(POPUP_MAX_HEIGHT)

let enterTimer: ReturnType<typeof setTimeout> | null = null
let leaveTimer: ReturnType<typeof setTimeout> | null = null

const isLatest = computed(() => props.cardData.isLatest)
const workDir = computed(() => props.cardData.workDir || sessionStore.workingDirectory || '')

const filesChanged = computed<FileChangedEntry[]>(() =>
  props.cardData.checkpoint.code.filesChanged.filter(
    (f): f is FileChangedEntry => 'path' in f
  )
)

const filesChangedCount = computed(() => filesChanged.value.length)
const totalInsertions = computed(() =>
  filesChanged.value.reduce((sum, f) => sum + (f.insertions || 0), 0)
)
const totalDeletions = computed(() =>
  filesChanged.value.reduce((sum, f) => sum + (f.deletions || 0), 0)
)

const visibleFiles = computed(() =>
  showAllFiles.value
    ? filesChanged.value
    : filesChanged.value.slice(0, COLLAPSED_FILE_COUNT)
)
const hiddenFileCount = computed(() =>
  Math.max(0, filesChanged.value.length - COLLAPSED_FILE_COUNT)
)

const popupState = computed<DiffEntry>(() =>
  hoveredFile.value ? diffs.value[hoveredFile.value.path] || { status: 'idle' } : { status: 'idle' }
)

const isUndoing = computed(() =>
  sessionStore.rewindingTurnId === props.cardData.targetUserMessageId
)

const undoButtonText = computed(() =>
  isUndoing.value ? t('chat.turnChangesUndoing') : t('chat.turnChangesUndo')
)

const undoButtonLabel = computed(() =>
  isLatest.value ? t('chat.turnChangesLatestCardLabel') : t('chat.turnChangesHistoricalCardLabel')
)

function basenameOf(p: string): string {
  return p.replace(/\\/g, '/').split('/').pop() || p
}

/** trackingPath 可能是 workDir 相对路径（Windows 下带反斜杠）也可能是绝对路径 */
function toRelativePath(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const root = workDir.value.replace(/\\/g, '/').replace(/\/+$/, '')
  if (root && normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return normalized.slice(root.length + 1)
  }
  return normalized
}

function clearHoverTimers() {
  if (enterTimer) { clearTimeout(enterTimer); enterTimer = null }
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null }
}

function closePopup() {
  hoveredFile.value = null
}

function handleFileEnter(event: MouseEvent | FocusEvent, file: FileChangedEntry) {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null }
  if (enterTimer) clearTimeout(enterTimer)

  const anchor = event.currentTarget as HTMLElement | null
  enterTimer = setTimeout(() => {
    enterTimer = null
    hoveredFile.value = file
    if (anchor) placePopup(anchor)
    void ensureDiff(file)
  }, HOVER_DELAY_MS)
}

function handleFileLeave() {
  if (enterTimer) { clearTimeout(enterTimer); enterTimer = null }
  if (leaveTimer) return
  leaveTimer = setTimeout(() => {
    leaveTimer = null
    closePopup()
  }, HOVER_DELAY_MS)
}

function cancelHide() {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null }
}

function placePopup(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect()
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const width = Math.min(760, viewportW - POPUP_GAP * 2)
  const left = Math.min(
    Math.max(POPUP_GAP, rect.left),
    Math.max(POPUP_GAP, viewportW - width - POPUP_GAP)
  )

  const spaceAbove = rect.top - POPUP_GAP * 2
  const spaceBelow = viewportH - rect.bottom - POPUP_GAP * 2
  const openAbove = spaceAbove >= POPUP_MIN_HEIGHT || spaceBelow < POPUP_MIN_HEIGHT
  const available = openAbove ? spaceAbove : spaceBelow
  const bodyHeight = Math.max(
    POPUP_MIN_HEIGHT,
    Math.min(POPUP_MAX_HEIGHT, available - POPUP_HEADER_HEIGHT)
  )

  popupBodyHeight.value = bodyHeight

  const style: Record<string, string> = {
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${bodyHeight + POPUP_HEADER_HEIGHT}px`,
  }
  if (openAbove) style.bottom = `${viewportH - rect.top + POPUP_GAP}px`
  else style.top = `${rect.bottom + POPUP_GAP}px`

  popupStyle.value = style
}

/** 弹层头部已展示路径，diff 正文里省掉 git 文件头三行 */
function stripPatchHeader(patch: string): string {
  const lines = patch.split('\n')
  while (lines.length && /^(diff --git |--- a\/|\+\+\+ b\/)/.test(lines[0])) lines.shift()
  return lines.join('\n')
}

async function ensureDiff(file: FileChangedEntry) {
  if (diffs.value[file.path]) return
  diffs.value = { ...diffs.value, [file.path]: { status: 'loading' } }

  try {
    const result = await api.session.getTurnCheckpointDiff(
      sessionStore.currentSessionId!,
      props.cardData.targetUserMessageId,
      file.path,
      props.cardData.checkpoint.target.userMessageIndex,
      sessionStore.workingDirectory
    )
    diffs.value = result.state === 'ok' && result.diff
      ? { ...diffs.value, [file.path]: { status: 'ready', diff: stripPatchHeader(result.diff) } }
      : { ...diffs.value, [file.path]: { status: 'error', error: result.error || undefined } }
  } catch (err) {
    console.error('[CurrentTurnChangeCard] Failed to load diff:', err)
    diffs.value = {
      ...diffs.value,
      [file.path]: { status: 'error', error: err instanceof Error ? err.message : undefined },
    }
  }
}

function handleFileClick(file: FileChangedEntry) {
  clearHoverTimers()
  closePopup()
  sessionContext.openReviewWithFile(toRelativePath(file.path))
}

function handleReview() {
  clearHoverTimers()
  closePopup()
  sessionContext.openReviewPanel()
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

// 弹层用 fixed 定位，列表一滚动就会与文件行脱节，直接收起
function handleScroll() {
  closePopup()
}

watch(hoveredFile, file => {
  if (file) window.addEventListener('scroll', handleScroll, true)
  else window.removeEventListener('scroll', handleScroll, true)
})

watch(
  () => props.cardData.checkpoint,
  () => {
    clearHoverTimers()
    closePopup()
    showAllFiles.value = false
    diffs.value = {}
  }
)

onUnmounted(() => {
  clearHoverTimers()
  window.removeEventListener('scroll', handleScroll, true)
})
</script>

<style lang="scss" scoped>
.turn-change-card {
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border-strong);
  border-radius: var(--radius-lg, 10px);
  margin: 16px 0;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: border-color 150ms ease, box-shadow 250ms ease;

  &:hover {
    box-shadow: var(--shadow-md);
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--surface-border);

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
    width: 26px;
    height: 26px;
    border-radius: 7px;
    background: var(--surface-glass);
    border: 1px solid var(--surface-border);
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-primary);
    line-height: var(--leading-compact);
  }

  .stats {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;

  .subtitle {
    font-size: var(--text-2xs);
    font-weight: 500;
    color: var(--text-muted);
  }
}

.insertions {
  color: var(--gdc-add-text-color, var(--success));
}
.deletions {
  color: var(--gdc-remove-text-color, var(--error));
}

.btn-text,
.btn-outline {
  font-family: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-text {
  padding: 6px 4px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm, 6px);

  &:hover:not(:disabled) {
    color: var(--text-primary);
  }
}

.btn-outline {
  padding: 6px 14px;
  border: 1px solid var(--surface-border-strong);
  border-radius: var(--radius-full, 9999px);
  background: var(--bg-elevated);
  color: var(--text-primary);

  &:hover {
    background: var(--surface-glass-hover);
    border-color: var(--border-strong);
  }
}

.file-list {
  display: flex;
  flex-direction: column;
  padding: 4px 6px 6px;
}

.file-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  text-align: left;
  color: inherit;
  font-family: inherit;
  transition: background 150ms ease;

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.file-icon {
  flex-shrink: 0;
  display: inline-flex;
}

.file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.file-stats,
.popup-stats {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
  font-size: var(--text-2xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.list-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  margin: 2px 0 0 8px;
  padding: 6px 4px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--text-secondary);

  &:hover {
    color: var(--text-primary);
  }

  svg {
    transition: transform 150ms ease;

    &.rotated {
      transform: rotate(180deg);
    }
  }
}

.no-files {
  padding: 18px 16px;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-muted);
}
</style>

<style lang="scss">
/* Teleport 到 body，样式不能 scoped */
.turn-diff-popup {
  position: fixed;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border-strong);
  border-radius: var(--radius-lg, 10px);
  box-shadow: var(--shadow-xl);

  .popup-header {
    display: flex;
    align-items: center;
    gap: 9px;
    flex-shrink: 0;
    padding: 9px 12px;
    border-bottom: 1px solid var(--surface-border);
  }

  .popup-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .popup-state {
    padding: 20px 16px;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .popup-error {
    color: var(--error);
  }
}
</style>
