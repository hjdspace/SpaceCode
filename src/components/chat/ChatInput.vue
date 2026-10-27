<template>
  <div 
    ref="containerRef" 
    class="chat-input-container"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- 斜杠命令弹窗 -->
    <SlashCommandMenu
      :visible="showSlashCommandMenu"
      :position="slashMenuPosition"
      :search-query="commandPalette.searchQuery.value"
      :ghost-text="commandPalette.ghostText.value"
      :commands="filteredSlashCommands"
      :highlighted-command="highlightedSlashCommand"
      @select="selectSlashCommand"
      @navigate="(idx: number) => commandPalette.selectedIndex.value = idx"
      @close="closeSlashCommandMenu"
      @update:search-query="(val: string) => commandPalette.updateSearch(val)"
      @clear-search="clearSlashSearch"
      @open-skills-manager="openSkillsManager"
    />

    <!-- @ 上下文弹窗 -->
    <ContextMenu
      ref="contextMenuRef"
      :visible="showContextMenu"
      :position="contextMenuPosition"
      :search-query="contextSearchQuery"
      :items="filteredContextItems"
      :highlighted-item="highlightedContextItem"
      :is-loading="isLoadingContext"
      @select="selectContextItem"
      @navigate="(path: string) => highlightedContextItem = path"
      @close="closeContextMenu"
      @update:search-query="(val: string) => contextSearchQuery = val"
      @clear-search="clearContextSearch"
      @browse-files="handleBrowseFiles"
    />

    <!-- Pending Messages Bar（AI 回复期间的消息队列） -->
    <PendingQueueBar
      :messages="currentPendingMessages"
      @send-now="sendPendingNow"
      @recall="recallPendingMsg"
      @remove="removePendingMsg"
    />

    <div class="input-wrapper" :class="{ 'has-content': hasContent, 'is-sending': isSending, 'is-optimizing': isOptimizing, 'is-voice-active': voiceActive }">
      <!-- 悬浮任务/改动状态栏 -->
      <ComposerStatusBar v-if="!compact" :session-id="sessionId" />

      <!-- 引用文本附件条（选中文本浮条"添加到对话"） -->
      <QuoteAttachmentsBar :quotes="attachedQuotes" @remove="removeQuoteAttachment" />

      <!-- 上传的文件附件：卡片位于输入框内、正文上方 -->
      <div v-if="uploadedAttachments.length" class="composer-file-attachments">
        <FileAttachmentCard
          v-for="file in uploadedAttachments"
          :key="file.path"
          :file="file"
          removable
          @remove="removeAttachment(file.path)"
        />
      </div>

      <!-- 文本输入区域 — contenteditable 支持内联 chip -->
      <div class="textarea-wrapper" @click="focusEditor">
        <div
          ref="editorRef"
          class="inline-editor"
          :contenteditable="isEditorEditable"
          :data-placeholder="placeholder"
          @input="handleEditorInput"
          @keydown="handleEditorKeydown"
          @click="handleEditorClick"
          @paste="handleEditorPaste"
          @focus="handleEditorFocus"
          @blur="handleEditorBlur"
        ></div>
        <!-- 语音实时转写：纯文本追加在快照之后，不进入编辑器 DOM -->
        <div v-if="voiceLiveTranscript" class="voice-live-transcript" aria-live="polite">{{ voiceLiveTranscript }}</div>
        <!-- 提示词优化 shimmer 扫光层 -->
        <div v-if="isOptimizing" class="optimize-shimmer" aria-hidden="true"></div>
        <!-- Stash 提示浮层 -->
        <Transition name="stash-fade">
          <div v-if="showStashHint" class="stash-hint">
            <Archive :size="14" />
            <span>{{ t('chatInput.promptStashed') }}</span>
          </div>
        </Transition>
        <!-- Steering 提示浮层 -->
        <Transition name="stash-fade">
          <div v-if="showSteerHint" class="steer-hint">
            <Zap :size="14" />
            <span>{{ t('chatInput.messageSteered') }}</span>
          </div>
        </Transition>
        <!-- 思考开关生效时机 / 失败提示浮层 -->
        <Transition name="stash-fade">
          <div
            v-if="thinkingHint"
            class="steer-hint"
            :class="{ 'steer-hint-error': thinkingHint.isError }"
            role="status"
            aria-live="polite"
          >
            <AlertTriangle v-if="thinkingHint.isError" :size="14" />
            <Sparkles v-else :size="14" />
            <span>{{ thinkingHint.text }}</span>
          </div>
        </Transition>
      </div>

      <!-- 语音输入提示：权限指引 / 无语音 / 安装进度与失败 -->
      <div
        v-if="voiceHintText"
        class="voice-hint"
        :class="{ 'is-error': voiceHint?.kind === 'error' }"
        role="status"
        aria-live="polite"
      >
        <AlertTriangle v-if="voiceHint?.kind === 'error'" :size="14" class="voice-hint-icon" />
        <Mic v-else :size="14" class="voice-hint-icon" />
        <span class="voice-hint-text">{{ voiceHintText }}</span>
      </div>

      <!-- 底部工具栏：+ 号、模型选择、发送按钮 -->
      <div class="input-toolbar">
        <div class="toolbar-left">
          <!-- + 号按钮 -->
          <button class="toolbar-btn add-btn" @click="handleAddClickAndLoadAgents" :title="t('chatInput.addAttachment')">
            <Plus :size="18" />
          </button>

          <!-- 权限模式选择器 -->
          <PermissionModeSelector
            :model-value="permissionMode"
            :session-id="editorSessionId"
            @update:model-value="(mode: PermissionMode) => emit('update:permissionMode', mode)"
          />

          <button
            v-if="showOpenProjectAction"
            type="button"
            class="toolbar-btn open-project-btn"
            :title="t('chatInput.openProjectFolder')"
            @click="handleOpenProjectFolder"
          >
            <FolderOpen :size="18" />
          </button>

          <!-- Work 模式：助手画廊入口（按需弹出） -->
          <button
            v-if="appStore.mode === 'work'"
            type="button"
            class="toolbar-btn work-context-chip"
            :title="t('work.galleryEntry')"
            @click="appStore.showWorkGallery = true"
          >
            <LayoutGrid :size="15" />
            <span class="chip-label">{{ t('work.galleryEntry') }}</span>
          </button>

          <!-- 模型选择器（下拉、推理深度、子菜单定位归 ModelPickerMenu） -->
          <ModelPickerMenu :selector="modelSelector" />

          <!-- Thinking 模式开关 -->
          <div class="thinking-toggle-wrapper">
            <button
              class="toolbar-btn thinking-btn"
              :class="{ active: thinkingEnabled }"
              @click="toggleThinking"
              :title="thinkingEnabled ? t('chatInput.thinkingOn') : t('chatInput.thinkingOff')"
            >
              <Brain :size="14" />
            </button>
          </div>

          <!-- 提示词优化进行中提示 -->
          <Transition name="optimize-hint">
            <span v-if="isOptimizing" class="optimize-hint" role="status" aria-live="polite">
              <Sparkles :size="12" class="optimize-hint-icon" />
              <span class="optimize-hint-label">{{ t('chatInput.optimizing') }}</span>
              <span class="optimize-hint-dots" aria-hidden="true">
                <span></span><span></span><span></span>
              </span>
            </span>
          </Transition>

          <!-- design 模式扩展 slot：TemplatePicker 等设计专用工具栏按钮 -->
          <slot name="toolbar-extra"></slot>
        </div>

        <!-- 右侧按钮组：优化提示词 + 语音输入 + 发送/停止 -->
        <div class="toolbar-right">
          <!-- 优化提示词按钮（位于发送按钮左侧） -->
          <button
            v-if="showActions"
            class="optimize-btn"
            :class="{ 'is-optimizing': isOptimizing }"
            :disabled="isOptimizing || props.isSending || !hasContent"
            :title="t('chatInput.optimizePrompt')"
            @click.stop.prevent="handleOptimizePrompt"
          >
            <Loader2 v-if="isOptimizing" :size="16" class="spin" />
            <Sparkles v-else :size="16" />
          </button>

          <!-- 语音输入：录音中显示电平波形与停止方块 -->
          <template v-if="voiceSupported">
            <VoiceWaveform v-if="voiceActive" :level="voiceLevel" class="voice-waveform-slot" />
            <button
              type="button"
              class="toolbar-btn voice-btn"
              :class="{ 'is-recording': voiceActive }"
              :title="voiceActive ? t('chatInput.voiceStop') : t('chatInput.voiceStart')"
              :aria-label="voiceActive ? t('chatInput.voiceStop') : t('chatInput.voiceStart')"
              :aria-pressed="voiceActive"
              @mousedown.prevent
              @click.stop.prevent="handleVoiceClick"
            >
              <span v-if="voiceActive" class="voice-stop-square" aria-hidden="true"></span>
              <Mic v-else :size="16" />
            </button>
            <button
              v-if="voiceActive"
              type="button"
              class="toolbar-btn voice-cancel-btn"
              :title="t('chatInput.voiceCancel')"
              :aria-label="t('chatInput.voiceCancel')"
              @mousedown.prevent
              @click.stop.prevent="cancelVoice"
            >
              <X :size="14" />
            </button>
          </template>

          <!-- 发送/停止按钮 -->
          <button
            v-if="showActions"
            class="send-btn"
            :class="{ 'has-content': hasContent, 'is-sending': props.isSending }"
            :disabled="disabled && !props.isSending"
            @click.stop.prevent="handleSendOrStop"
          >
            <ArrowUp v-if="!props.isSending" :size="18" />
            <Square v-else :size="14" />
          </button>
        </div>
      </div>
    </div>

    <!-- Context Toolbar (Project / Git Branch) — code/work/design 模式均显示 -->
    <div class="context-toolbar-row">
      <!-- 宿主可整体替换为受控选择器（定时任务弹窗需要任务级工作空间而非全局项目） -->
      <slot name="context-toolbar">
        <ChatContextToolbar v-if="appStore.projectRoot || appStore.mode === 'work' || appStore.mode === 'design'" />
      </slot>
      <!-- 扩展 slot：design 模式注入 DesignSystemPicker 等，与项目/分支选择器同行 -->
      <slot name="context-extra"></slot>
    </div>

    <!-- 附件菜单弹窗 -->
    <AttachmentMenu
      :visible="showAttachmentMenu"
      :selected-agent="selectedAgent"
      :built-in-agents="builtInAgents"
      :custom-agents="customAgents"
      :show-open-project-action="!!showOpenProjectAction"
      :root-dir="workspaceRootDir"
      @attach-image="handleAttachImage"
      @upload-attachment="handleUploadAttachment"
      @add-workspace-entry="handleWorkspaceEntry"
      @select-agent="selectAgentAndCloseMenu"
      @open-project-folder="handleOpenProjectFolder"
      @close="closeAttachmentMenu"
    />
    
    <!-- 语音识别模型首次安装确认（与设置页共用同一弹窗） -->
    <VoiceModelInstallDialog
      :visible="showVoiceInstallDialog"
      :info="voiceInstallInfo"
      @confirm="confirmVoiceInstall"
      @cancel="showVoiceInstallDialog = false"
    />

    <!-- 拖拽遮罩 -->
    <Transition name="fade">
      <div v-if="isDragging" class="drag-overlay">
        <div class="drag-content">
          <Image :size="48" />
          <span>{{ t('chatInput.dropImageHint') }}</span>
        </div>
      </div>
    </Transition>

    <!-- 图片预览弹窗 -->
    <Teleport to="body">
      <Transition name="image-preview">
        <div v-if="imagePreviewVisible" class="image-preview-overlay" @click="closeImagePreview">
          <img :src="imagePreviewUrl" :alt="imagePreviewName" class="image-preview-img" @click.stop />
          <button class="image-preview-close" @click="closeImagePreview">
            <X :size="20" />
          </button>
          <div class="image-preview-name">{{ imagePreviewName }}</div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onUnmounted, watch, nextTick } from 'vue'
import {
  ArrowUp, Plus, Square, X,
  Loader2, Zap, FolderOpen, Brain,
  Sparkles, Image, Archive, LayoutGrid, AlertTriangle,
  Mic
} from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import ChatContextToolbar from './ChatContextToolbar.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import ContextMenu from './ContextMenu.vue'
import AttachmentMenu from './AttachmentMenu.vue'
import FileAttachmentCard from './FileAttachmentCard.vue'
import { useAppStore, type InputInjectPayload } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import type { PendingMessage } from '@/stores/turn/types'
import { api } from '@/services/electronAPI'
import { useI18n } from 'vue-i18n'
import { useOpenProjectWorkflow } from '@/composables/useOpenProjectWorkflow'
import { useFileToChat } from '@/composables/useFileToChat'
import PermissionModeSelector from './PermissionModeSelector.vue'
import ComposerStatusBar from './ComposerStatusBar.vue'
import ModelPickerMenu from './ModelPickerMenu.vue'
import PendingQueueBar from './PendingQueueBar.vue'
import QuoteAttachmentsBar from './QuoteAttachmentsBar.vue'
import VoiceModelInstallDialog from '@/components/common/VoiceModelInstallDialog.vue'
import VoiceWaveform from './VoiceWaveform.vue'

// ── Composables ──────────────────────────────────────────────────
import { useModelSelector } from '@/composables/useModelSelector'
import { useSlashCommands, type SlashCommand } from '@/composables/useSlashCommands'
import { useContextMenu, navigateContextItems, type ContextItem } from '@/composables/useContextMenu'
import { useContentEditor, getMimeTypeFromFileName, serializeQuoteAttachments } from '@/composables/useContentEditor'
import { usePromptStash } from '@/composables/usePromptStash'
import { useDraftPersistence } from '@/composables/useDraftPersistence'
import { useQuoteAttachments } from '@/composables/useQuoteAttachments'
import { useDragDrop } from '@/composables/useDragDrop'
import { useImageHandler } from '@/composables/useImageHandler'
import { useAgentSelector } from '@/composables/useAgentSelector'
import { useFileAttachments } from '@/composables/useFileAttachments'
import type { WorkspaceEntry } from '@/composables/useWorkspaceBrowser'
import { usePromptOptimizer } from '@/composables/usePromptOptimizer'
import { useVoiceInput } from '@/composables/useVoiceInput'
import { captureCaret, restoreCaret } from '@/lib/voice/caretSnapshot'
import { voiceTargetRegistry } from '@/lib/voice/voiceTargetRegistry'
import type { VoiceInputTarget } from '@/lib/voice/voiceTargetRegistry'
import { buildDictationAppend } from '@/lib/voice/mergeDictation'
import type { VoiceComposerTarget, VoiceSnapshot } from '@/lib/voice/voiceDictation'
import type { VoiceModelInstallInfo } from '@/shared/channels/voice'
import type { ImageAttachment, Attachment, AllAttachments, SendOptions, TextQuoteAttachment } from '@/composables/types'
import type { PermissionMode } from '@/shared/channels/claudeCode'
import type { EffortLevel } from '@/shared/effort'

// Re-export types for backward compatibility (other components import from ChatInput)
export type { ImageAttachment, Attachment, AllAttachments, SendOptions } from '@/composables/types'

// readCommandChips 把 chip 的 DOM 属性读成提交决策的输入
import type { CommandChipData } from '@/lib/message-input-logic'
import { resolveComposerSubmission } from '@/lib/composer-submission'
import type { CommandKind } from '@/lib/constants/commands'

// ── Props & Emits ────────────────────────────────────────────────
const emit = defineEmits<{
  send: [content: string, attachments: AllAttachments, options?: SendOptions]
  'slash-command': [command: string, args: string, attachments: AllAttachments, displayLabel?: string]
  'update:model': [model: string]
  'update:effort': [effort: EffortLevel]
  'update:agent': [agent: string]
  'update:permissionMode': [mode: PermissionMode]
  'open-skills': []
  stop: []
}>()

const props = withDefaults(defineProps<{
  disabled?: boolean
  isSending?: boolean
  placeholder?: string
  modelValue?: string
  workingDirectory?: string
  showOpenProjectAction?: boolean
  /** 本输入框绑定的会话 id；未传时回退全局 currentSessionId */
  sessionId?: string
  /** 紧凑模式（侧边任务）：隐藏依赖全局 sessionContext 单例的悬浮状态栏 */
  compact?: boolean
  /** 'none' = 不读也不写会话草稿。弹窗等临时宿主用它可避免把宿主会话的草稿冲掉 */
  draftScope?: 'session' | 'none'
  /** 受控权限模式：传入时选择器只 emit，不再读写本会话的权限模式 */
  permissionMode?: PermissionMode
  /** false = 不渲染右下角发送/优化提示词按钮（宿主自己提供提交入口时用） */
  showActions?: boolean
  /** false = Enter / Ctrl+Enter 不再触发 send，交回浏览器默认换行 */
  enterSubmits?: boolean
}>(), {
  draftScope: 'session',
  showActions: true,
  enterSubmits: true,
})

// ── Stores ───────────────────────────────────────────────────────
const settingsStore = useSettingsStore()
const appStore = useAppStore()
const sessionStore = useChatSessionStore()
const turnStore = useTurnStore()
const { t } = useI18n()
const { openProjectFromPicker } = useOpenProjectWorkflow()
const { pendingFile, consumePendingFile } = useFileToChat()

// ── Composable instances ─────────────────────────────────────────

// Model selector
const modelSelector = useModelSelector({
  initialModelValue: props.modelValue,
  onUpdateModel: (m) => emit('update:model', m),
  onUpdateEffort: (e) => applyEffort(e),
})
// 下拉的开合、键盘导航与子菜单定位归 ModelPickerMenu；宿主只留初始化与外部受控值
const { selectedModel, initialize: initializeModelSelector } = modelSelector

// Slash commands
const slashCommands = useSlashCommands({
  workingDirectory: () => props.workingDirectory || '',
})
const {
  slashTriggerPosition, slashMenuPosition,
  filteredSlashCommands, showSlashCommandMenu,
  highlightedSlashCommand,
  navigateSlashCommands, closeSlashCommandMenu, openSkillsManager: openSkillsManagerBase,
  triggerSlashMenu,
  commandPalette, iconMap,
} = slashCommands

// Context menu
const contextMenu = useContextMenu({
  workingDirectory: () => props.workingDirectory || '',
})
const {
  showContextMenu, contextSearchQuery,
  highlightedContextItem, contextTriggerPosition, contextMenuPosition,
  isLoadingContext, filteredContextItems,
  loadContextItems, closeContextMenu,
} = contextMenu

// Content editor
const editor = useContentEditor({
  disabled: () => !!props.disabled,
})
const {
  editorRef, containerRef, inputText,
  getEditorPlainText, getTextBeforeCursor, getCursorOffset,
  setCursorToEnd, focusEditor,
  insertMentionChip, insertCommandChip, insertImageChip,
  removeTriggerText, setEditorContent, clearEditor,
  collectMentions, collectAllAttachments, autoResize,
  insertPastedTextWithMarkers,
  hasContent: editorHasContent, handleBackspaceChip,
} = editor

// Prompt stash
const promptStash = usePromptStash()
const { showStashHint } = promptStash

// Drag & drop
const dragDrop = useDragDrop()
const { isDragging } = dragDrop

// Image handler
const imageHandler = useImageHandler()
const { attachedImages, handleImageFile: handleImageFileFromComposable, readLocalImageAsDataUrl, clearImages } = imageHandler

// Agent selector
const agentSelector = useAgentSelector({
  onUpdateAgent: (a) => emit('update:agent', a),
  sessionId: () => props.sessionId,
})
const {
  selectedAgent, builtInAgents, customAgents,
  selectAgent,
} = agentSelector

// Wrapper that also closes attachment menu
function selectAgentAndCloseMenu(agentType: string) {
  selectAgent(agentType)
  closeAttachmentMenu()
}

let agentsLoadPromise: Promise<void> | null = null

function handleAddClickAndLoadAgents() {
  handleAddClick()
  // 只锁在途请求；store 每次都会重新读盘，运行中新增/禁用的定义无需重启即可出现。
  if (agentsLoadPromise) return
  agentsLoadPromise = sessionStore.loadAgents().finally(() => {
    agentsLoadPromise = null
  })
}

// File attachments
const fileAttachments = useFileAttachments({
  workingDirectory: () => props.workingDirectory || '',
  onInsertChip: (name, path, isFolder) => insertMentionChip(name, path, isFolder),
})
const {
  attachedFiles, showAttachmentMenu,
  addFile: addFileAttachment,
  addUploadedFilesFromDialog,
  removeFile: removeAttachment,
  clearFiles, handleAddClick, closeAttachmentMenu,
  handleBrowseFiles: handleBrowseFilesBase,
} = fileAttachments

/** 输入框卡片区只展示上传的文件；工作区文件仍以内联 chip 呈现 */
const uploadedAttachments = computed(() => attachedFiles.value.filter(f => f.source === 'upload'))

async function handleUploadAttachment() {
  closeAttachmentMenu()
  await addUploadedFilesFromDialog()
}

// 工作区文件选择器的根目录
const workspaceRootDir = computed(() => props.workingDirectory || appStore.projectRoot || '')

// 选择器里的搜索框会抢走编辑器选区，插入 chip 前先把光标放回末尾
function handleWorkspaceEntry(entry: WorkspaceEntry) {
  editorRef.value?.focus()
  setCursorToEnd()
  addFileAttachment(entry.relativePath || entry.name, entry.path, entry.isDirectory)
}

// Wrapper that also closes context menu (template compatibility)
function handleBrowseFiles() {
  closeContextMenu()
  handleBrowseFilesBase()
}

// ── Prompt optimizer ────────────────────────────────────────────
const promptOptimizer = usePromptOptimizer()
const { isOptimizing, optimizePrompt: runOptimizePrompt } = promptOptimizer

// ── Quote attachments (selection bar "add to conversation") ─────
const { attachedQuotes, addQuoteAttachment, removeQuoteAttachment, clearQuotes } = useQuoteAttachments()

// ── Voice input ─────────────────────────────────────────────────
const voiceLocked = ref(false)

/** 录音开始时冻结的编辑器：快照 + 写入/恢复都留在这里，状态机不认识 DOM。 */
const voiceTarget: VoiceComposerTarget = {
  captureSnapshot(): VoiceSnapshot {
    const editorEl = editorRef.value
    return {
      html: editorEl?.innerHTML ?? '',
      text: getEditorPlainText(),
      focused: !!editorEl && document.activeElement === editorEl,
      caret: editorEl ? captureCaret(editorEl) : null,
    }
  },
  freeze() {
    voiceLocked.value = true
    editorRef.value?.blur()
  },
  commit(snapshot, finalText) {
    const editorEl = editorRef.value
    if (!editorEl) return
    editorEl.innerHTML = snapshot.html
    const append = buildDictationAppend(snapshot.text, finalText)
    if (append) editorEl.appendChild(document.createTextNode(append))
    voiceLocked.value = false
    inputText.value = getEditorPlainText()
    autoResize()
    nextTick(() => {
      setCursorToEnd()
      focusEditor()
    })
  },
  restore(snapshot) {
    const editorEl = editorRef.value
    if (!editorEl) return
    editorEl.innerHTML = snapshot.html
    voiceLocked.value = false
    inputText.value = getEditorPlainText()
    autoResize()
    nextTick(() => {
      if (snapshot.caret) restoreCaret(editorEl, snapshot.caret)
      if (snapshot.focused) focusEditor()
    })
  },
}

const voice = useVoiceInput({
  target: () => voiceTarget,
  canStart: () => !props.disabled && !props.isSending && !isOptimizing.value,
})
const {
  supported: voiceSupported,
  isActive: voiceActive,
  liveTranscript: voiceLiveTranscript,
  level: voiceLevel,
  hint: voiceHint,
} = voice

/** 录音期间与发送/优化共用同一个可编辑判定。 */
const isEditorEditable = computed(
  () => !isOptimizing.value && !voiceLocked.value && (!props.disabled || !!props.isSending),
)

const showVoiceInstallDialog = ref(false)
const voiceInstallInfo = ref<VoiceModelInstallInfo | null>(null)
let voiceClickBusy = false

/** 本输入框在跨输入框目标注册表里的身份，挂载期间保持不变。 */
const voiceTargetId = crypto.randomUUID()
let unregisterVoiceTarget: (() => void) | null = null

const voiceHintText = computed(() => {
  const current = voiceHint.value
  if (!current) return ''
  switch (current.code) {
    case 'permission-denied':
      return t('chatInput.voicePermissionDenied')
    case 'device-unavailable':
      return t('chatInput.voiceDeviceUnavailable')
    case 'unsupported':
      return t('chatInput.voiceUnsupported')
    case 'sample-rate-mismatch':
      return t('chatInput.voiceSampleRate')
    case 'model-missing':
      return t('chatInput.voiceModelMissing')
    case 'model-corrupted':
      return t('chatInput.voiceModelCorrupted')
    case 'model-busy':
      return t('chatInput.voiceModelBusy')
    case 'engine-failed':
      return t('chatInput.voiceEngineFailed', { message: current.detail ?? '' })
    case 'capture-failed':
      return t('chatInput.voiceCaptureFailed', { message: current.detail ?? '' })
    case 'no-speech':
      return t('chatInput.voiceNoSpeech')
    case 'installing':
      return t('chatInput.voiceInstalling', { percent: Math.round(current.progress ?? 0) })
    case 'install-failed':
      return t('chatInput.voiceInstallFailed', { message: current.detail ?? '' })
    default:
      return ''
  }
})

/**
 * 第一次点击：模型已装则直接录音；未装则弹共用确认框，下载成功后自动开录。
 * 不在这里重试安装：下载中的重复点击只提示"正在安装"。
 * 麦克风按钮与 Alt+V 共用这条启动路径。
 */
async function beginVoiceInput() {
  if (!voiceSupported.value) return
  if (props.disabled || props.isSending || isOptimizing.value) return
  if (voiceClickBusy) return

  voiceClickBusy = true
  try {
    const readiness = await voice.prepare()
    if (readiness === 'ready') {
      await voice.start()
      return
    }
    if (readiness === 'busy') {
      voice.setHint({ kind: 'info', code: 'model-busy' }, 4000)
      return
    }
    if (readiness !== 'needs-install') return

    try {
      voiceInstallInfo.value = await voice.getInstallInfo()
    } catch (error) {
      console.error('[ChatInput] Failed to read voice install info:', error)
      return
    }
    showVoiceInstallDialog.value = true
  } finally {
    voiceClickBusy = false
  }
}

async function handleVoiceClick() {
  if (!voiceSupported.value) return
  if (voiceActive.value) {
    await voice.stop()
    return
  }
  await beginVoiceInput()
}

/** Alt+V 目标：最近聚焦且仍可编辑的输入框由此开始/停止录音。 */
const voiceRegistryTarget: VoiceInputTarget = {
  id: voiceTargetId,
  isEditable: () =>
    voiceSupported.value && !props.disabled && !props.isSending && !isOptimizing.value,
  isRecording: () => voiceActive.value,
  start: beginVoiceInput,
  stop: () => voice.stop(),
}

function handleEditorFocus() {
  voiceTargetRegistry.focus(voiceTargetId)
}

function handleEditorBlur() {
  voiceTargetRegistry.blur(voiceTargetId)
}

async function confirmVoiceInstall() {
  showVoiceInstallDialog.value = false
  if (await voice.install()) await voice.start()
}

function cancelVoice() {
  void voice.cancel()
}

/** 录音期间按 Escape 完整撤销：捕获阶段先于编辑器快捷键生效。 */
function handleVoiceEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !voiceActive.value) return
  event.preventDefault()
  event.stopPropagation()
  void voice.cancel()
}

// ── Per-session draft persistence ───────────────────────────────
const draftPersistence = useDraftPersistence({
  editorRef,
  getEditorPlainText,
  setEditorContent,
  clearEditor,
  autoResize,
  focusEditor,
  inputText,
  attachedFiles,
  attachedImages,
  attachedQuotes,
  draftScope: () => props.draftScope,
})
const { editorSessionId, saveDraftForSession, loadDraftForSession, restoreStashData } = draftPersistence

// ── Local state (not extracted) ──────────────────────────────────
const showSteerHint = ref(false)
const thinkingHint = ref<{ text: string; isError: boolean } | null>(null)
const thinkingEnabled = ref(settingsStore.thinkingEnabled)
const contextMenuRef = ref<InstanceType<typeof ContextMenu> | null>(null)

// ── Image preview state ─────────────────────────────────────────
const imagePreviewVisible = ref(false)
const imagePreviewUrl = ref('')
const imagePreviewName = ref('')

function closeImagePreview() {
  imagePreviewVisible.value = false
}

// ── Computed ─────────────────────────────────────────────────────
const hasContent = computed(() => editorHasContent(attachedFiles.value, attachedImages.value) || attachedQuotes.value.length > 0)

const currentPendingMessages = computed(() => {
  const sid = editorSessionId.value
  if (!sid) return []
  return turnStore.getPendingMessages(sid)
})

// ── Pending Messages ─────────────────────────────────────────────
// 全部按 editorSessionId（本输入框绑定的会话）寻址，而非全局 currentSessionId：
// 分屏与侧边任务会同时存在多个 ChatInput 实例，用全局 id 会串到别的会话。

/** 排队消息摊回编辑器：召回按钮与空输入框按 ↑ 共用这一份恢复逻辑 */
function applyPendingSnapshot(msg: PendingMessage) {
  inputText.value = msg.content
  if (editorRef.value) {
    editorRef.value.innerText = msg.content
  }
  attachedFiles.value = msg.attachments.map(f => ({ ...f }))
  attachedImages.value = msg.images.map(img => ({ ...img }))
  nextTick(() => focusEditor())
}

function recallPendingMsg(msgId: string) {
  const sid = editorSessionId.value
  if (!sid) return
  const recalled = turnStore.recallPendingMessage(sid, msgId)
  if (recalled) applyPendingSnapshot(recalled)
}

function removePendingMsg(msgId: string) {
  const sid = editorSessionId.value
  if (sid) turnStore.removePendingMessage(sid, msgId)
}

function sendPendingNow(msgId: string) {
  const sid = editorSessionId.value
  if (!sid) return
  const recalled = turnStore.recallPendingMessage(sid, msgId)
  if (!recalled) return
  const allAttachments = collectAllAttachments(
    recalled.attachments.map(f => ({ ...f })),
    recalled.images.map(img => ({ ...img })),
  )
  emit('send', recalled.content, allAttachments)
}

// ── Thinking toggle ──────────────────────────────────────────────
let thinkingHintTimer: ReturnType<typeof setTimeout> | undefined

function flashThinkingHint(text: string, isError: boolean) {
  thinkingHint.value = { text, isError }
  if (thinkingHintTimer) clearTimeout(thinkingHintTimer)
  thinkingHintTimer = setTimeout(() => { thinkingHint.value = null }, isError ? 4000 : 2500)
}

/**
 * 把开关退回用户点击前的状态。
 *
 * 只在"用户眼前还是这次要点的那个选择"时回退：期间又点过一次就别盖掉后来的决定。
 * 回退要再落一次盘 —— localStorage 在上一次保存时已经写过新值，不重写的话刷新又回到没生效的状态。
 */
async function revertThinking(from: boolean) {
  if (thinkingEnabled.value !== from) return
  thinkingEnabled.value = !from
  settingsStore.thinkingEnabled = thinkingEnabled.value
  const rolled = await settingsStore.saveSettings()
  // 回滚期间的二次失败比原始失败次要：只记日志，不拿它盖掉真正的失败原因。
  if (!rolled.success) console.error('[ChatInput] Failed to roll back thinking setting:', rolled.error)
}

async function toggleThinking() {
  thinkingEnabled.value = !thinkingEnabled.value
  settingsStore.thinkingEnabled = thinkingEnabled.value
  const intent = thinkingEnabled.value

  // 两条都要等：主进程的配置（代理对齐在它后面）和正在跑的引擎会话。
  // 等还不够，结果必须读 —— 任何一边没落地都要把开关退回去，界面不能停在"看着已开"。
  const saved = await settingsStore.saveSettings()
  if (!saved.success) {
    await revertThinking(intent)
    flashThinkingHint(t('chatInput.thinkingSaveFailed'), true)
    return
  }

  const sid = editorSessionId.value
  let appliesLater = false
  if (sid) {
    // --thinking 只在进程 spawn 时读一次：本轮进行中时不打断，进程会在本轮结束后
    // 挂起、下一条消息以新参数恢复。以引擎的答复为准，而不是自己猜会话是否忙。
    try {
      appliesLater = (await api.updateThinkingLevel(sid, intent)) === 'next-turn'
    } catch (err) {
      console.error('[ChatInput] updateThinkingLevel failed:', err)
      await revertThinking(intent)
      flashThinkingHint(t('chatInput.thinkingApplyFailed'), true)
      return
    }
  }

  // 一个提示槽位，失败/告警优先于"下一轮生效"这种信息：配置落盘了但代理没对齐，
  // 用户更该知道的是前者。
  if (saved.proxyState === 'failed') {
    flashThinkingHint(t('chatInput.thinkingProxyFailed'), true)
  } else if (appliesLater) {
    flashThinkingHint(t('chatInput.thinkingAppliesNextTurn'), false)
  }
}

/**
 * 推理深度走与思考开关同一条下发链：先让父级落配置，再问引擎什么时候生效。
 *
 * 引擎没接住就退回原档位 —— CLI 对认不出的档位只 warn 一句然后照旧退 0，
 * 界面从退出码什么都拿不到，所以只能以这里的 reject 为凭。
 */
async function applyEffort(level: EffortLevel) {
  const previous = modelSelector.selectedMode.value
  emit('update:effort', level)

  const sid = editorSessionId.value
  if (!sid) return
  try {
    if ((await api.updateEffortLevel(sid, level)) === 'next-turn') {
      flashThinkingHint(t('chatInput.effortAppliesNextTurn'), false)
    }
  } catch (err) {
    console.error('[ChatInput] updateEffortLevel failed:', err)
    if (previous && previous !== level) {
      modelSelector.selectedMode.value = previous
      emit('update:effort', previous)
    }
    flashThinkingHint(t('chatInput.effortApplyFailed'), true)
  }
}

// ── Workbench injection ──────────────────────────────────────────
function injectFromWorkbench(payload: InputInjectPayload) {
  if (payload.image) {
    const img: ImageAttachment = { ...payload.image, type: 'image' }
    attachedImages.value.push(img)
    editorRef.value?.focus()
    insertImageChip(img)
  }
  if (payload.quote) {
    addQuoteAttachment(payload.quote)
  }
  if (payload.text) {
    const editorEl = editorRef.value
    if (editorEl) {
      editorEl.focus()
      if (payload.replace) {
        // 快捷 prompt 磁贴语义: 替换输入框已有文本, 避免多次点击内容叠加
        clearEditor()
      } else {
        const prefix = editorEl.textContent && !editorEl.textContent.endsWith('\n') ? '\n' : ''
        editorEl.appendChild(document.createTextNode(prefix))
      }
      editorEl.appendChild(document.createTextNode(payload.text))
      inputText.value = getEditorPlainText()
      setCursorToEnd()
      autoResize()
    }
  }
}

// ── Menu position updaters ───────────────────────────────────────
function updateSlashMenuPosition() {
  const container = containerRef.value
  const editorEl = editorRef.value
  if (!container || !editorEl) return

  const containerRect = container.getBoundingClientRect()
  const editorRect = editorEl.getBoundingClientRect()

  slashMenuPosition.value = {
    bottom: `${window.innerHeight - editorRect.top + 8}px`,
    left: `${containerRect.left}px`
  }
}

function updateContextMenuPosition() {
  const container = containerRef.value
  const editorEl = editorRef.value
  if (!container || !editorEl) return

  const containerRect = container.getBoundingClientRect()
  const editorRect = editorEl.getBoundingClientRect()

  contextMenuPosition.value = {
    bottom: `${window.innerHeight - editorRect.top + 8}px`,
    left: `${containerRect.left}px`
  }
}

// ── Editor event handlers (orchestration) ────────────────────────
function handleEditorInput() {
  inputText.value = getEditorPlainText()
  autoResize()
  checkSlashTrigger()
  checkContextTrigger()
}

function checkSlashTrigger() {
  const editorEl = editorRef.value
  if (!editorEl) return

  const textBeforeCursor = getTextBeforeCursor()
  const lastNewLine = textBeforeCursor.lastIndexOf('\n')
  const textAfterLastNewLine = textBeforeCursor.slice(lastNewLine + 1)

  const slashMatch = textAfterLastNewLine.match(/^\/([\w:-]*)$/)

  if (slashMatch && !showContextMenu.value) {
    slashTriggerPosition.value = lastNewLine + 1
    void triggerSlashMenu(slashMatch[1] || '')

    nextTick(() => {
      updateSlashMenuPosition()
      editorRef.value?.focus()
    })
  } else if (!textAfterLastNewLine.startsWith('/')) {
    commandPalette.closeMenu()
  } else if (commandPalette.showMenu.value) {
    commandPalette.updateSearch(textAfterLastNewLine.slice(1))
  }
}

function checkContextTrigger() {
  const editorEl = editorRef.value
  if (!editorEl) return

  const textBeforeCursor = getTextBeforeCursor()

  const lastAtIndex = textBeforeCursor.lastIndexOf('@')
  if (lastAtIndex === -1) {
    closeContextMenu()
    return
  }

  const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
  const hasInvalidChar = /[\s\n]/.test(textAfterAt)

  if (hasInvalidChar || commandPalette.showMenu.value) {
    closeContextMenu()
    return
  }

  const wasClosed = !showContextMenu.value
  const previousQuery = contextSearchQuery.value
  contextTriggerPosition.value = lastAtIndex
  showContextMenu.value = true
  contextSearchQuery.value = textAfterAt

  if (wasClosed || textAfterAt !== previousQuery) {
    loadContextItems()
  }

  nextTick(() => {
    updateContextMenuPosition()
    editorRef.value?.focus()
  })
}

function handleEditorKeydown(event: KeyboardEvent) {
  // 录音期间编辑器只读：不响应任何编辑或提交快捷键；Escape 由全局捕获监听取消。
  if (voiceActive.value) {
    event.preventDefault()
    return
  }

  if (commandPalette.showMenu.value) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        navigateSlashCommands(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        navigateSlashCommands(-1)
        return
      case 'Enter':
      case 'Tab':
        event.preventDefault()
        event.stopPropagation()
        const editorCmd = commandPalette.getSelectedCommand()
        if (editorCmd) {
          const slashCmd: SlashCommand = {
            name: editorCmd.name,
            description: editorCmd.description,
            icon: (editorCmd.icon && iconMap[editorCmd.icon]) || Zap,
            kind: editorCmd.kind,
            immediate: editorCmd.immediate,
            aliases: editorCmd.aliases,
            source: editorCmd.source,
          }
          selectSlashCommand(slashCmd)
        }
        return
      case 'Escape':
        event.preventDefault()
        commandPalette.closeMenu()
        return
    }
  }

  if (showContextMenu.value) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveContextHighlight(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        moveContextHighlight(-1)
        return
      case 'Enter':
      case 'Tab':
        event.preventDefault()
        event.stopPropagation()
        const item = filteredContextItems.value.find(i => i.path === highlightedContextItem.value)
        if (item) {
          selectContextItem(item)
        }
        return
      case 'Escape':
        event.preventDefault()
        closeContextMenu()
        return
    }
  }

  // Ctrl+S / Cmd+S: Stash prompt
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    event.stopPropagation()
    handleStash()
    return
  }

  // Ctrl+Enter / Cmd+Enter: steering
  if (props.enterSubmits && event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
    event.preventDefault()
    handleSend(true)
    return
  }

  // Enter without Shift = send
  if (props.enterSubmits && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend(false)
    return
  }

  // ArrowUp: recall pending message when empty
  if (event.key === 'ArrowUp' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    const sid = editorSessionId.value
    const pending = sid ? turnStore.getPendingMessages(sid) : []
    if (sid && pending.length > 0 && !getEditorPlainText().trim()) {
      event.preventDefault()
      const recalled = turnStore.recallPendingMessage(sid, pending[pending.length - 1].id)
      if (recalled) applyPendingSnapshot(recalled)
    }
  }

  // Backspace: delete whole chip if cursor is right after it
  if (event.key === 'Backspace') {
    const result = handleBackspaceChip(event)
    if (result.deleted && result.type === 'mention') {
      if (result.path) {
        const idx = attachedFiles.value.findIndex(f => f.path === result.path)
        if (idx >= 0) attachedFiles.value.splice(idx, 1)
      }
      if (result.imageId) {
        const idx = attachedImages.value.findIndex(img => img.id === result.imageId)
        if (idx >= 0) attachedImages.value.splice(idx, 1)
      }
    }
  }
}

function handleEditorPaste(e: ClipboardEvent) {
  e.preventDefault()

  const items = e.clipboardData?.items
  if (items) {
    let hasImage = false

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        hasImage = true
        const file = item.getAsFile()
        if (file) {
          handleImageFileFromComposable(file, (image) => insertImageChip(image))
        }
      }
    }

    if (!hasImage) {
      const text = e.clipboardData?.getData('text/plain') || ''
      insertPastedTextWithMarkers(text)
    }
  } else {
    const text = e.clipboardData?.getData('text/plain') || ''
    insertPastedTextWithMarkers(text)
  }
}

function handleEditorClick() {
  setTimeout(() => {
    checkSlashTrigger()
    checkContextTrigger()
  }, 0)
}

// ── Slash command selection (orchestration) ──────────────────────
function selectSlashCommand(cmd: SlashCommand) {
  if (cmd.immediate || cmd.kind === 'immediate') {
    commandPalette.closeMenu()
    clearEditor()
    const attachments = collectAllAttachments(attachedFiles.value, attachedImages.value)
    emit('slash-command', cmd.name, '', attachments)
    return
  }

  commandPalette.closeMenu()

  const editorEl = editorRef.value
  if (editorEl) {
    const text = getEditorPlainText()
    const slashMatch = text.match(/(^|\s)\/([^\s]*)$/)
    if (slashMatch) {
      const triggerOffset = slashMatch.index! + (slashMatch[1] ? 1 : 0)
      removeTriggerText(triggerOffset, slashMatch[0].length - (slashMatch[1] ? 1 : 0))
    }
  }

  insertCommandChip({
    name: cmd.name,
    kind: cmd.kind || 'slash_command',
    source: (cmd as any).source || 'builtin',
  })

  nextTick(() => {
    editorRef.value?.focus()
    setCursorToEnd()
    autoResize()
  })
}

// ── Context item selection (orchestration) ───────────────────────
function selectContextItem(item: ContextItem) {
  const editorEl = editorRef.value
  if (!editorEl) return

  removeTriggerText(contextTriggerPosition.value, contextSearchQuery.value.length + 1)

  closeContextMenu()

  insertMentionChip(item.relativePath || item.name, item.path, item.type === 'directory')

  if (!attachedFiles.value.some(f => f.path === item.path)) {
    attachedFiles.value.push({
      name: item.relativePath || item.name,
      path: item.path,
      isFolder: item.type === 'directory'
    })
  }

  nextTick(() => {
    editorRef.value?.focus()
    setCursorToEnd()
  })
}

// 高亮位移动作：下标运算复用 useContextMenu 的纯函数，这里只管 DOM 滚动
function moveContextHighlight(direction: number) {
  const next = navigateContextItems(
    filteredContextItems.value,
    highlightedContextItem.value,
    direction,
  )
  if (!next) return

  highlightedContextItem.value = next

  nextTick(() => {
    const listEl = contextMenuRef.value?.listRef
    listEl?.querySelector('.highlighted')?.scrollIntoView({ block: 'nearest' })
  })
}

// ── Clear search helpers ─────────────────────────────────────────
function clearSlashSearch() {
  const queryLen = commandPalette.searchQuery.value.length
  commandPalette.updateSearch('')
  if (slashTriggerPosition.value >= 0) {
    removeTriggerText(slashTriggerPosition.value, queryLen + 1)
    inputText.value = getEditorPlainText()
    editorRef.value?.focus()
  }
}

// Clear context search - wrapper that also removes trigger text from editor
function clearContextSearch() {
  const { queryLen, triggerPosition } = contextMenu.clearContextSearch()
  if (triggerPosition >= 0) {
    removeTriggerText(triggerPosition, queryLen + 1)
    inputText.value = getEditorPlainText()
    editorRef.value?.focus()
  }
}

// ── Open skills manager ──────────────────────────────────────────
function openSkillsManager() {
  openSkillsManagerBase()
  emit('open-skills')
}

// ── Prompt optimization ──────────────────────────────────────────
async function handleOptimizePrompt() {
  const prompt = getEditorPlainText().trim()
  if (!prompt || isOptimizing.value || voiceActive.value) return

  const result = await runOptimizePrompt(prompt, {
    workingDirectory: props.workingDirectory,
  })

  if (result.success && result.result) {
    setEditorContent(result.result)
    autoResize()
  }
}

// ── Send logic (orchestration) ───────────────────────────────────
function handleSendOrStop() {
  if (props.isSending) {
    emit('stop')
    return
  }
  handleSend()
}

/** 编辑器里的 command chip DOM → 决策需要的数据（DOM 读取只留在这里） */
function readCommandChips(): CommandChipData[] {
  const editorEl = editorRef.value
  if (!editorEl) return []
  return Array.from(editorEl.querySelectorAll('.command-chip')).map((el) => ({
    command: el.getAttribute('data-command') || '',
    label: (el.getAttribute('data-command') || '').replace(/^\//, ''),
    kind: (el.getAttribute('data-kind') || 'slash_command') as CommandKind,
    source: el.getAttribute('data-source') || 'builtin',
  }))
}

function handleSend(steerMode = false) {
  // 录音中草稿只读：此时提交会把尚未收口的转写留在编辑器里。
  if (isOptimizing.value || voiceActive.value) return

  const decision = resolveComposerSubmission({
    content: getEditorPlainText().trim(),
    quoteBlock: serializeQuoteAttachments(attachedQuotes.value),
    attachments: collectAllAttachments(attachedFiles.value, attachedImages.value),
    chips: readCommandChips(),
    isSending: !!props.isSending,
    steerMode,
    disabled: !!props.disabled,
    menuOpen: commandPalette.showMenu.value || showContextMenu.value,
    hasContent: hasContent.value,
    sessionId: editorSessionId.value,
  })

  switch (decision.kind) {
    case 'none':
      return
    case 'send':
      // emit 元数与抽取前一致：不带 options 的发送不会多出一个 undefined
      if (decision.options) emit('send', decision.content, decision.attachments, decision.options)
      else emit('send', decision.content, decision.attachments)
      break
    case 'slash':
      if (decision.displayLabel === undefined) {
        emit('slash-command', decision.command, decision.args, decision.attachments)
      } else {
        emit('slash-command', decision.command, decision.args, decision.attachments, decision.displayLabel)
      }
      break
    case 'queue': {
      const sid = editorSessionId.value
      if (!sid) return
      turnStore.addPendingMessage(sid, {
        id: crypto.randomUUID(),
        content: decision.content,
        attachments: decision.attachments.files.map(f => ({ ...f })),
        images: decision.attachments.images.map(img => ({ ...img })),
        displayLabel: decision.displayLabel,
        priority: 'later',
        createdAt: Date.now(),
      })
      break
    }
  }

  // 无论走哪条分支，编辑器与附件都要交还给宿主：发送即清空。
  clearEditor()
  attachedFiles.value = []
  clearImages()
  clearQuotes()
}

// ── Prompt Stash (orchestration) ─────────────────────────────────
function handleStash() {
  promptStash.handleStash(
    getEditorPlainText().trim(),
    attachedFiles.value,
    attachedImages.value,
    editorRef.value?.innerHTML || '',
    () => { clearEditor(); attachedFiles.value = []; clearImages(); clearQuotes() },
    () => restoreStashLocal(),
    attachedQuotes.value
  )
}

function restoreStashLocal() {
  promptStash.restoreStash(
    editorRef.value,
    (files) => { attachedFiles.value = files },
    (images) => { attachedImages.value = images },
    (text) => { inputText.value = text },
    () => focusEditor(),
    (quotes) => { attachedQuotes.value = quotes }
  )
}

// ── Drag & drop (orchestration) ──────────────────────────────────
function handleDragEnter(e: DragEvent) {
  dragDrop.handleDragEnter(e)
}

function handleDragOver(e: DragEvent) {
  dragDrop.handleDragOver(e)
}

function handleDragLeave(e: DragEvent) {
  dragDrop.handleDragLeave(e, (containerRef.value as HTMLElement).getBoundingClientRect())
}

function handleDrop(e: DragEvent) {
  const data = dragDrop.handleDrop(e)
  if (!data) return

  if (data.type === 'tree-path') {
    if (!attachedFiles.value.some(f => f.path === data.path)) {
      attachedFiles.value.push({
        name: data.name,
        path: data.path,
        isFolder: data.isFolder
      })
      insertMentionChip(data.name, data.path, data.isFolder)
    }
  }

  if (data.type === 'image-files') {
    for (const file of data.files) {
      // Convert the plain object back to a File for handleImageFile
      // Since drag events give us real File objects, we need to get them from the original event
      const realFiles = Array.from(e.dataTransfer?.files || [])
      for (const realFile of realFiles) {
        if (realFile.type.startsWith('image/')) {
          handleImageFileFromComposable(realFile, (image) => insertImageChip(image))
        }
      }
    }
  }
}

// ── File attachment actions ──────────────────────────────────────
async function handleAttachImage() {
  closeAttachmentMenu()
  try {
    const result = await api.selectFiles()
    if (!result.canceled && result.filePaths.length > 0) {
      for (const filePath of result.filePaths) {
        const name = filePath.split(/[\\/]/).pop() || filePath
        try {
          const dataUrl = await readLocalImageAsDataUrl(filePath)
          const mimeType = getMimeTypeFromFileName(filePath)
          const imageAttachment: ImageAttachment = {
            id: crypto.randomUUID(),
            name,
            type: 'image',
            mimeType,
            previewUrl: dataUrl,
            data: dataUrl
          }
          attachedImages.value.push(imageAttachment)
          insertImageChip(imageAttachment)
        } catch (error) {
          console.error('Failed to read local image:', error)
        }
      }
    }
  } catch (error) {
    console.error('Failed to select images:', error)
  }
}

async function handleOpenProjectFolder() {
  closeAttachmentMenu()
  await openProjectFromPicker()
}

// ── Lifecycle & Watchers ─────────────────────────────────────────
function handleChipImagePreview(e: Event) {
  const detail = (e as CustomEvent).detail as { url: string; name: string }
  if (detail) {
    imagePreviewUrl.value = detail.url
    imagePreviewName.value = detail.name
    imagePreviewVisible.value = true
  }
}

onMounted(() => {
  initializeModelSelector(props.modelValue)

  unregisterVoiceTarget = voiceTargetRegistry.register(voiceRegistryTarget)

  window.addEventListener('session-created', focusEditor)
  window.addEventListener('chip-image-preview', handleChipImagePreview as EventListener)
  window.addEventListener('keydown', handleVoiceEscape, true)

  // 挂载即恢复本会话草稿（例如从设置页返回时组件被重新挂载）
  editorSessionId.value = props.sessionId ?? sessionStore.currentSessionId
  nextTick(() => {
    loadDraftForSession(editorSessionId.value)
    // 目标会话刚挂载时就绪前，注入载荷一直留在 store 里，这里补取一次
    tryConsumePendingInjection()
  })
})

onUnmounted(() => {
  unregisterVoiceTarget?.()
  unregisterVoiceTarget = null
  window.removeEventListener('session-created', focusEditor)
  window.removeEventListener('chip-image-preview', handleChipImagePreview as EventListener)
  window.removeEventListener('keydown', handleVoiceEscape, true)
  if (thinkingHintTimer) clearTimeout(thinkingHintTimer)
})

// Before the DOM is torn down (e.g. when navigating to settings), stash the
// editor content under the session it belongs to (NOT the global current —
// that may already point elsewhere). onBeforeUnmount runs while the DOM is
// still intact, so editorRef.value and its innerHTML are still available.
onBeforeUnmount(() => {
  // 卸载前先撤销录音：状态机会同步恢复快照，随后保存的草稿才是录音前的样子。
  voice.dispose()
  saveDraftForSession(editorSessionId.value)
})

// Watch external modelValue changes
watch(() => props.modelValue, (newValue) => {
  if (newValue && newValue !== selectedModel.value) {
    selectedModel.value = newValue
  }
})

// Watch workbench injection
// 分屏 / 侧边任务会同时存在多个 ChatInput 实例：带 targetSessionId 的载荷只由绑定
// 该会话的实例消费，其余实例留它在 store 里等目标实例挂载后自取（见 onMounted）。
function tryConsumePendingInjection() {
  const payload = appStore.pendingInputInjection
  if (!payload) return
  if (payload.targetSessionId && payload.targetSessionId !== editorSessionId.value) return
  const owned = appStore.consumeInputInjection()
  if (owned) injectFromWorkbench(owned)
}

watch(() => appStore.pendingInputInjection, tryConsumePendingInjection)

// Watch pending input text (rollback restore)
watch(() => sessionStore.pendingInputText, (newText) => {
  if (newText && newText.trim()) {
    inputText.value = newText
    nextTick(() => {
      if (editorRef.value) {
        editorRef.value.innerHTML = newText.replace(/\n/g, '<br>')
      }
      editorRef.value?.focus()
    })
    sessionStore.clearPendingInputText()
  }
})

// Watch session changes: save the outgoing session's draft, then load the
// incoming session's draft (or clear the editor so content never leaks
// across sessions). Component is NOT remounted on session switch in
// single-pane mode, so this watcher is the only save/restore point.
watch(() => props.sessionId ?? sessionStore.currentSessionId, (newSid) => {
  if ((newSid ?? null) === (editorSessionId.value ?? null)) return
  // 会话变了：录音必须立刻作废，快照恢复后再保存旧会话草稿。
  if (voiceActive.value) void voice.cancel()
  saveDraftForSession(editorSessionId.value)
  editorSessionId.value = newSid ?? null
  focusEditor()
  nextTick(() => loadDraftForSession(editorSessionId.value))
})

// 录音期间输入框被禁用/进入发送或优化状态：取消录音，避免只读状态里残留转写。
watch([() => props.disabled, () => props.isSending, isOptimizing], ([disabled, sending, optimizing]) => {
  if (!voiceActive.value) return
  if (disabled || sending || optimizing) void voice.cancel()
})

// Watch for files added from file tree context menu
watch(pendingFile, (file) => {
  if (!file) return

  insertMentionChip(file.name, file.path, file.isFolder)

  if (!attachedFiles.value.some(f => f.path === file.path)) {
    attachedFiles.value.push({
      name: file.name,
      path: file.path,
      isFolder: file.isFolder
    })
  }

  consumePendingFile()

  nextTick(() => {
    focusEditor()
  })
})

// ── 宿主直读/直写编辑器（定时任务弹窗把内容存成任务字段而非发消息） ──
function getContent(): { text: string; attachments: AllAttachments } {
  const content = getEditorPlainText().trim()
  const quoteBlock = serializeQuoteAttachments(attachedQuotes.value)
  return {
    text: quoteBlock ? (content ? `${quoteBlock}\n\n${content}` : quoteBlock) : content,
    attachments: collectAllAttachments(attachedFiles.value, attachedImages.value),
  }
}

function setContent(text: string) {
  clearEditor()
  setEditorContent(text)
  nextTick(() => autoResize())
}

defineExpose({ getContent, setContent, focus: focusEditor })
</script>

<style lang="scss" scoped>
@use "@/styles/composer-toolbar" as *;
@use "@/styles/composer-chips" as *;

.chat-input-container {
  padding: 16px 20px 20px;
  background: var(--bg-primary);
  flex-shrink: 0;
  flex-grow: 0;
  position: relative;
  border-top: 1px solid var(--surface-border);
  container-type: inline-size;
}

.context-toolbar-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.input-wrapper {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border: 1px solid var(--surface-border);
  border-radius: 20px;
  background: var(--bg-primary);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  position: relative;

  &:focus-within {
    border-color: var(--surface-border-strong);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  }

  &.is-sending {
    // 工具栏内的下拉是后代节点，祖先 opacity 会连整棵子树一起合成，
    // 面板压不到 1 就会透出底下的聊天流 —— 压暗只针对内容区，不含工具栏
    > :not(.composer-status-bar):not(.input-toolbar) {
      opacity: 0.8;
    }
  }

  &.is-optimizing {
    border-color: color-mix(in srgb, var(--accent-secondary) 45%, transparent);
    box-shadow: 0 0 0 3px var(--accent-secondary-glow);

    .inline-editor {
      opacity: 0.55;
      filter: saturate(0.7);
      caret-color: transparent;
      user-select: none;
    }
  }
}

// 提示词优化扫光层
.optimize-shimmer {
  position: absolute;
  inset: -4px -8px;
  border-radius: var(--radius-md);
  pointer-events: none;
  overflow: hidden;
  z-index: 1;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      110deg,
      transparent 0%,
      transparent 35%,
      color-mix(in srgb, var(--accent-secondary) 18%, transparent) 50%,
      rgba(168, 85, 247, 0.14) 55%,
      transparent 70%,
      transparent 100%
    );
    background-size: 220% 100%;
    background-repeat: no-repeat;
    animation: optimize-shimmer-sweep 1.5s ease-in-out infinite;
  }
}

@keyframes optimize-shimmer-sweep {
  0% {
    background-position: 120% 0;
  }
  100% {
    background-position: -120% 0;
  }
}

// Stash 提示浮层
.stash-hint {
  position: absolute;
  top: -30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: var(--accent-primary);
  color: white;
  font-size: var(--text-sm);
  font-weight: 500;
  border-radius: var(--radius-md);
  white-space: nowrap;
  z-index: 10;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.stash-fade-enter-active,
.stash-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.stash-fade-enter-from,
.stash-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
}

// Steering 提示浮层
.steer-hint {
  position: absolute;
  top: -30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: #f59e0b;
  color: white;
  font-size: var(--text-sm);
  font-weight: 500;
  border-radius: var(--radius-md);
  white-space: nowrap;
  z-index: 10;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

// 开关没能生效时的同位提示：红底，避免用户把"点了"当成"生效了"
.steer-hint-error {
  background: var(--error);
}

// 语音输入提示：权限指引可能较长，作为输入区内的横条而不是浮层
.voice-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.5;

  &.is-error {
    background: var(--error-glow);
    border: 1px solid var(--error);
    color: var(--text-primary);

    .voice-hint-icon {
      color: var(--error);
    }
  }
}

.voice-hint-icon {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--text-muted);
}

.voice-hint-text {
  white-space: pre-wrap;
}

// 提示词优化进行中文字提示
.optimize-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  line-height: 1;
  color: #6366f1;
  background: var(--accent-secondary-glow);
  border: 1px solid color-mix(in srgb, var(--accent-secondary) 18%, transparent);
  white-space: nowrap;
  user-select: none;

  .optimize-hint-icon {
    animation: optimize-hint-pulse 1.6s ease-in-out infinite;
  }

  .optimize-hint-label {
    font-weight: 500;
  }

  .optimize-hint-dots {
    display: inline-flex;
    gap: 2px;
    margin-left: 2px;

    span {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.4;
      animation: optimize-hint-dot 1.2s ease-in-out infinite;

      &:nth-child(2) { animation-delay: 0.2s; }
      &:nth-child(3) { animation-delay: 0.4s; }
    }
  }
}

@keyframes optimize-hint-pulse {
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50%      { transform: scale(1.15); opacity: 1; }
}

@keyframes optimize-hint-dot {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40%           { opacity: 1;    transform: translateY(-2px); }
}

.optimize-hint-enter-active,
.optimize-hint-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.optimize-hint-enter-from,
.optimize-hint-leave-to {
  opacity: 0;
  transform: translateY(2px);
}

// 文本输入区域
.composer-file-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 10px;
}

.textarea-wrapper {
  position: relative;
  flex: 1;
  min-height: 24px;
  margin-bottom: 12px;
  cursor: text;

  .inline-editor {
    width: 100%;
    min-height: 24px;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--text-base-plus);
    line-height: var(--leading-relaxed);
    max-height: 200px;
    padding: 0;
    overflow-y: auto;
    @include scrollbar-overlay;
    word-wrap: break-word;
    white-space: pre-wrap;

    &:empty::before {
      content: attr(data-placeholder);
      color: var(--text-muted);
      pointer-events: none;
    }

    @include composer-chips;
  }

  // 空草稿录音时整行让位：实时转写顶到第一行，否则会被空编辑器的 24px 行高压下来。
  // 用 display 而非 min-height —— autoResize 写在内联 style 上的 height 压不过。
  .input-wrapper.is-voice-active & .inline-editor:empty {
    display: none;
  }

  // 实时转写是暂定内容：与正式草稿同一排版，但不进入编辑器 DOM。
  .voice-live-transcript {
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--text-secondary);
    font-size: var(--text-base-plus);
    line-height: var(--leading-relaxed);
    user-select: none;
    pointer-events: none;
  }
}

// 拖拽遮罩样式
.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(34, 197, 94, 0.1);
  border: 2px dashed rgba(34, 197, 94, 0.5);
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  pointer-events: none;

  .drag-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: #22c55e;
    font-size: var(--text-lg);
    font-weight: 500;
  }
}

// fade 过渡动画
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

// 底部工具栏 - 背景透明与输入框一致
.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: transparent;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  background: transparent;
}

// Work 模式工具栏 chip：目录 / 画廊入口
.work-context-chip {
  gap: 5px;
  padding: 6px 10px;
  font-size: var(--text-sm);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--surface-glass);
  max-width: 180px;

  .chip-label {
    @include truncate;
    flex-shrink: 1;
    min-width: 0;
  }

  &:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: var(--surface-glass-hover);
  }

  &.set {
    color: var(--accent-primary);
    border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
  }
}

.add-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  @include flex-center;
  color: var(--text-secondary);
  background: transparent;

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
}

.thinking-toggle-wrapper {
  display: flex;
  align-items: center;
  gap: 2px;

  .thinking-btn {
    &.active {
      color: var(--accent-primary);
      background: rgba(var(--accent-primary-rgb), 0.1);
    }
  }
}

// 语音输入：录音中变为浅红底的停止方块，波形紧挨在左侧
.voice-waveform-slot {
  flex: 0 1 auto;
  max-width: 140px;
}

.voice-btn {
  width: 32px;
  height: 32px;
  padding: 0;
  @include flex-center;
  color: var(--text-secondary);

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  &.is-recording {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 12%, transparent);

    &:hover {
      color: var(--error);
      background: color-mix(in srgb, var(--error) 18%, transparent);
    }
  }
}

.voice-stop-square {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  background: currentColor;
}

.voice-cancel-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  @include flex-center;
  color: var(--text-muted);

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
}

// 发送按钮
.send-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #e5e5e5;
  color: #737373;
  @include flex-center;
  flex-shrink: 0;
  transition: all 0.2s ease;

  // 没有内容时 - 浅灰色
  &:not(.has-content) {
    background: #e5e5e5;
    color: #737373;
  }

  // 有内容时 - 黑色
  &.has-content:not(:disabled) {
    background: #171717;
    color: #ffffff;

    &:hover {
      background: #404040;
    }
  }

  // 发送中状态 - 黑色背景带方块图标
  &.is-sending {
    background: #171717 !important;
    color: #ffffff !important;
    cursor: default;
  }

  &:disabled:not(.is-sending) {
    background: #e5e5e5;
    color: #a3a3a3;
    cursor: not-allowed;
  }
}

// 优化提示词按钮
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
}

.optimize-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: transparent;
  color: #a3a3a3;
  @include flex-center;
  flex-shrink: 0;
  transition: all 0.2s ease;

  &:not(:disabled) {
    color: #525252;

    &:hover {
      background: rgba(0, 0, 0, 0.05);
      color: #171717;
    }
  }

  &.is-optimizing {
    color: #525252;
  }

  &:disabled {
    color: #d4d4d4;
    cursor: not-allowed;
  }

  .spin {
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}


</style>

<style lang="scss">
/* 图片预览弹窗（Teleport 到 body，需要非 scoped 样式） */
.image-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  cursor: zoom-out;
  gap: 12px;
}

.image-preview-img {
  max-width: 85vw;
  max-height: 80vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  cursor: default;
}

.image-preview-close {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }
}

.image-preview-name {
  color: rgba(255, 255, 255, 0.8);
  font-size: var(--text-md);
  max-width: 60vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-preview-enter-active,
.image-preview-leave-active {
  transition: opacity 0.2s ease;
}

.image-preview-enter-from,
.image-preview-leave-to {
  opacity: 0;
}
</style>
