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
          <button class="toolbar-btn add-btn" @click="handleAddClick" :title="t('chatInput.addAttachment')">
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
            <!-- 模型二级子菜单（浮层，定位到主 dropdown 左上方） -->
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
                  <div v-if="isLoadingModels && filteredModels.length === 0" class="dropdown-loading">
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
          <span>拖放图片到此处添加</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  ArrowUp, Plus, ChevronDown, Check, Square, X,
  Search, Loader2, RefreshCw, AlertCircle, Zap, FolderOpen, Brain,
  Sparkles, Image, ChevronRight, Archive, Clock, LayoutGrid
} from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import ChatContextToolbar from './ChatContextToolbar.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import ContextMenu from './ContextMenu.vue'
import AttachmentMenu from './AttachmentMenu.vue'
import { useSkillsStore } from '@/stores/skills'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore, useTurnStore } from '@/stores/chat'
import { api } from '@/services/electronAPI'
import { useI18n } from 'vue-i18n'
import { useOpenProjectWorkflow } from '@/composables/useOpenProjectWorkflow'
import { useFileToChat } from '@/composables/useFileToChat'
import PermissionModeSelector from './PermissionModeSelector.vue'

// ── Composables ──────────────────────────────────────────────────
import { useModelSelector, type ModelOption } from '@/composables/useModelSelector'
import { useSlashCommands, type SlashCommand } from '@/composables/useSlashCommands'
import { useContextMenu, type ContextItem } from '@/composables/useContextMenu'
import { useContentEditor, getMimeTypeFromFileName } from '@/composables/useContentEditor'
import { usePromptStash } from '@/composables/usePromptStash'
import { useDragDrop } from '@/composables/useDragDrop'
import { useImageHandler } from '@/composables/useImageHandler'
import { useAgentSelector } from '@/composables/useAgentSelector'
import { useFileAttachments } from '@/composables/useFileAttachments'
import { usePromptOptimizer } from '@/composables/usePromptOptimizer'
import type { ImageAttachment, Attachment, AllAttachments, SendOptions } from '@/composables/types'
import { vClickOutside } from '@/directives/vClickOutside'

// Re-export types for backward compatibility (other components import from ChatInput)
export type { ImageAttachment, Attachment, AllAttachments, SendOptions } from '@/composables/types'

// Still needed for handleSend
import { resolveDirectSlash, dispatchCommandChip, type CommandChipData } from '@/lib/message-input-logic'
import type { CommandKind } from '@/lib/constants/commands'

// ── Props & Emits ────────────────────────────────────────────────
const emit = defineEmits<{
  send: [content: string, attachments: AllAttachments, options?: SendOptions]
  'slash-command': [command: string, args: string, attachments: AllAttachments]
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
  availableModels, filteredModels, canRefreshModels, selectedModelLabel, availableModes,
  selectModel, selectMode, modeLabel, closeModelDropdown, toggleModelDropdown,
  toggleModelSubmenu, onCurrentModelRowLeave, onModelSubmenuEnter,
  onModelSubmenuLeave, closeModelSubmenu, navigateModels, handleModelKeydown,
  fetchModelsFromBaseUrl, refreshModels, initialize: initializeModelSelector,
} = modelSelector

// Slash commands
const slashCommands = useSlashCommands()
const {
  slashTriggerPosition, slashMenuPosition,
  filteredSlashCommands, showSlashCommandMenu,
  highlightedSlashCommand,
  navigateSlashCommands, closeSlashCommandMenu, openSkillsManager: openSkillsManagerBase,
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

// ── Local state (not extracted) ──────────────────────────────────
const showSteerHint = ref(false)
const thinkingEnabled = ref(settingsStore.thinkingEnabled)
const contextMenuRef = ref<InstanceType<typeof ContextMenu> | null>(null)

// ── Computed ─────────────────────────────────────────────────────
const hasContent = computed(() => editorHasContent(attachedFiles.value, attachedImages.value))
const canSend = computed(() => hasContent.value && !props.isSending)

const currentPendingMessages = computed(() => {
  const sid = sessionStore.currentSessionId
  if (!sid) return []
  return turnStore.getPendingMessages(sid)
})

// Model submenu style (depends on DOM refs from useModelSelector)
const modelSubmenuStyle = computed<Record<string, string>>(() => {
  const mainDropdown = mainDropdownRef.value
  const triggerRow = modelTriggerRowRef.value
  const style: Record<string, string> = {}
  if (!mainDropdown || !triggerRow) return style

  const mainDropdownRect = mainDropdown.getBoundingClientRect()
  const triggerRowRect = triggerRow.getBoundingClientRect()

  style.bottom = `${window.innerHeight - triggerRowRect.bottom}px`
  style.left = `${mainDropdownRect.right + 4}px`
  style.position = 'fixed'

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
function injectFromWorkbench(payload: { text?: string; image?: ImageAttachment }) {
  if (payload.image) {
    const img: ImageAttachment = { ...payload.image, type: 'image' }
    attachedImages.value.push(img)
    editorRef.value?.focus()
    insertImageChip(img)
  }
  if (payload.text) {
    const editorEl = editorRef.value
    if (editorEl) {
      editorEl.focus()
      const prefix = editorEl.textContent && !editorEl.textContent.endsWith('\n') ? '\n' : ''
      editorEl.appendChild(document.createTextNode(prefix + payload.text))
      inputText.value = getEditorPlainText()
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
    commandPalette.triggerMenu(slashMatch[1] || '')

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

    if (!content && allAttachments.files.length === 0 && allAttachments.images.length === 0) return

    const sid = sessionStore.currentSessionId
    if (!sid) return

    if (steerMode) {
      emit('send', content, allAttachments)
      clearEditor()
      attachedFiles.value = []
      clearImages()
      showSteerHint.value = true
      setTimeout(() => { showSteerHint.value = false }, 2000)
    } else {
      turnStore.addPendingMessage(sid, {
        id: crypto.randomUUID(),
        content,
        attachments: allAttachments.files.map(f => ({ ...f })),
        images: allAttachments.images.map(img => ({ ...img })),
        displayLabel: content.slice(0, 80),
        priority: 'later',
        createdAt: Date.now(),
      })
      clearEditor()
      attachedFiles.value = []
      clearImages()
    }
    return
  }

  if (props.disabled) return

  if (commandPalette.showMenu.value || showContextMenu.value) return

  const content = getEditorPlainText().trim()
  const allAttachments = collectAllAttachments(attachedFiles.value, attachedImages.value)

  if (!hasContent.value) return

  function cleanupAfterCommand() {
    clearEditor()
    attachedFiles.value = []
    clearImages()
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
      cleanupAfterCommand()
      emit('slash-command', commandName, userContent, allAttachments)
      return
    }

    if (chips.length === 1 && chips[0].kind === 'immediate') {
      const commandName = chips[0].label
      const userContent = content.replace(/\/cmd:"[^"]+":\w+:\w+\s*/g, '').trim()
      cleanupAfterCommand()
      emit('slash-command', commandName, userContent, allAttachments)
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
    const result = dispatchCommandChip([slashResult.chip], '')
    emit('send', result.prompt, allAttachments, {
      displayLabel: result.displayLabel
    })
    clearEditor()
  } else {
    emit('send', content, allAttachments)
  }

  clearEditor()
  attachedFiles.value = []
  clearImages()
}

// ── Prompt Stash (orchestration) ─────────────────────────────────
function handleStash() {
  promptStash.handleStash(
    getEditorPlainText().trim(),
    attachedFiles.value,
    attachedImages.value,
    editorRef.value?.innerHTML || '',
    () => { clearEditor(); attachedFiles.value = []; clearImages() },
    () => restoreStashLocal()
  )
}

function restoreStashLocal() {
  promptStash.restoreStash(
    editorRef.value,
    (files) => { attachedFiles.value = files },
    (images) => { attachedImages.value = images },
    (text) => { inputText.value = text },
    () => focusEditor()
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
onMounted(() => {
  initializeModelSelector(props.modelValue)

  // Load skills
  const skillsStore = useSkillsStore()
  skillsStore.fetchSkills(props.workingDirectory)

  // Load agents
  sessionStore.loadAgents()

  document.addEventListener('keydown', handleModelKeydown)
  window.addEventListener('session-created', focusEditor)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleModelKeydown)
  window.removeEventListener('session-created', focusEditor)
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

// Watch session changes
watch(() => sessionStore.currentSessionId, () => {
  focusEditor()
  const sid = sessionStore.currentSessionId
  if (sid && sessionStore.hasStash(sid)) {
    nextTick(() => restoreStashLocal())
  }
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
  font-size: 13px;
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
    font-size: 11px;
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

  &:focus-within {
    border-color: var(--surface-border-strong);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  }

  &.is-sending {
    opacity: 0.8;
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
  font-size: 12px;
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
  font-size: 12px;
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
  font-size: 12px;
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
    font-size: calc(var(--font-size-base) + 1px);
    line-height: 1.5;
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

    // Inline mention chip styles
    .mention-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      margin: 0 2px;
      background: var(--bg-secondary);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-xs);
      font-size: 12px;
      line-height: 1.4;
      vertical-align: baseline;
      cursor: default;
      user-select: none;
      font-family: var(--font-mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace);

      .chip-icon {
        font-size: 12px;
        line-height: 1;
        flex-shrink: 0;
      }

      .chip-name {
        max-width: 260px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
      }
    }

    // Inline command chip styles
    .command-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      margin: 0 2px;
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-xs);
      font-size: 12px;
      line-height: 1.4;
      vertical-align: baseline;
      cursor: default;
      user-select: none;
      font-family: var(--font-mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace);

      .chip-source-icon {
        font-size: 12px;
        line-height: 1;
        flex-shrink: 0;
      }

      .chip-label {
        font-weight: 600;
      }

      .chip-source-tag {
        font-size: 10px;
        opacity: 0.7;
        text-transform: capitalize;
      }

      // Kind-based colors
      &.kind-sdk_command {
        background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.08);
        border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.5);
        color: var(--accent-primary);
      }

      &.kind-codepilot_command {
        background: rgba(245, 158, 11, 0.08);
        border-color: rgba(245, 158, 11, 0.5);
        color: #f59e0b;
      }

      &.kind-agent_skill {
        background: rgba(16, 185, 129, 0.08);
        border-color: rgba(16, 185, 129, 0.5);
        color: #10b981;
      }

      &.kind-slash_command {
        background: var(--accent-secondary-glow);
        border-color: color-mix(in srgb, var(--accent-secondary) 50%, transparent);
        color: #6366f1;
      }

      &.kind-mcp_tool {
        background: rgba(245, 158, 11, 0.08);
        border-color: rgba(245, 158, 11, 0.5);
        color: #f59e0b;
      }
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
    font-size: 16px;
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
  font-size: 13px;
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
  font-size: 12px;
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
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--bg-tertiary, rgba(0, 0, 0, 0.04));
    border-radius: var(--radius-sm);
    line-height: 1.4;
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

// 模型二级子菜单（fixed 定位，从主 dropdown 右侧弹出）
.model-submenu {
  min-width: 220px;
  max-height: 360px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  z-index: 110;
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
  font-size: 11px;
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
    font-size: 13px;
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
    font-size: var(--font-size-base);
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
  font-size: 11px;
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
  font-size: 13px;
  text-align: center;
}

.dropdown-error {
  color: var(--error-color, #dc2626);
}

.retry-btn {
  padding: 6px 12px;
  background: var(--accent-primary);
  color: white;
  border-radius: var(--radius-sm);
  font-size: 12px;
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
  font-size: 13px;
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
    font-size: var(--font-size-base);
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
