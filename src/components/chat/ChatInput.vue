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
    <div v-if="currentPendingMessages.length > 0" class="pending-messages-bar">
      <div
        v-for="msg in currentPendingMessages"
        :key="msg.id"
        class="pending-message-item"
        :class="{ 'pending-later': msg.priority === 'later' }"
      >
        <Clock :size="14" class="pending-icon" />
        <span class="pending-text">{{ msg.displayLabel || msg.content }}</span>
        <span class="pending-priority-tag">{{ msg.priority === 'later' ? t('chatInput.priorityLater') : t('chatInput.priorityNow') }}</span>
        <button class="pending-action-btn" @click="recallPendingMsg(msg.id)" :title="t('chatInput.recallPending')">
          <ArrowUp :size="14" />
        </button>
        <button class="pending-action-btn" @click="removePendingMsg(msg.id)" :title="t('chatInput.removePending')">
          <X :size="14" />
        </button>
      </div>
    </div>

    <div class="input-wrapper" :class="{ 'has-content': hasContent, 'is-sending': isSending, 'is-optimizing': isOptimizing }">
      <!-- 悬浮任务/改动状态栏 -->
      <ComposerStatusBar />

      <!-- 引用文本附件条（选中文本浮条"添加到对话"） -->
      <div v-if="attachedQuotes.length > 0" class="quote-attachments">
        <div
          v-for="quote in attachedQuotes"
          :key="quote.id"
          class="quote-chip"
          @mouseenter="showQuoteTooltip(quote, $event)"
          @mouseleave="hideQuoteTooltip"
        >
          <Quote :size="13" class="quote-chip-icon" />
          <span class="quote-chip-text">{{ quote.text }}</span>
          <button class="quote-chip-delete" :title="t('common.delete')" @click="removeQuoteAttachment(quote.id)">
            <X :size="12" />
          </button>
        </div>
      </div>

      <!-- 文本输入区域 — contenteditable 支持内联 chip -->
      <div class="textarea-wrapper" @click="focusEditor">
        <div
          ref="editorRef"
          class="inline-editor"
          :contenteditable="!isOptimizing"
          :data-placeholder="placeholder"
          @input="handleEditorInput"
          @keydown="handleEditorKeydown"
          @click="handleEditorClick"
          @paste="handleEditorPaste"
        ></div>
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
      </div>

      <!-- 底部工具栏：+ 号、模型选择、发送按钮 -->
      <div class="input-toolbar">
        <div class="toolbar-left">
          <!-- + 号按钮 -->
          <button class="toolbar-btn add-btn" @click="handleAddClickAndLoadAgents" :title="t('chatInput.addAttachment')">
            <Plus :size="18" />
          </button>

          <!-- 权限模式选择器 -->
          <PermissionModeSelector />

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

          <!-- 模型选择器 - 使用可搜索下拉 -->
          <div class="model-selector" ref="modelSelectorRef">
            <button
              class="toolbar-btn model-btn"
              @click="toggleModelDropdown"
              :class="{ 'is-loading': isLoadingModels, 'has-error': modelLoadError }"
            >
              <Loader2 v-if="isLoadingModels" :size="14" class="loading-icon spin" />
              <span class="model-name">{{ selectedModelLabel }}</span>
              <span v-if="selectedMode" class="model-mode-pill">{{ modeLabel(selectedMode) }}</span>
              <ChevronDown :size="14" class="dropdown-icon" :class="{ open: showModelDropdown }" />
            </button>
            <!-- 模型下拉菜单 -->
            <Transition name="dropdown">
              <div v-if="showModelDropdown" ref="mainDropdownRef" class="model-dropdown" v-click-outside="closeModelDropdown">
                <!-- 推理深度选择区（合并到模型下拉） -->
                <div class="dropdown-section">
                  <div class="dropdown-section-title">{{ t('chat.reasoning') }}</div>
                  <div class="dropdown-list reasoning-list">
                    <button
                      v-for="mode in availableModes"
                      :key="mode"
                      class="dropdown-item"
                      :class="{ active: selectedMode === mode }"
                      @click="selectMode(mode)"
                    >
                      <span class="item-name">{{ modeLabel(mode) }}</span>
                      <Check v-if="selectedMode === mode" :size="14" class="check-icon" />
                    </button>
                  </div>
                </div>
                <div class="dropdown-section-divider"></div>
                <!-- 当前选中模型（点击展开二级菜单） -->
                <div class="dropdown-section">
                  <button
                    ref="modelTriggerRowRef"
                    class="dropdown-item dropdown-item-trigger"
                    :class="{ 'submenu-open': showModelSubmenu }"
                    @click="toggleModelSubmenu"
                    @mouseenter="showModelSubmenu = true"
                    @mouseleave="onCurrentModelRowLeave"
                  >
                    <span class="item-name">{{ selectedModelLabel || t('model.selectModel') }}</span>
                    <ChevronRight :size="14" class="check-icon" />
                  </button>
                </div>
              </div>
            </Transition>
            <!-- 模型二级子菜单（Teleport 到 body，避免 container-type/overflow/z-index 问题） -->
            <Teleport to="body">
            <Transition name="dropdown">
              <div
                v-if="showModelSubmenu"
                ref="modelSubmenuRef"
                class="model-submenu"
                :style="modelSubmenuStyle"
                @mouseenter="onModelSubmenuEnter"
                @mouseleave="onModelSubmenuLeave"
                v-click-outside="closeModelSubmenu"
              >
                <div class="dropdown-header">
                  <span>{{ t('auth.model') }}</span>
                  <button
                    v-if="canRefreshModels"
                    class="refresh-btn"
                    @click="refreshModels"
                    :disabled="isLoadingModels"
                    :title="t('chatInput.refreshModels')"
                  >
                    <RefreshCw :size="12" :class="{ spin: isLoadingModels }" />
                  </button>
                </div>
                <div class="dropdown-search-box">
                  <Search :size="14" class="search-icon" />
                  <input
                    ref="modelSearchInput"
                    v-model="modelSearchQuery"
                    type="text"
                    :placeholder="t('chatInput.searchModels')"
                  />
                  <button v-if="modelSearchQuery" class="clear-btn" @click="modelSearchQuery = ''">
                    <X :size="12" />
                  </button>
                </div>
                <div class="dropdown-list" ref="modelListRef">
                  <div v-if="!hasConfiguredModels && filteredModels.length === 0" class="dropdown-empty dropdown-config-prompt">
                    <Settings :size="16" />
                    <span>{{ t('chatInput.noModelsConfigured') }}</span>
                    <button class="config-link-btn" @click="openSettingsModels">
                      {{ t('chatInput.goToSettings') }}
                    </button>
                  </div>
                  <div v-else-if="isLoadingModels && filteredModels.length === 0" class="dropdown-loading">
                    <Loader2 :size="16" class="spin" />
                    <span>{{ t('common.loading') }}</span>
                  </div>
                  <div v-else-if="modelLoadError && filteredModels.length === 0" class="dropdown-error">
                    <AlertCircle :size="16" />
                    <span>{{ modelLoadError }}</span>
                    <button v-if="canRefreshModels" class="retry-btn" @click="refreshModels">
                      {{ t('chatInput.retry') }}
                    </button>
                  </div>
                  <div v-else-if="filteredModels.length === 0" class="dropdown-empty">
                    <span>{{ t('chatInput.noMatchingModels') }}</span>
                  </div>
                  <button
                    v-for="model in filteredModels"
                    :key="model.value"
                    class="dropdown-item"
                    :class="{ active: selectedModel === model.value, highlighted: highlightedModel === model.value }"
                    @click="selectModel(model.value)"
                    @mouseenter="highlightedModel = model.value"
                  >
                    <span class="item-name">{{ model.label }}</span>
                    <Check v-if="selectedModel === model.value" :size="14" class="check-icon" />
                  </button>
                </div>
              </div>
            </Transition>
            </Teleport>
          </div>

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

        <!-- 右侧按钮组：优化提示词 + 发送/停止 -->
        <div class="toolbar-right">
          <!-- 优化提示词按钮（位于发送按钮左侧） -->
          <button
            class="optimize-btn"
            :class="{ 'is-optimizing': isOptimizing }"
            :disabled="isOptimizing || props.isSending || !hasContent"
            :title="t('chatInput.optimizePrompt')"
            @click.stop.prevent="handleOptimizePrompt"
          >
            <Loader2 v-if="isOptimizing" :size="16" class="spin" />
            <Sparkles v-else :size="16" />
          </button>

          <!-- 发送/停止按钮 -->
          <button
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
      <ChatContextToolbar v-if="appStore.projectRoot || appStore.mode === 'work' || appStore.mode === 'design'" />
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
      @attach-image="handleAttachImage"
      @attach-file="handleAttachFile"
      @attach-folder="handleAttachFolder"
      @select-agent="selectAgentAndCloseMenu"
      @open-project-folder="handleOpenProjectFolder"
      @close="closeAttachmentMenu"
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

    <!-- 引用文本附件悬停提示（主题化浮窗，替代原生 title） -->
    <Teleport to="body">
      <Transition name="quote-tooltip">
        <div
          v-if="quoteTooltip.visible"
          ref="quoteTooltipRef"
          class="quote-tooltip"
          :style="quoteTooltip.style"
        >{{ quoteTooltip.text }}</div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onUnmounted, watch, nextTick } from 'vue'
import {
  ArrowUp, Plus, ChevronDown, Check, Square, X,
  Search, Loader2, RefreshCw, AlertCircle, Zap, FolderOpen, Brain,
  Sparkles, Image, ChevronRight, Archive, Clock, LayoutGrid, Settings, Quote
} from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import ChatContextToolbar from './ChatContextToolbar.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import ContextMenu from './ContextMenu.vue'
import AttachmentMenu from './AttachmentMenu.vue'
import { useAppStore, type InputInjectPayload } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import { api } from '@/services/electronAPI'
import { useI18n } from 'vue-i18n'
import { useOpenProjectWorkflow } from '@/composables/useOpenProjectWorkflow'
import { useFileToChat } from '@/composables/useFileToChat'
import PermissionModeSelector from './PermissionModeSelector.vue'
import ComposerStatusBar from './ComposerStatusBar.vue'

// ── Composables ──────────────────────────────────────────────────
import { useModelSelector, type ModelOption } from '@/composables/useModelSelector'
import { useSlashCommands, type SlashCommand } from '@/composables/useSlashCommands'
import { useContextMenu, type ContextItem } from '@/composables/useContextMenu'
import { useContentEditor, getMimeTypeFromFileName, serializeQuoteAttachments } from '@/composables/useContentEditor'
import { usePromptStash, resolveDraftSave, resolveDraftLoad, isMirrorValid } from '@/composables/usePromptStash'
import { useDragDrop } from '@/composables/useDragDrop'
import { useImageHandler } from '@/composables/useImageHandler'
import { useAgentSelector } from '@/composables/useAgentSelector'
import { useFileAttachments } from '@/composables/useFileAttachments'
import { usePromptOptimizer } from '@/composables/usePromptOptimizer'
import type { ImageAttachment, Attachment, AllAttachments, SendOptions, TextQuoteAttachment } from '@/composables/types'
import { vClickOutside } from '@/components/common/vClickOutside'

// Re-export types for backward compatibility (other components import from ChatInput)
export type { ImageAttachment, Attachment, AllAttachments, SendOptions } from '@/composables/types'

// Still needed for handleSend
import { resolveDirectSlash, dispatchCommandChip, type CommandChipData } from '@/lib/message-input-logic'
import type { CommandKind } from '@/lib/constants/commands'

// ── Props & Emits ────────────────────────────────────────────────
const emit = defineEmits<{
  send: [content: string, attachments: AllAttachments, options?: SendOptions]
  'slash-command': [command: string, args: string, attachments: AllAttachments, displayLabel?: string]
  'update:model': [model: string]
  'update:effort': [effort: string]
  'update:agent': [agent: string]
  'open-skills': []
  stop: []
}>()

const props = defineProps<{
  disabled?: boolean
  isSending?: boolean
  placeholder?: string
  modelValue?: string
  workingDirectory?: string
  showOpenProjectAction?: boolean
  /** 本输入框绑定的会话 id；未传时回退全局 currentSessionId */
  sessionId?: string
}>()

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
  onUpdateEffort: (e) => emit('update:effort', e),
})
const {
  selectedModel, selectedMode, showModelDropdown, showModelSubmenu,
  modelSearchQuery, highlightedModel, isLoadingModels, modelLoadError,
  modelSearchInput, modelSelectorRef, modelListRef, modelSubmenuRef,
  mainDropdownRef, modelTriggerRowRef,
  availableModels, hasConfiguredModels, filteredModels, canRefreshModels, selectedModelLabel, availableModes,
  selectModel, selectMode, modeLabel, closeModelDropdown, toggleModelDropdown,
  toggleModelSubmenu, onCurrentModelRowLeave, onModelSubmenuEnter,
  onModelSubmenuLeave, closeModelSubmenu, navigateModels, handleModelKeydown,
  fetchModelsFromBaseUrl, refreshModels, initialize: initializeModelSelector,
} = modelSelector

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

// ── Per-session draft persistence ───────────────────────────────
// 编辑器内容是组件本地 DOM 状态。会话切换 / 页面切换（设置页等会卸载本组件的
// 视图）时必须按「内容归属的会话」保存草稿，而不是全局 currentSessionId——
// 切换会话时 store 已经指向新会话，用 current 做 key 会把草稿存错会话。
// 归属会话由 ChatPanel 通过 props.sessionId 传入（分屏时每个 pane 独立）。
const editorSessionId = ref<string | null>(null)

function buildDraftFromEditor() {
  return {
    text: getEditorPlainText().trim(),
    attachments: attachedFiles.value.map(f => ({ ...f })),
    images: attachedImages.value.map(img => ({ ...img })),
    quotes: attachedQuotes.value.map(q => ({ ...q })),
    editorHtml: editorRef.value?.innerHTML || '',
  }
}

/** 把编辑器当前内容保存为 sid 的草稿；空内容时清掉对应草稿 */
function saveDraftForSession(sid: string | null) {
  const draft = buildDraftFromEditor()
  const hasDraft = draft.text.length > 0 || draft.attachments.length > 0 || draft.images.length > 0 || draft.quotes.length > 0
  const existingMirror = sessionStore.getNewChatDraft()
  const messageCount = sid ? (sessionStore.getSession(sid)?.messages.length ?? null) : null

  const decision = resolveDraftSave(hasDraft, sid, messageCount, existingMirror?.ownerSessionId)

  if (sid) {
    if (decision.saveDraft) {
      sessionStore.saveDraft(sid, draft)
    } else {
      sessionStore.clearDraft(sid)
    }
  }
  if (decision.clearMirror) {
    sessionStore.clearNewChatDraft()
  }
  if (decision.saveMirror) {
    sessionStore.setNewChatDraft(sid, draft)
  }
}

/** 恢复 sid 的草稿到编辑器；无草稿时清空编辑器（避免上一会话内容串台） */
function loadDraftForSession(sid: string | null) {
  const draft = sid ? sessionStore.getDraft(sid) : undefined
  const stash = sid ? sessionStore.getStash(sid) : undefined
  const mirror = sessionStore.getNewChatDraft()

  let mirrorUsable = false
  if (mirror) {
    const ownerCount = mirror.ownerSessionId
      ? (sessionStore.getSession(mirror.ownerSessionId)?.messages.length ?? null)
      : null
    const isFreshSession = !sid || (sessionStore.getSession(sid)?.messages.length ?? 0) === 0
    mirrorUsable = isMirrorValid(mirror.ownerSessionId, ownerCount) && isFreshSession
  }

  const action = resolveDraftLoad(!!draft, !!stash, mirrorUsable)

  if (action === 'draft' && draft) {
    restoreStashData(draft)
    return
  }
  if (action === 'stash' && stash) {
    restoreStashData(stash)
    return
  }
  if (action === 'mirror' && mirror) {
    restoreStashData(mirror.data)
    return
  }

  clearEditor()
  attachedFiles.value = []
  clearImages()
  clearQuotes()
  inputText.value = ''
}

function restoreStashData(stash: { text: string; attachments: { name: string; path: string; isFolder: boolean }[]; images: any[]; quotes?: { id: string; text: string }[]; editorHtml: string }) {
  if (editorRef.value && stash.editorHtml) {
    editorRef.value.innerHTML = stash.editorHtml
  }
  attachedFiles.value = stash.attachments.map(f => ({ ...f }))
  attachedImages.value = stash.images.map(img => ({ ...img }))
  attachedQuotes.value = (stash.quotes ?? []).map(q => ({ ...q }))
  inputText.value = stash.text
  nextTick(() => {
    autoResize()
    focusEditor()
  })
}

// Drag & drop
const dragDrop = useDragDrop()
const { isDragging } = dragDrop

// Image handler
const imageHandler = useImageHandler()
const { attachedImages, handleImageFile: handleImageFileFromComposable, readLocalImageAsDataUrl, clearImages } = imageHandler

// Agent selector
const agentSelector = useAgentSelector({
  onUpdateAgent: (a) => emit('update:agent', a),
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
  if (sessionStore.availableAgents.length > 0 || agentsLoadPromise) return
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
  clearFiles, handleAddClick, closeAttachmentMenu,
  handleAttachFile, handleAttachFolder, handleBrowseFiles: handleBrowseFilesBase,
} = fileAttachments

// Wrapper that also closes context menu (template compatibility)
function handleBrowseFiles() {
  closeContextMenu()
  handleBrowseFilesBase()
}

// ── Prompt optimizer ────────────────────────────────────────────
const promptOptimizer = usePromptOptimizer()
const { isOptimizing, optimizePrompt: runOptimizePrompt } = promptOptimizer

// ── Quote attachments (selection bar "add to conversation") ─────
const attachedQuotes = ref<TextQuoteAttachment[]>([])

function addQuoteAttachment(quote: { id: string; text: string }) {
  if (!attachedQuotes.value.some(q => q.id === quote.id)) {
    attachedQuotes.value.push({ ...quote })
  }
}

function removeQuoteAttachment(id: string) {
  const idx = attachedQuotes.value.findIndex(q => q.id === id)
  if (idx >= 0) attachedQuotes.value.splice(idx, 1)
  hideQuoteTooltip()
}

// ── Quote chip 悬停提示（主题化浮窗） ─────────────────────────────
const quoteTooltipRef = ref<HTMLElement | null>(null)
const quoteTooltip = ref<{ visible: boolean; text: string; style: Record<string, string> }>({
  visible: false,
  text: '',
  style: {},
})

function showQuoteTooltip(quote: { id: string; text: string }, e: MouseEvent) {
  const chip = e.currentTarget as HTMLElement
  // 先以 visibility: hidden 渲染以便测量尺寸（display: none 会测得 0, 导致定位遮挡 chip）
  quoteTooltip.value = { visible: true, text: quote.text, style: { visibility: 'hidden' } }
  nextTick(() => positionQuoteTooltip(chip))
}

function hideQuoteTooltip() {
  quoteTooltip.value = { ...quoteTooltip.value, visible: false }
}

function positionQuoteTooltip(chip: HTMLElement) {
  const el = quoteTooltipRef.value
  if (!el) return
  const rect = chip.getBoundingClientRect()
  const gap = 6
  const margin = 8
  const width = el.offsetWidth
  const height = el.offsetHeight
  // 与 chip 左对齐，超出右边缘时右移钳位
  const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin)
  // 默认在 chip 上方，空间不足时翻到下方
  let top = rect.top - height - gap
  if (top < margin) top = rect.bottom + gap
  quoteTooltip.value = {
    visible: true,
    text: quoteTooltip.value.text,
    style: { position: 'fixed', top: `${top}px`, left: `${left}px`, visibility: 'visible' },
  }
}

function clearQuotes() {
  attachedQuotes.value = []
}

// ── Local state (not extracted) ──────────────────────────────────
const showSteerHint = ref(false)
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
const canSend = computed(() => hasContent.value && !props.isSending)

const currentPendingMessages = computed(() => {
  const sid = sessionStore.currentSessionId
  if (!sid) return []
  return turnStore.getPendingMessages(sid)
})

// Model submenu style — with <Teleport to="body">, position: fixed is
// relative to the viewport, so getBoundingClientRect() values can be used
// directly without subtracting the container offset.
// Reading showModelSubmenu ensures the computed re-evaluates with fresh
// getBoundingClientRect() values every time the submenu opens.
const MODEL_SUBMENU_WIDTH = 220 // min-width of .model-submenu
const MODEL_SUBMENU_GAP = 4

const modelSubmenuStyle = computed<Record<string, string>>(() => {
  // Reactive trigger: re-evaluate when the submenu toggles
  if (!showModelSubmenu.value) return {}

  const mainDropdown = mainDropdownRef.value
  const triggerRow = modelTriggerRowRef.value
  const style: Record<string, string> = {}
  if (!mainDropdown || !triggerRow) return style

  const mainDropdownRect = mainDropdown.getBoundingClientRect()
  const triggerRowRect = triggerRow.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  style.position = 'fixed'
  style.bottom = `${viewportHeight - triggerRowRect.bottom}px`

  // Flip to left when there isn't enough space on the right (e.g. when the
  // right-side env panel is open), otherwise position to the right of the
  // main dropdown with a small gap.
  const spaceRight = viewportWidth - mainDropdownRect.right - MODEL_SUBMENU_GAP
  if (spaceRight >= MODEL_SUBMENU_WIDTH) {
    style.left = `${mainDropdownRect.right + MODEL_SUBMENU_GAP}px`
  } else {
    style.left = `${Math.max(MODEL_SUBMENU_GAP, mainDropdownRect.left - MODEL_SUBMENU_GAP - MODEL_SUBMENU_WIDTH)}px`
  }

  return style
})

// ── Pending Messages ─────────────────────────────────────────────
function recallPendingMsg(msgId: string) {
  const sid = sessionStore.currentSessionId
  if (!sid) return
  const recalled = turnStore.recallPendingMessage(sid, msgId)
  if (recalled) {
    inputText.value = recalled.content
    if (editorRef.value) {
      editorRef.value.innerText = recalled.content
    }
    attachedFiles.value = recalled.attachments.map(f => ({ ...f }))
    attachedImages.value = recalled.images.map(img => ({ ...img }))
    nextTick(() => focusEditor())
  }
}

function removePendingMsg(msgId: string) {
  const sid = sessionStore.currentSessionId
  if (sid) turnStore.removePendingMessage(sid, msgId)
}

// ── Thinking toggle ──────────────────────────────────────────────
function toggleThinking() {
  thinkingEnabled.value = !thinkingEnabled.value
  settingsStore.thinkingEnabled = thinkingEnabled.value
  settingsStore.saveSettings()

  const sid = sessionStore.currentSessionId
  if (sid) {
    api.updateThinkingLevel(sid, thinkingEnabled.value).catch(() => {})
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
        navigateContextItems(1)
        return
      case 'ArrowUp':
        event.preventDefault()
        navigateContextItems(-1)
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
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
    event.preventDefault()
    handleSend(true)
    return
  }

  // Enter without Shift = send
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend(false)
    return
  }

  // ArrowUp: recall pending message when empty
  if (event.key === 'ArrowUp' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    const content = getEditorPlainText().trim()
    if (!content) {
      const sid = sessionStore.currentSessionId
      if (sid) {
        const pending = turnStore.getPendingMessages(sid)
        if (pending.length > 0) {
          event.preventDefault()
          const lastMsg = pending[pending.length - 1]
          const recalled = turnStore.recallPendingMessage(sid, lastMsg.id)
          if (recalled) {
            inputText.value = recalled.content
            if (editorRef.value) {
              editorRef.value.innerText = recalled.content
            }
            attachedFiles.value = recalled.attachments.map(f => ({ ...f }))
            attachedImages.value = recalled.images.map(img => ({ ...img }))
            nextTick(() => focusEditor())
          }
        }
      }
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

// ── Keyboard event routing ───────────────────────────────────────
function handleSlashKeydown(event: KeyboardEvent) {
  if (!commandPalette.showMenu.value) return

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      commandPalette.closeMenu()
      editorRef.value?.focus()
      break
    case 'ArrowDown':
      event.preventDefault()
      navigateSlashCommands(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      navigateSlashCommands(-1)
      break
    case 'Enter':
      event.preventDefault()
      const selectedCmd = commandPalette.getSelectedCommand()
      if (selectedCmd) {
        const slashCmd: SlashCommand = {
          name: selectedCmd.name,
          description: selectedCmd.description,
          icon: (selectedCmd.icon && iconMap[selectedCmd.icon]) || Zap,
          kind: selectedCmd.kind,
          immediate: selectedCmd.immediate,
          aliases: selectedCmd.aliases,
          source: selectedCmd.source,
        }
        selectSlashCommand(slashCmd)
      }
      break
    case 'Tab':
      event.preventDefault()
      const tabSelectedCmd = commandPalette.getSelectedCommand()
      if (tabSelectedCmd) {
        const tabSlashCmd: SlashCommand = {
          name: tabSelectedCmd.name,
          description: tabSelectedCmd.description,
          icon: (tabSelectedCmd.icon && iconMap[tabSelectedCmd.icon]) || Zap,
          kind: tabSelectedCmd.kind,
          immediate: tabSelectedCmd.immediate,
          aliases: tabSelectedCmd.aliases,
          source: tabSelectedCmd.source,
        }
        selectSlashCommand(tabSlashCmd)
      }
      break
  }
}

function handleContextKeydown(event: KeyboardEvent) {
  if (!showContextMenu.value) return

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      closeContextMenu()
      editorRef.value?.focus()
      break
    case 'ArrowDown':
      event.preventDefault()
      navigateContextItems(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      navigateContextItems(-1)
      break
    case 'Enter':
      event.preventDefault()
      const item = filteredContextItems.value.find(i => i.path === highlightedContextItem.value)
      if (item) {
        selectContextItem(item)
      }
      break
    case 'Tab':
      event.preventDefault()
      const tabItem = filteredContextItems.value.find(i => i.path === highlightedContextItem.value)
      if (tabItem) {
        selectContextItem(tabItem)
      }
      break
  }
}

// Navigate context items (local orchestration)
function navigateContextItems(direction: number) {
  const items = filteredContextItems.value
  if (items.length === 0) return

  const currentIndex = items.findIndex(i => i.path === highlightedContextItem.value)
  let newIndex = currentIndex + direction

  if (newIndex < 0) newIndex = items.length - 1
  if (newIndex >= items.length) newIndex = 0

  highlightedContextItem.value = items[newIndex].path

  nextTick(() => {
    const listEl = contextMenuRef.value?.listRef
    const highlightedEl = listEl?.querySelector('.highlighted')
    highlightedEl?.scrollIntoView({ block: 'nearest' })
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

/** Open settings panel and navigate to the Model tab */
function openSettingsModels() {
  appStore.toggleSettings()
  nextTick(() => {
    window.dispatchEvent(new CustomEvent('settings-navigate', { detail: { tab: 'model' } }))
  })
}

// ── Prompt optimization ──────────────────────────────────────────
async function handleOptimizePrompt() {
  const prompt = getEditorPlainText().trim()
  if (!prompt || isOptimizing.value) return

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

function handleSend(steerMode = false) {
  if (isOptimizing.value) return

  if (props.isSending) {
    const content = getEditorPlainText().trim()
    const allAttachments = collectAllAttachments(attachedFiles.value, attachedImages.value)
    const quoteBlock = serializeQuoteAttachments(attachedQuotes.value)
    const sendContent = quoteBlock ? (content ? `${quoteBlock}\n\n${content}` : quoteBlock) : content

    if (!sendContent && allAttachments.files.length === 0 && allAttachments.images.length === 0) return

    const sid = sessionStore.currentSessionId
    if (!sid) return

    if (steerMode) {
      emit('send', sendContent, allAttachments)
      clearEditor()
      attachedFiles.value = []
      clearImages()
      clearQuotes()
      showSteerHint.value = true
      setTimeout(() => { showSteerHint.value = false }, 2000)
    } else {
      turnStore.addPendingMessage(sid, {
        id: crypto.randomUUID(),
        content: sendContent,
        attachments: allAttachments.files.map(f => ({ ...f })),
        images: allAttachments.images.map(img => ({ ...img })),
        displayLabel: sendContent.slice(0, 80),
        priority: 'later',
        createdAt: Date.now(),
      })
      clearEditor()
      attachedFiles.value = []
      clearImages()
      clearQuotes()
    }
    return
  }

  if (props.disabled) return

  if (commandPalette.showMenu.value || showContextMenu.value) return

  const content = getEditorPlainText().trim()
  const allAttachments = collectAllAttachments(attachedFiles.value, attachedImages.value)
  const quoteBlock = serializeQuoteAttachments(attachedQuotes.value)
  const sendContent = quoteBlock ? (content ? `${quoteBlock}\n\n${content}` : quoteBlock) : content

  if (!hasContent.value) return

  function cleanupAfterCommand() {
    clearEditor()
    attachedFiles.value = []
    clearImages()
    clearQuotes()
  }

  const editorEl = editorRef.value
  const commandChips = editorEl ? Array.from(editorEl.querySelectorAll('.command-chip')) : []

  if (commandChips.length > 0) {
    const chips: CommandChipData[] = commandChips.map((el) => ({
      command: el.getAttribute('data-command') || '',
      label: (el.getAttribute('data-command') || '').replace(/^\//, ''),
      kind: (el.getAttribute('data-kind') || 'slash_command') as CommandKind,
      source: el.getAttribute('data-source') || 'builtin',
    }))

    if (chips.length === 1 && chips[0].kind === 'sdk_command') {
      const commandName = chips[0].label
      const userContent = content.replace(/\/cmd:"[^"]+":\w+:\w+\s*/g, '').trim()
      const chipMarker = `/cmd:"${commandName}":${chips[0].kind}:${chips[0].source}`
      const displayLabel = userContent ? `${chipMarker} ${userContent}` : chipMarker
      cleanupAfterCommand()
      emit('slash-command', commandName, userContent, allAttachments, displayLabel)
      return
    }

    if (chips.length === 1 && chips[0].kind === 'immediate') {
      const commandName = chips[0].label
      const userContent = content.replace(/\/cmd:"[^"]+":\w+:\w+\s*/g, '').trim()
      const chipMarker = `/cmd:"${commandName}":${chips[0].kind}:${chips[0].source}`
      const displayLabel = userContent ? `${chipMarker} ${userContent}` : chipMarker
      cleanupAfterCommand()
      emit('slash-command', commandName, userContent, allAttachments, displayLabel)
      return
    }

    const userContent = content.replace(/\/cmd:"[^"]+":\w+:\w+\s*/g, '').trim()
    const result = dispatchCommandChip(chips, userContent)

    emit('send', result.prompt, allAttachments, {
      displayLabel: result.displayLabel
    })

    cleanupAfterCommand()
    return
  }

  const slashResult = resolveDirectSlash(content)

  if (slashResult.action === 'immediate_command') {
    const commandName = content.slice(1).split(/\s+/)[0]
    const commandArgs = content.slice(1 + commandName.length).trim()
    clearEditor()
    emit('slash-command', commandName, commandArgs, allAttachments)
  } else if (slashResult.action === 'insert_chip' && slashResult.chip) {
    // 直接输入 "/command args" 提交：从原文提取参数，避免 args 丢失
    const commandName = slashResult.chip.label
    const commandArgs = content.slice(1 + commandName.length).trim()

    if (slashResult.chip.kind === 'sdk_command') {
      // sdk 命令与 chip 路径行为一致：作为斜杠命令派发（如 /goal <objective>）
      cleanupAfterCommand()
      emit('slash-command', commandName, commandArgs, allAttachments)
      return
    }

    const result = dispatchCommandChip([slashResult.chip], commandArgs)
    emit('send', result.prompt, allAttachments, {
      displayLabel: result.displayLabel
    })
    clearEditor()
  } else {
    emit('send', sendContent, allAttachments)
  }

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

  document.addEventListener('keydown', handleModelKeydown)
  window.addEventListener('session-created', focusEditor)
  window.addEventListener('chip-image-preview', handleChipImagePreview as EventListener)

  // 挂载即恢复本会话草稿（例如从设置页返回时组件被重新挂载）
  editorSessionId.value = props.sessionId ?? sessionStore.currentSessionId
  nextTick(() => loadDraftForSession(editorSessionId.value))
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleModelKeydown)
  window.removeEventListener('session-created', focusEditor)
  window.removeEventListener('chip-image-preview', handleChipImagePreview as EventListener)
  hideQuoteTooltip()
})

// Before the DOM is torn down (e.g. when navigating to settings), stash the
// editor content under the session it belongs to (NOT the global current —
// that may already point elsewhere). onBeforeUnmount runs while the DOM is
// still intact, so editorRef.value and its innerHTML are still available.
onBeforeUnmount(() => {
  saveDraftForSession(editorSessionId.value)
})

// Watch external modelValue changes
watch(() => props.modelValue, (newValue) => {
  if (newValue && newValue !== selectedModel.value) {
    selectedModel.value = newValue
  }
})

// Watch workbench injection
watch(() => appStore.pendingInputInjection, (payload) => {
  if (!payload) return
  injectFromWorkbench(payload)
  appStore.consumeInputInjection()
})

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
  saveDraftForSession(editorSessionId.value)
  editorSessionId.value = newSid ?? null
  focusEditor()
  nextTick(() => loadDraftForSession(editorSessionId.value))
})

// Watch disabled/isSending to toggle contenteditable
watch([() => props.disabled, () => props.isSending], ([disabled, sending]) => {
  const editorEl = editorRef.value
  if (editorEl) {
    editorEl.contentEditable = (!disabled || sending) ? 'true' : 'false'
  }
}, { immediate: true })

// Watch model submenu for auto-focus (search clearing is handled by useModelSelector)
watch(showModelSubmenu, (open) => {
  if (open) {
    nextTick(() => {
      modelSearchInput.value?.focus()
    })
  }
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
</script>

<style lang="scss" scoped>
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

// Pending Messages Bar
.pending-messages-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 20px 8px;
}

.pending-message-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg-secondary);
  border: 1px dashed var(--accent-primary);
  border-radius: var(--radius-md);
  font-size: var(--text-md);
  color: var(--text-secondary);
  opacity: 0.85;
  transition: opacity 0.2s ease;

  &:hover {
    opacity: 1;
  }

  .pending-icon {
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .pending-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pending-priority-tag {
    font-size: var(--text-2xs);
    font-weight: 600;
    padding: 2px 6px;
    border-radius: var(--radius-xs);
    white-space: nowrap;
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  &.pending-later .pending-priority-tag {
    color: #6366f1;
    background: color-mix(in srgb, var(--accent-secondary) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-secondary) 20%, transparent);
  }

  &:not(.pending-later) .pending-priority-tag {
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.2);
  }

  .pending-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition: all var(--transition-fast);

    &:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
  }
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
    > :not(.composer-status-bar) {
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

// 引用文本附件条
.quote-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

// 引用附件悬停提示（Teleport 到 body, 不受 scoped 限制需用 :global 或直接写在全局选择器下）
.quote-tooltip {
  position: fixed;
  z-index: 9999;
  max-width: 320px;
  max-height: 180px;
  padding: 8px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  pointer-events: none;
  @include scrollbar;
}

.quote-tooltip-enter-active,
.quote-tooltip-leave-active {
  transition: opacity 0.12s ease-out, transform 0.12s ease-out;
}

.quote-tooltip-enter-from,
.quote-tooltip-leave-to {
  opacity: 0;
  transform: translateY(2px);
}

.quote-chip {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  cursor: default;
  user-select: none;

  .quote-chip-icon {
    flex-shrink: 0;
    color: var(--text-secondary);
  }

  .quote-chip-text {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
  }

  .quote-chip-delete {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 50%;

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
  }
}

// 文本输入区域
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
    word-wrap: break-word;
    white-space: pre-wrap;

    &:empty::before {
      content: attr(data-placeholder);
      color: var(--text-muted);
      pointer-events: none;
    }

    // Shared delete button styles for chips.
    // chip 节点由 useContentEditor 动态创建, 无 scoped 属性, 必须 :deep 才能命中
    :deep(.chip-delete-btn) {
      position: absolute;
      top: -1px;
      right: -1px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: var(--bg-tertiary);
      color: var(--text-secondary);
      cursor: pointer;
      opacity: 0;
      visibility: hidden;
      transform: scale(0.85);
      transition: opacity 0.15s ease, visibility 0.15s ease, transform 0.15s ease, background 0.15s ease;
      pointer-events: none;
      z-index: 1;

      svg {
        width: 8px;
        height: 8px;
      }

      &:hover {
        background: var(--surface-hover);
        color: var(--text-primary);
      }
    }

    // Inline mention chip styles
    :deep(.mention-chip) {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px 2px 8px;
      margin: 0 2px;
      background: var(--bg-secondary);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-xs);
      font-size: var(--text-sm);
      line-height: var(--leading-normal);
      vertical-align: baseline;
      cursor: default;
      user-select: none;
      font-family: var(--font-mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace);

      .chip-icon {
        font-size: var(--text-sm);
        line-height: 1;
        flex-shrink: 0;
      }

      .chip-name {
        max-width: 260px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &:hover .chip-delete-btn {
        opacity: 1;
        visibility: visible;
        transform: scale(1);
        pointer-events: auto;
      }

      &.is-folder {
        background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.08);
        border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.3);
        color: var(--accent-primary);
      }

      &.is-image {
        background: rgba(34, 197, 94, 0.08);
        border-color: rgba(34, 197, 94, 0.3);
        color: #22c55e;
        padding: 2px 6px 2px 2px;
      }

      .chip-thumb {
        width: 32px;
        height: 32px;
        object-fit: cover;
        border-radius: 3px;
        flex-shrink: 0;
        cursor: zoom-in;
        display: block;
      }
    }

    // Inline command chip styles
    :deep(.command-chip) {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px 2px 8px;
      margin: 0 2px;
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-xs);
      font-size: var(--text-sm);
      line-height: var(--leading-normal);
      vertical-align: baseline;
      cursor: default;
      user-select: none;
      font-family: var(--font-mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace);

      .chip-source-icon {
        font-size: 1em;
        line-height: 1;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
      }

      .chip-label {
        font-weight: 600;
      }

      .chip-source-tag {
        font-size: var(--text-2xs);
        opacity: 0.7;
        text-transform: capitalize;
      }

      // Commands use one blue treatment to distinguish them from user text.
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.1);
      border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.35);
      color: var(--accent-primary);
    }
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

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: var(--radius-md);
  font-size: var(--text-md);
  color: var(--text-secondary);
  background: transparent;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
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

.model-selector {
  position: relative;
  min-width: 0;
}

.model-btn {
  background: transparent;
  min-width: 0;

  .model-name {
    font-weight: 500;
    max-width: 120px;
    @include truncate;
  }

  .model-mode-pill {
    flex-shrink: 0;
    padding: 2px 8px;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-muted);
    background: var(--bg-tertiary, rgba(0, 0, 0, 0.04));
    border-radius: var(--radius-sm);
    line-height: var(--leading-normal);
  }

  .dropdown-icon {
    transition: transform 0.2s ease;

    &.open {
      transform: rotate(180deg);
    }
  }

  &.is-loading {
    .model-name {
      opacity: 0.7;
    }
  }

  &.has-error {
    color: var(--error-color, #dc2626);
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

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// 下拉菜单通用样式
.model-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 8px;
  min-width: 240px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  z-index: 100;
  overflow: hidden;
}

// 模型二级子菜单（Teleport 到 body，fixed 定位，自适应左右弹出）
.model-submenu {
  min-width: 220px;
  max-height: 360px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  z-index: 500;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

// 触发二级子菜单的当前模型行
.dropdown-item-trigger {
  &.submenu-open {
    background: var(--surface-hover);
  }
}

.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
  font-size: var(--text-2xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--surface-border);
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: transparent;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

// 搜索框样式
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--bg-secondary);

  .search-icon {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: var(--text-md);
    outline: none;

    &::placeholder {
      color: var(--text-muted);
    }
  }

  .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-xs);

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
  }

  .ghost-text {
    color: var(--text-muted);
    font-size: var(--text-base);
    opacity: 0.5;
    pointer-events: none;
    white-space: nowrap;
  }
}

.dropdown-list {
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
}

.reasoning-list {
  max-height: none;
}

.dropdown-section {
  padding: 4px 4px 6px;
}

.dropdown-section-title {
  padding: 6px 12px 4px;
  font-size: var(--text-2xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
}

.dropdown-section-divider {
  height: 1px;
  background: var(--surface-border);
  margin: 0;
}

.dropdown-loading,
.dropdown-error,
.dropdown-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  color: var(--text-muted);
  font-size: var(--text-md);
  text-align: center;
}

.dropdown-config-prompt {
  gap: 10px;
}

.config-link-btn {
  padding: 6px 16px;
  background: var(--accent-primary);
  color: white;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    opacity: 0.9;
  }
}

.dropdown-error {
  color: var(--error-color, #dc2626);
}

.retry-btn {
  padding: 6px 12px;
  background: var(--accent-primary);
  color: white;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 500;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--accent-primary-hover);
  }
}

.dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: var(--text-md);
  color: var(--text-primary);
  background: transparent;
  transition: all var(--transition-fast);
  text-align: left;

  &:hover,
  &.highlighted {
    background: var(--surface-hover);
  }

  &.active {
    background: rgba(var(--accent-primary-rgb), 0.1);
  }

  .item-name {
    @include truncate;
    flex: 1;
  }

  .check-icon {
    color: var(--accent-primary);
    flex-shrink: 0;
    margin-left: 8px;
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


// dropdown-search-box 仍被模型下拉菜单使用
.dropdown-search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--bg-secondary);

  .search-icon {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: var(--text-base);
    outline: none;

    &::placeholder {
      color: var(--text-muted);
    }
  }

  .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-xs);

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
  }
}

// 过渡动画
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

/* 窄面板下模型选择器自适应：缩小模型名、隐藏推理模式 pill */
@container (max-width: 520px) {
  .model-btn .model-name {
    max-width: 70px;
  }
  .model-btn .model-mode-pill {
    display: none;
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
