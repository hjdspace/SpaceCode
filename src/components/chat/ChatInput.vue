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
    <Transition name="dropdown">
      <div
        v-if="showSlashCommandMenu"
        class="slash-command-menu"
        :style="slashMenuPosition"
        v-click-outside="closeSlashCommandMenu"
      >
        <div class="dropdown-search-box">
          <Search :size="14" class="search-icon" />
          <input
            ref="slashSearchInput"
            v-model="commandPalette.searchQuery.value"
            type="text"
            :placeholder="t('chatInput.searchCommands')"
            readonly
            tabindex="-1"
          />
          <span v-if="commandPalette.ghostText.value" class="ghost-text">{{ commandPalette.ghostText.value.suffix }}</span>
          <button v-if="commandPalette.searchQuery.value" class="clear-btn" @click="clearSlashSearch">
            <X :size="12" />
          </button>
        </div>
        <div class="dropdown-section-title">{{ t('chatInput.commands') }}</div>
        <div class="dropdown-list" ref="slashListRef">
          <div v-if="filteredSlashCommands.length === 0" class="dropdown-empty">
            <span>{{ t('chatInput.noMatchingCommands') }}</span>
          </div>
          <button
            v-for="(cmd, idx) in filteredSlashCommands"
            :key="cmd.name"
            class="dropdown-item"
            :class="{ highlighted: highlightedSlashCommand === cmd.name }"
            @click="selectSlashCommand(cmd)"
            @mouseenter="commandPalette.selectedIndex.value = idx"
          >
            <component :is="cmd.icon" :size="16" class="item-icon" />
            <div class="item-content">
              <span class="item-name">{{ cmd.name }}</span>
              <span class="item-description">{{ cmd.description }}</span>
            </div>
            <span v-if="cmd.kind === 'agent_skill'" class="item-badge skill">{{ t('chatInput.skillLabel') }}</span>
            <span v-else-if="cmd.kind === 'sdk_command'" class="item-badge sdk">SDK</span>
            <span v-else-if="cmd.kind === 'mcp_tool'" class="item-badge mcp">MCP</span>
          </button>
        </div>
        <div class="dropdown-section-divider"></div>
        <button class="dropdown-footer-item" @click="openSkillsManager">
          <Zap :size="14" class="item-icon" />
          <span>{{ t('chatInput.manageSkills') }}</span>
        </button>
      </div>
    </Transition>

    <!-- @ 上下文弹窗 -->
    <Transition name="dropdown">
      <div
        v-if="showContextMenu"
        class="context-menu"
        :style="contextMenuPosition"
        v-click-outside="closeContextMenu"
      >
        <div class="dropdown-search-box">
          <Search :size="14" class="search-icon" />
          <input
            ref="contextSearchInput"
            v-model="contextSearchQuery"
            type="text"
            :placeholder="t('chatInput.searchFiles')"
            readonly
            tabindex="-1"
          />
          <button v-if="contextSearchQuery" class="clear-btn" @click="clearContextSearch">
            <X :size="12" />
          </button>
        </div>
        <div class="dropdown-section-title">{{ t('chatInput.addContext') }}</div>
        <div class="dropdown-list" ref="contextListRef">
          <div v-if="isLoadingContext" class="dropdown-loading">
            <Loader2 :size="16" class="spin" />
            <span>{{ t('chatInput.searching') }}</span>
          </div>
          <div v-else-if="filteredContextItems.length === 0" class="dropdown-empty">
            <span>{{ t('chatInput.noMatchingFiles') }}</span>
          </div>
          <button
            v-for="item in filteredContextItems"
            :key="item.path"
            class="dropdown-item"
            :class="{ highlighted: highlightedContextItem === item.path }"
            @click="selectContextItem(item)"
            @mouseenter="highlightedContextItem = item.path"
          >
            <component
              :is="item.type === 'directory' ? Folder : FileText"
              :size="16"
              class="item-icon"
              :class="{ 'is-folder': item.type === 'directory' }"
            />
            <div class="item-content">
              <span class="item-name">{{ item.name }}</span>
              <span class="item-path">{{ item.relativePath }}</span>
            </div>
          </button>
        </div>
        <div class="dropdown-section-divider"></div>
        <button class="dropdown-footer-item" @click="handleBrowseFiles">
          <FolderOpen :size="14" class="item-icon" />
          <span>{{ t('chatInput.browseFiles') }}</span>
        </button>
      </div>
    </Transition>

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

          <!-- 模型选择器 - 使用可搜索下拉 -->
          <div class="model-selector" ref="modelSelectorRef">
            <button
              class="toolbar-btn model-btn"
              @click="toggleModelDropdown"
              :class="{ 'is-loading': isLoadingModels, 'has-error': modelLoadError }"
            >
              <Loader2 v-if="isLoadingModels" :size="14" class="loading-icon spin" />
              <span class="model-name">{{ selectedModelLabel }}</span>
              <ChevronDown :size="14" class="dropdown-icon" :class="{ open: showModelDropdown }" />
            </button>
            <!-- 模型下拉菜单 -->
            <Transition name="dropdown">
              <div v-if="showModelDropdown" class="model-dropdown" v-click-outside="closeModelDropdown">
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
                <!-- 搜索框 -->
                <div class="search-box">
                  <Search :size="14" class="search-icon" />
                  <input
                    ref="modelSearchInput"
                    v-model="modelSearchQuery"
                    type="text"
                    :placeholder="t('chatInput.searchModels')"
                    @click.stop
                    @keydown.stop
                  />
                  <button v-if="modelSearchQuery" class="clear-btn" @click.stop="modelSearchQuery = ''">
                    <X :size="12" />
                  </button>
                </div>
                <!-- 模型列表 -->
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

          <!-- 推理深度选择器 -->
          <div class="mode-selector">
            <button class="toolbar-btn mode-btn" @click="showModeDropdown = !showModeDropdown">
              <span class="mode-name">{{ selectedMode }}</span>
              <ChevronDown :size="14" class="dropdown-icon" :class="{ open: showModeDropdown }" />
            </button>
            <!-- 模式下拉菜单 -->
            <Transition name="dropdown">
              <div v-if="showModeDropdown" class="mode-dropdown" v-click-outside="closeModeDropdown">
                <div class="dropdown-list">
                  <button
                    v-for="mode in availableModes"
                    :key="mode"
                    class="dropdown-item"
                    :class="{ active: selectedMode === mode }"
                    @click="selectMode(mode)"
                  >
                    <span class="item-name">{{ mode }}</span>
                    <Check v-if="selectedMode === mode" :size="14" class="check-icon" />
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

          <!-- Agent 选择器 -->
          <div class="agent-selector" ref="agentSelectorRef">
            <button
              class="toolbar-btn agent-btn"
              @click="toggleAgentDropdown"
              :class="{ 'has-agent': selectedAgent }"
            >
              <Cpu :size="14" />
              <span class="agent-name">{{ selectedAgentLabel }}</span>
              <ChevronDown :size="14" class="dropdown-icon" :class="{ open: showAgentDropdown }" />
            </button>
            <Transition name="dropdown">
              <div v-if="showAgentDropdown" class="agent-dropdown" v-click-outside="closeAgentDropdown">
                <div class="dropdown-header">
                  <span>{{ t('chatInput.agent') }}</span>
                </div>
                <div class="dropdown-list" ref="agentListRef">
                  <!-- Default (no agent) -->
                  <button
                    class="dropdown-item"
                    :class="{ active: !selectedAgent }"
                    @click="selectAgent('')"
                    @mouseenter="highlightedAgent = ''"
                  >
                    <span class="item-name">{{ t('chatInput.default') }}</span>
                    <span class="item-desc">{{ t('chatInput.defaultAgentDesc') }}</span>
                    <Check v-if="!selectedAgent" :size="14" class="check-icon" />
                  </button>
                  <!-- Built-in agents -->
                  <template v-if="builtInAgents.length">
                    <div class="dropdown-section-label">{{ t('chatInput.builtIn') }}</div>
                    <button
                      v-for="agent in builtInAgents"
                      :key="agent.agentType"
                      class="dropdown-item"
                      :class="{ active: selectedAgent === agent.agentType, highlighted: highlightedAgent === agent.agentType }"
                      @click="selectAgent(agent.agentType)"
                      @mouseenter="highlightedAgent = agent.agentType"
                    >
                      <span class="item-name">{{ getAgentName(agent.agentType) }}</span>
                      <span class="item-desc">{{ getAgentDescription(agent.agentType, agent.description) }}</span>
                      <Check v-if="selectedAgent === agent.agentType" :size="14" class="check-icon" />
                    </button>
                  </template>
                  <!-- Custom agents -->
                  <template v-if="customAgents.length">
                    <div class="dropdown-section-label">{{ t('chatInput.custom') }}</div>
                    <button
                      v-for="agent in customAgents"
                      :key="agent.agentType"
                      class="dropdown-item"
                      :class="{ active: selectedAgent === agent.agentType, highlighted: highlightedAgent === agent.agentType }"
                      @click="selectAgent(agent.agentType)"
                      @mouseenter="highlightedAgent = agent.agentType"
                    >
                      <span class="item-name">{{ agent.agentType }}</span>
                      <span class="item-desc">{{ agent.description }}</span>
                      <Check v-if="selectedAgent === agent.agentType" :size="14" class="check-icon" />
                    </button>
                  </template>
                </div>
              </div>
            </Transition>
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

    <!-- 附件菜单弹窗 -->
    <Transition name="dropdown">
      <div v-if="showAttachmentMenu" class="attachment-menu" v-click-outside="closeAttachmentMenu">
        <button class="attachment-item" @click="handleAttachImage">
          <Image :size="16" />
          <span>添加图片</span>
        </button>
        <button class="attachment-item" @click="handleAttachFile">
          <FileText :size="16" />
          <span>{{ t('chatInput.attachFiles') }}</span>
        </button>
        <button class="attachment-item" @click="handleAttachFolder">
          <Folder :size="16" />
          <span>{{ t('chatInput.addFolderContext') }}</span>
        </button>
        <button
          v-if="showOpenProjectAction"
          type="button"
          class="attachment-item"
          @click="handleOpenProjectFolder"
        >
          <FolderOpen :size="16" />
          <span>{{ t('chatInput.openProjectFolder') }}</span>
        </button>
      </div>
    </Transition>
    
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
  ArrowUp, Plus, ChevronDown, Check, FileText, Folder, Square, X,
  Search, Loader2, RefreshCw, AlertCircle, HelpCircle, Trash2, Coins,
  Minimize2, Stethoscope, FilePlus, Zap, FolderOpen, Terminal, Settings,
  Code, GitBranch, Bug, Bookmark, Layers, MessageSquare, Eye, Cpu, Brain,
  Sparkles, Image, FileDiff, Play, FolderPlus, Download, Shield, ListTree,
  Webhook, Activity, Palette, Command, Keyboard, RotateCcw, GitCommit,
  Archive
} from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { useSkillsStore } from '@/stores/skills'
import { useMcpStore } from '@/stores/mcp'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { api } from '@/services/electronAPI'
import { useI18n } from 'vue-i18n'
import { useOpenProjectWorkflow } from '@/composables/useOpenProjectWorkflow'
import { useFileToChat } from '@/composables/useFileToChat'
import { pathBasename } from '@/utils/mention-chips'
import { normalizeApiUrl } from '@/utils/apiUrl'
import PermissionModeSelector from './PermissionModeSelector.vue'

export interface ImageAttachment {
  id: string
  name: string
  type: 'image'
  mimeType: string
  previewUrl: string
  data: string // Base64 encoded image data
}

export interface Attachment {
  name: string
  path: string
  isFolder: boolean
}

interface ModelOption {
  label: string
  value: string
}

interface SlashCommand {
  name: string
  description: string
  icon: any
  kind?: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command' | 'mcp_tool'
  immediate?: boolean
  aliases?: string[]
  source?: string
}

interface ContextItem {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
}

interface SendOptions {
  displayLabel?: string
}

interface AllAttachments {
  files: Attachment[]
  images: ImageAttachment[]
}

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
  /** Show toolbar + menu actions to open app project folder (same as welcome card). */
  showOpenProjectAction?: boolean
}>()

const settingsStore = useSettingsStore()
const skillsStore = useSkillsStore()
const mcpStore = useMcpStore()
const appStore = useAppStore()
const { t } = useI18n()
const { openProjectFromPicker } = useOpenProjectWorkflow()
const { pendingFile, consumePendingFile } = useFileToChat()

const inputText = ref('')
const editorRef = ref<HTMLElement | null>(null)
const containerRef = ref<HTMLElement | null>(null)
const showModelDropdown = ref(false)
const showModeDropdown = ref(false)
const showAttachmentMenu = ref(false)
const attachedFiles = ref<Attachment[]>([])
const attachedImages = ref<ImageAttachment[]>([])
const isDragging = ref(false)

// Stash 状态
const showStashHint = ref(false)

// 模型搜索相关
const modelSearchQuery = ref('')
const modelSearchInput = ref<HTMLInputElement | null>(null)
const modelSelectorRef = ref<HTMLElement | null>(null)
const modelListRef = ref<HTMLElement | null>(null)
const highlightedModel = ref<string | null>(null)

// 模型加载状态
const isLoadingModels = ref(false)
const modelLoadError = ref<string | null>(null)
const fetchedModels = ref<ModelOption[]>([])

// 推理深度 (effort level)
const availableModes = ['low', 'medium', 'high', 'max'] as const
type EffortMode = typeof availableModes[number]
const selectedMode = ref<EffortMode>(settingsStore.effortLevel || 'high')

// Thinking 模式
const thinkingEnabled = ref(settingsStore.thinkingEnabled)

function toggleThinking() {
  thinkingEnabled.value = !thinkingEnabled.value
  settingsStore.thinkingEnabled = thinkingEnabled.value
  settingsStore.saveSettings()

  const sid = chatStore.currentSessionId
  if (sid) {
    api.updateThinkingLevel(sid, thinkingEnabled.value).catch(() => {})
  }
}

// 工作台(截图/框选元素)推送内容到输入框
function injectFromWorkbench(payload: { text?: string; image?: ImageAttachment }) {
  if (payload.image) {
    const img: ImageAttachment = { ...payload.image, type: 'image' }
    attachedImages.value.push(img)
    editorRef.value?.focus()
    insertImageChip(img)
  }
  if (payload.text) {
    const editor = editorRef.value
    if (editor) {
      editor.focus()
      const prefix = editor.textContent && !editor.textContent.endsWith('\n') ? '\n' : ''
      editor.appendChild(document.createTextNode(prefix + payload.text))
      inputText.value = getEditorPlainText()
    }
  }
}

watch(() => appStore.pendingInputInjection, (payload) => {
  if (!payload) return
  injectFromWorkbench(payload)
  appStore.consumeInputInjection()
})

// Agent selector state
const chatStore = useChatStore()
const showAgentDropdown = ref(false)
const agentSelectorRef = ref<HTMLElement | null>(null)
const agentListRef = ref<HTMLElement | null>(null)
const highlightedAgent = ref<string>('')
const selectedAgent = ref<string>(chatStore.currentAgent || '')

function focusEditor() {
  nextTick(() => {
    const editor = editorRef.value
    if (!editor || props.disabled) return
    editor.focus()
    if (!window.getSelection()?.rangeCount) {
      setCursorToEnd()
    }
    autoResize()
  })
}

// Computed: split agents into built-in and custom
const builtInAgents = computed(() => chatStore.availableAgents.filter(a => a.source === 'built-in'))
const customAgents = computed(() => chatStore.availableAgents.filter(a => a.source !== 'built-in'))
const selectedAgentLabel = computed(() => {
  if (!selectedAgent.value) return t('chatInput.agent')
  // Try to get translated name for built-in agents
  const translatedName = t(`chatInput.agents.${selectedAgent.value}.name`)
  return translatedName !== `chatInput.agents.${selectedAgent.value}.name` ? translatedName : selectedAgent.value
})

// Helper function to get agent display name
function getAgentName(agentType: string): string {
  const translatedName = t(`chatInput.agents.${agentType}.name`)
  return translatedName !== `chatInput.agents.${agentType}.name` ? translatedName : agentType
}

// Helper function to get agent description
function getAgentDescription(agentType: string, originalDescription: string): string {
  const translatedDesc = t(`chatInput.agents.${agentType}.description`)
  return translatedDesc !== `chatInput.agents.${agentType}.description` ? translatedDesc : originalDescription
}

// 斜杠命令相关
const slashSearchInput = ref<HTMLInputElement | null>(null)
const slashListRef = ref<HTMLElement | null>(null)
const slashTriggerPosition = ref<number>(-1)
const slashMenuPosition = ref<{ top?: string; bottom?: string; left: string }>({ top: '0px', left: '0px' })

// @ 上下文相关
const showContextMenu = ref(false)
const contextSearchQuery = ref('')
const contextSearchInput = ref<HTMLInputElement | null>(null)
const contextListRef = ref<HTMLElement | null>(null)
const highlightedContextItem = ref<string | null>(null)
const contextTriggerPosition = ref<number>(-1)
const contextMenuPosition = ref<{ top?: string; bottom?: string; left: string }>({ top: '0px', left: '0px' })
const contextItems = ref<ContextItem[]>([])
const isLoadingContext = ref(false)

// 使用新的命令系统
import { BUILT_IN_COMMANDS } from '@/lib/constants/commands'
import { resolveDirectSlash, dispatchCommandChip, type CommandChipData } from '@/lib/message-input-logic'
import type { CommandKind } from '@/lib/constants/commands'
import { useCommandPalette } from '@/composables/useCommandPalette'
import type { UnifiedCommand } from '@/lib/commands/types'

const commandPalette = useCommandPalette()

// Icon mapping for commands
const iconMap: Record<string, any> = {
  HelpCircle, Trash2, Coins, Minimize2, Stethoscope, FilePlus, Zap, Layers,
  Terminal, Settings, Code, GitBranch, Bug, Bookmark, Eye, Cpu, MessageSquare,
  FileDiff, Play, FolderPlus, Download, Shield, ListTree, Webhook, FileText,
  Activity, Palette, Command, Keyboard, RotateCcw, GitCommit
}

const builtinSlashCommands = computed<SlashCommand[]>(() => {
  return BUILT_IN_COMMANDS.map(cmd => ({
    name: cmd.name,
    description: cmd.description,
    icon: (cmd.icon && iconMap[cmd.icon]) || Zap,
    kind: cmd.kind,
    immediate: cmd.immediate,
    aliases: cmd.aliases
  }))
})

const skillCommands = computed<SlashCommand[]>(() => {
  return skillsStore.skills.map(skill => ({
    name: skill.name,
    description: skill.description || `${t('chatInput.skillLabel')}: /${skill.name}`,
    icon: Zap,
    kind: 'agent_skill' as const,
    source: 'skill',
  }))
})

const mcpCommands = computed<SlashCommand[]>(() => {
  return mcpStore.allMcpTools.map(({ serverName, tool }) => ({
    name: tool.name,
    description: tool.description || `MCP: ${serverName}`,
    icon: Webhook,
    kind: 'mcp_tool' as const,
    source: 'mcp',
  }))
})

const allSlashCommands = computed<SlashCommand[]>(() => {
  return [...builtinSlashCommands.value, ...skillCommands.value, ...mcpCommands.value]
})

const filteredSlashCommands = computed<SlashCommand[]>(() => {
  const query = commandPalette.searchQuery.value
  if (!query) return allSlashCommands.value
  return commandPalette.filteredCommands.value.map(cmd => {
    const icon = (cmd.icon && iconMap[cmd.icon]) || Zap
    return {
      name: cmd.name,
      description: cmd.description,
      icon,
      kind: cmd.kind,
      immediate: cmd.immediate,
      aliases: cmd.aliases,
    }
  })
})

const showSlashCommandMenu = computed({
  get: () => commandPalette.showMenu.value,
  set: (val: boolean) => { if (!val) commandPalette.closeMenu() }
})

const slashSearchQuery = computed(() => commandPalette.searchQuery.value)

const highlightedSlashCommand = computed(() => commandPalette.highlightedName.value)

// 过滤后的上下文项（服务端已搜索，客户端直接使用）
const filteredContextItems = computed<ContextItem[]>(() => {
  return contextItems.value
})

// 硬编码的默认模型（作为后备）
const defaultModels = computed<ModelOption[]>(() => {
  const models: ModelOption[] = []

  switch (settingsStore.authMethod) {
    case 'anthropic_compatible':
    case 'claudeai':
    case 'console':
      models.push(
        { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
        { label: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' },
        { label: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
        { label: 'Claude 3 Sonnet', value: 'claude-3-sonnet-20240229' },
        { label: 'Claude 3 Haiku', value: 'claude-3-haiku-20240307' }
      )
      break
    case 'openai_compatible':
      models.push(
        { label: 'GPT-4', value: 'gpt-4' },
        { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
        { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' }
      )
      break
    case 'gemini_api':
      models.push(
        { label: 'Gemini Pro', value: 'gemini-pro' },
        { label: 'Gemini Pro Vision', value: 'gemini-pro-vision' }
      )
      break
  }

  return models
})

// 合并 fetched models 和默认模型
const availableModels = computed<ModelOption[]>(() => {
  const models = [...fetchedModels.value]

  // 添加默认模型中不在 fetched models 中的
  defaultModels.value.forEach(defaultModel => {
    if (!models.some(m => m.value === defaultModel.value)) {
      models.push(defaultModel)
    }
  })

  // 添加用户自定义配置的模型
  let customModel = ''
  switch (settingsStore.authMethod) {
    case 'anthropic_compatible':
      customModel = settingsStore.anthropicConfig.sonnetModel
      break
    case 'openai_compatible':
      customModel = settingsStore.openaiConfig.sonnetModel
      break
    case 'gemini_api':
      customModel = settingsStore.geminiConfig.sonnetModel
      break
  }

  if (customModel && !models.some(m => m.value === customModel)) {
    models.unshift({ label: customModel, value: customModel })
  }

  return models
})

// 搜索过滤后的模型列表
const filteredModels = computed<ModelOption[]>(() => {
  if (!modelSearchQuery.value) return availableModels.value
  const query = modelSearchQuery.value.toLowerCase()
  return availableModels.value.filter(model =>
    model.label.toLowerCase().includes(query) ||
    model.value.toLowerCase().includes(query)
  )
})

// 判断是否可以刷新模型列表
const canRefreshModels = computed(() => {
  switch (settingsStore.authMethod) {
    case 'anthropic_compatible':
      return !!(settingsStore.anthropicConfig.baseUrl && settingsStore.anthropicConfig.apiKey)
    case 'openai_compatible':
      return !!(settingsStore.openaiConfig.baseUrl && settingsStore.openaiConfig.apiKey)
    case 'gemini_api':
      return !!(settingsStore.geminiConfig.baseUrl && settingsStore.geminiConfig.apiKey)
    default:
      return false
  }
})

const selectedModel = ref('')

// 初始化选中的模型
onMounted(() => {
  const config = settingsStore.config
  selectedModel.value = props.modelValue || config.model || availableModels.value[0]?.value || ''

  // 尝试从 BASE_URL 获取模型列表
  fetchModelsFromBaseUrl()

  // 加载技能列表
  skillsStore.fetchSkills(props.workingDirectory)

  // 加载可用的 Agent 列表
  chatStore.loadAgents()
})

// 监听回滚后的待恢复输入文本（将用户消息恢复到输入框）
watch(() => chatStore.pendingInputText, (newText) => {
  if (newText && newText.trim()) {
    // 填充文本到输入框
    inputText.value = newText

    // 更新编辑器内容
    nextTick(() => {
      if (editorRef.value) {
        editorRef.value.innerHTML = newText.replace(/\n/g, '<br>')
      }
      // 聚焦输入框
      editorRef.value?.focus()
    })

    // 清除pendingInputText，避免重复填充
    chatStore.clearPendingInputText()
  }
})

// 监听外部 modelValue 变化
watch(() => props.modelValue, (newValue) => {
  if (newValue && newValue !== selectedModel.value) {
    selectedModel.value = newValue
  }
})

// 监听认证方式变化，重新获取模型
watch(() => settingsStore.authMethod, () => {
  fetchedModels.value = []
  modelLoadError.value = null
  fetchModelsFromBaseUrl()
})

// 监听 settings store effortLevel 变化，同步到 selectedMode
watch(() => settingsStore.effortLevel, (newLevel) => {
  if (newLevel && newLevel !== selectedMode.value) {
    selectedMode.value = newLevel
  }
}, { immediate: true })

const selectedModelLabel = computed(() => {
  const model = availableModels.value.find(m => m.value === selectedModel.value)
  return model?.label || selectedModel.value || t('model.selectModel')
})

const hasContent = computed(() => {
  if (inputText.value.trim().length > 0) return true
  if (attachedFiles.value.length > 0) return true

  const editor = editorRef.value
  if (!editor) return false
  if (editor.textContent?.trim()) return true
  return editor.querySelectorAll('.mention-chip, .command-chip').length > 0
})
const canSend = computed(() => (hasContent.value) && !props.isSending)

// Prompt optimizer state
const isOptimizing = ref(false)

// ─── ContentEditable Utilities ───────────────────────────────

/** Extract plain text from contenteditable, replacing chips with @path markers */
function getEditorPlainText(): string {
  const editor = editorRef.value
  if (!editor) return ''

  function walkNodes(parent: Node): string {
    let text = ''
    for (const node of Array.from(parent.childNodes)) {
      if (node instanceof Element && node.classList.contains('mention-chip')) {
        const path = node.getAttribute('data-path')
        const imageId = node.getAttribute('data-image-id')

        if (imageId) {
          text += `@image:"${imageId}" `
        } else if (path) {
          const isFolder = node.getAttribute('data-is-folder') === 'true'
          text += isFolder ? `@folder:"${path}" ` : `@file:"${path}" `
        }
      } else if (node instanceof Element && node.classList.contains('command-chip')) {
        // Serialize command chip as /cmd:"name":kind:source
        const command = node.getAttribute('data-command') || ''
        const kind = node.getAttribute('data-kind') || 'slash_command'
        const source = node.getAttribute('data-source') || 'builtin'
        const name = command.startsWith('/') ? command.slice(1) : command
        text += `/cmd:"${name}":${kind}:${source} `
      } else if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || ''
      } else if (node instanceof Element && node.tagName === 'BR') {
        text += '\n'
      } else if (node instanceof Element) {
        // Recursively handle nested elements (e.g., <div> from Enter key)
        text += walkNodes(node)
        // Add newline after block elements (except last)
        if (node.tagName === 'DIV' && node.nextSibling) {
          text += '\n'
        }
      }
    }
    return text
  }

  return walkNodes(editor)
}

/** Collect all attachments (files and images) from editor */
function collectAllAttachments() {
  const mentions = collectMentions()
  return {
    files: mentions,
    images: [...attachedImages.value]
  }
}

/** Extract text before cursor in the contenteditable */
function getTextBeforeCursor(): string {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return ''

  const range = sel.getRangeAt(0)
  const preRange = range.cloneRange()
  preRange.selectNodeContents(editorRef.value!)
  preRange.setEnd(range.startContainer, range.startOffset)
  return preRange.toString()
}

/** Get cursor offset relative to editor text content start */
function getCursorOffset(): number {
  return getTextBeforeCursor().length
}

/** Set cursor to end of editor content */
function setCursorToEnd() {
  const editor = editorRef.value
  if (!editor) return
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

/** Insert an inline mention chip at current cursor position */
function insertMentionChip(name: string, path: string, isFolder: boolean) {
  const editor = editorRef.value
  if (!editor) return

  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return

  const range = sel.getRangeAt(0)

  // Create the chip span
  const chip = document.createElement('span')
  chip.className = `mention-chip${isFolder ? ' is-folder' : ''}`
  chip.setAttribute('contenteditable', 'false')
  chip.setAttribute('data-path', path)
  chip.setAttribute('data-is-folder', String(isFolder))

  // Inner structure: icon + name
  const icon = document.createElement('span')
  icon.className = 'chip-icon'
  // Use a simple text marker; Vue can't hydrate inside contenteditable
  icon.textContent = isFolder ? '📁' : '📄'

  const nameSpan = document.createElement('span')
  nameSpan.className = 'chip-name'
  nameSpan.textContent = name

  chip.appendChild(icon)
  chip.appendChild(nameSpan)

  // Insert chip and a trailing space
  range.deleteContents()
  range.insertNode(chip)

  // Move cursor after chip
  const afterRange = document.createRange()
  afterRange.setStartAfter(chip)
  afterRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(afterRange)

  // Insert trailing space
  const spaceNode = document.createTextNode('\u00A0')
  afterRange.insertNode(spaceNode)

  // Move cursor after space
  const finalRange = document.createRange()
  finalRange.setStartAfter(spaceNode)
  finalRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(finalRange)

  // Sync plain text
  inputText.value = getEditorPlainText()
}

/** Insert an inline command chip at current cursor position */
function insertCommandChip(cmd: { name: string; kind?: string; source?: string }) {
  const editor = editorRef.value
  if (!editor) return

  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return

  const range = sel.getRangeAt(0)

  const kind = cmd.kind || 'slash_command'
  const source = cmd.source || 'builtin'

  // Source icon mapping
  const sourceIcons: Record<string, string> = {
    builtin: '⚡',
    bundled: '📦',
    global: '🌐',
    project: '📂',
    plugin: '🧩',
    mcp: '🔌',
  }

  // Create the chip span
  const chip = document.createElement('span')
  chip.className = `command-chip kind-${kind} source-${source}`
  chip.setAttribute('contenteditable', 'false')
  chip.setAttribute('data-command', `/${cmd.name}`)
  chip.setAttribute('data-kind', kind)
  chip.setAttribute('data-source', source)

  // Inner structure: source-icon + label
  const iconSpan = document.createElement('span')
  iconSpan.className = 'chip-source-icon'
  iconSpan.textContent = sourceIcons[source] || '⚡'

  const labelSpan = document.createElement('span')
  labelSpan.className = 'chip-label'
  labelSpan.textContent = `/${cmd.name}`

  chip.appendChild(iconSpan)
  chip.appendChild(labelSpan)

  // Insert chip and a trailing space
  range.deleteContents()
  range.insertNode(chip)

  // Move cursor after chip
  const afterRange = document.createRange()
  afterRange.setStartAfter(chip)
  afterRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(afterRange)

  // Insert trailing space
  const spaceNode = document.createTextNode('\u00A0')
  afterRange.insertNode(spaceNode)

  // Move cursor after space
  const finalRange = document.createRange()
  finalRange.setStartAfter(spaceNode)
  finalRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(finalRange)

  // Sync plain text
  inputText.value = getEditorPlainText()
}

/** Remove a chip when its close button is clicked (not used inline — backspace handles it) */
function removeChipAtElement(chipEl: Element) {
  const editor = editorRef.value
  if (!editor) return

  // Remove trailing space if exists
  const next = chipEl.nextSibling
  if (next && next.nodeType === Node.TEXT_NODE && next.textContent === '\u00A0') {
    next.remove()
  }
  chipEl.remove()
  inputText.value = getEditorPlainText()
}

/** Set editor content from plain text (used for clearing) */
function setEditorContent(text: string) {
  const editor = editorRef.value
  if (!editor) return
  editor.textContent = text
  inputText.value = text
}

/** Clear editor content */
function clearEditor() {
  const editor = editorRef.value
  if (!editor) return
  editor.innerHTML = ''
  inputText.value = ''
}

/** Collect all mention chips data from editor */
function collectMentions(): Attachment[] {
  const editor = editorRef.value
  if (!editor) return []
  const chips = editor.querySelectorAll('.mention-chip')
  return Array.from(chips).map(chip => ({
    name: chip.querySelector('.chip-name')?.textContent || '',
    path: chip.getAttribute('data-path') || '',
    isFolder: chip.getAttribute('data-is-folder') === 'true'
  }))
}

// 从 BASE_URL 获取模型列表
async function fetchModelsFromBaseUrl() {
  if (!canRefreshModels.value) return

  isLoadingModels.value = true
  modelLoadError.value = null

  try {
    let baseUrl = ''
    let apiKey = ''
    let provider = ''

    switch (settingsStore.authMethod) {
      case 'anthropic_compatible':
        baseUrl = settingsStore.anthropicConfig.baseUrl || 'https://api.anthropic.com'
        apiKey = settingsStore.anthropicConfig.apiKey
        provider = 'anthropic'
        break
      case 'openai_compatible':
        baseUrl = settingsStore.openaiConfig.baseUrl || 'https://api.openai.com/v1'
        apiKey = settingsStore.openaiConfig.apiKey
        provider = 'openai'
        break
      case 'gemini_api':
        baseUrl = settingsStore.geminiConfig.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
        apiKey = settingsStore.geminiConfig.apiKey
        provider = 'gemini'
        break
    }

    if (!apiKey) {
      modelLoadError.value = t('chatInput.configureApiKeyFirst')
      return
    }

    // 规范化API URL，确保包含正确的版本路径
    const normalizedUrl = normalizeApiUrl(baseUrl, provider)
    const url = `${normalizedUrl}/models`
    const result = await api.httpFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!result) {
      modelLoadError.value = t('chatInput.httpProxyUnavailable')
      return
    }

    if (result.ok) {
      const data = JSON.parse(result.data)
      let models: any[] = []

      // 处理不同 API 的响应格式
      if (Array.isArray(data)) {
        models = data
      } else if (data.data && Array.isArray(data.data)) {
        models = data.data
      } else if (data.models && Array.isArray(data.models)) {
        models = data.models
      }

      if (models.length > 0) {
        fetchedModels.value = models.map((m: any) => ({
          label: m.name || m.id || String(m),
          value: m.id || m.name || String(m)
        }))
      }
    } else {
      modelLoadError.value = t('chatInput.fetchFailed', { status: result.status })
    }
  } catch (error) {
    console.error('[ChatInput] Failed to fetch models:', error)
    modelLoadError.value = error instanceof Error ? error.message : t('auth.networkError')
  } finally {
    isLoadingModels.value = false
  }
}

// 刷新模型列表
function refreshModels() {
  fetchModelsFromBaseUrl()
}

// 优化提示词
async function handleOptimizePrompt() {
  const prompt = getEditorPlainText().trim()
  if (!prompt || isOptimizing.value) return

  isOptimizing.value = true

  try {
    const result = await api.optimizePrompt(prompt, {
      workingDirectory: props.workingDirectory,
    })

    if (result.success && result.result) {
      setEditorContent(result.result)
      autoResize()
    } else {
      console.error('Prompt optimization failed:', result.error)
    }
  } catch (error) {
    console.error('Prompt optimization error:', error)
  } finally {
    isOptimizing.value = false
  }
}

// 切换模型下拉菜单
function toggleModelDropdown() {
  showModelDropdown.value = !showModelDropdown.value
  if (showModelDropdown.value) {
    nextTick(() => {
      modelSearchInput.value?.focus()
      highlightedModel.value = selectedModel.value
    })
  }
}

// 处理输入
function handleEditorInput() {
  inputText.value = getEditorPlainText()
  autoResize()
  checkSlashTrigger()
  checkContextTrigger()
}

// 自动调整高度
function autoResize() {
  const editor = editorRef.value
  if (editor) {
    // Reset height to auto to get correct scrollHeight
    editor.style.height = 'auto'
    editor.style.height = Math.min(editor.scrollHeight, 200) + 'px'
  }
}

// 检查斜杠触发
function checkSlashTrigger() {
  const editor = editorRef.value
  if (!editor) return

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

// 检查 @ 上下文触发
function checkContextTrigger() {
  const editor = editorRef.value
  if (!editor) return

  const textBeforeCursor = getTextBeforeCursor()

  // 查找最近的 @ 符号
  const lastAtIndex = textBeforeCursor.lastIndexOf('@')
  if (lastAtIndex === -1) {
    closeContextMenu()
    return
  }

  // 检查 @ 后面是否只有合法的文件名字符
  const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
  const hasInvalidChar = /[\s\n]/.test(textAfterAt)

  if (hasInvalidChar || commandPalette.showMenu.value) {
    closeContextMenu()
    return
  }

  // 显示上下文菜单
  const wasClosed = !showContextMenu.value
  const previousQuery = contextSearchQuery.value
  contextTriggerPosition.value = lastAtIndex
  showContextMenu.value = true
  contextSearchQuery.value = textAfterAt

  // Search when: menu just opened, or query changed
  if (wasClosed || textAfterAt !== previousQuery) {
    loadContextItems()
  }

  nextTick(() => {
    updateContextMenuPosition()
    editorRef.value?.focus()
  })
}

// 加载上下文项目（文件和文件夹）- 递归搜索整个工作区
let searchAbortController: AbortController | null = null

async function loadContextItems() {
  if (!props.workingDirectory) return

  // Cancel previous search if still in flight
  if (searchAbortController) {
    searchAbortController = null
  }

  isLoadingContext.value = true
  try {
    const query = contextSearchQuery.value
    const entries = await api.searchFiles(props.workingDirectory, query, { maxResults: 100 })

    // Check if this search is still current (user hasn't closed the menu)
    if (!showContextMenu.value) return

    const items: ContextItem[] = entries.map(entry => ({
      name: entry.name,
      path: entry.path,
      relativePath: entry.relativePath,
      type: entry.isDirectory ? 'directory' : 'file'
    }))

    contextItems.value = items
    if (items.length > 0) {
      highlightedContextItem.value = items[0].path
    } else {
      highlightedContextItem.value = null
    }
  } catch (error) {
    console.error('Failed to load context items:', error)
    contextItems.value = []
  } finally {
    isLoadingContext.value = false
  }
}

// 更新斜杠菜单位置 - 在输入框上方弹出，与容器左对齐
function updateSlashMenuPosition() {
  const container = containerRef.value
  const editor = editorRef.value
  if (!container || !editor) return

  const containerRect = container.getBoundingClientRect()
  const editorRect = editor.getBoundingClientRect()

  // 菜单从输入框顶部向上弹出，与容器左边缘对齐
  slashMenuPosition.value = {
    bottom: `${window.innerHeight - editorRect.top + 8}px`,
    left: `${containerRect.left}px`
  }
}

// 更新上下文菜单位置 - 在输入框上方弹出，与容器左对齐
function updateContextMenuPosition() {
  const container = containerRef.value
  const editor = editorRef.value
  if (!container || !editor) return

  const containerRect = container.getBoundingClientRect()
  const editorRect = editor.getBoundingClientRect()

  // 菜单从输入框顶部向上弹出，与容器左边缘对齐
  contextMenuPosition.value = {
    bottom: `${window.innerHeight - editorRect.top + 8}px`,
    left: `${containerRect.left}px`
  }
}

// 选择斜杠命令
function selectSlashCommand(cmd: SlashCommand) {
  if (cmd.immediate || cmd.kind === 'immediate') {
    commandPalette.closeMenu()
    clearEditor()
    const attachments = collectAllAttachments()
    emit('slash-command', cmd.name, '', attachments)
    return
  }

  commandPalette.closeMenu()

  // Remove the /trigger text from editor
  const editor = editorRef.value
  if (editor) {
    const text = getEditorPlainText()
    const slashMatch = text.match(/(^|\s)\/([^\s]*)$/)
    if (slashMatch) {
      const triggerOffset = slashMatch.index! + (slashMatch[1] ? 1 : 0)
      removeTriggerText(triggerOffset, slashMatch[0].length - (slashMatch[1] ? 1 : 0))
    }
  }

  // Insert inline command chip
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

// 选择上下文项 — 在光标位置插入 inline mention chip
function selectContextItem(item: ContextItem) {
  const editor = editorRef.value
  if (!editor) return

  // First, remove the @trigger and search text from the editor
  removeTriggerText(contextTriggerPosition.value, contextSearchQuery.value.length + 1) // +1 for @ char

  closeContextMenu()

  // Insert inline chip at current cursor position
  insertMentionChip(item.relativePath || item.name, item.path, item.type === 'directory')

  // Also add to attachedFiles for the send logic
  if (!attachedFiles.value.some(f => f.path === item.path)) {
    attachedFiles.value.push({
      name: item.relativePath || item.name,
      path: item.path,
      isFolder: item.type === 'directory'
    })
  }

  // 聚焦回 editor
  nextTick(() => {
    editorRef.value?.focus()
    setCursorToEnd()
  })
}

/** Remove trigger text (@query or /query) from contenteditable by character offset
 *  Offset is relative to ALL plain text content (including mention-chip text)
 *  After removal, places cursor at the position where trigger was removed */
function removeTriggerText(triggerOffset: number, length: number) {
  const editor = editorRef.value
  if (!editor) return

  // Walk text nodes to find the trigger position and remove it
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null)
  let charCount = 0
  let node: Text | null
  let remaining = length
  let cursorNode: Text | null = null
  let cursorOffset = 0

  while ((node = walker.nextNode() as Text | null)) {
    const nodeLen = node.textContent?.length || 0

    if (charCount + nodeLen > triggerOffset && remaining > 0) {
      const startInNode = Math.max(0, triggerOffset - charCount)
      const deleteLen = Math.min(remaining, nodeLen - startInNode)

      if (node.textContent) {
        const before = node.textContent.slice(0, startInNode)
        const after = node.textContent.slice(startInNode + deleteLen)
        node.textContent = before + after
        remaining -= deleteLen
      }

      // Record where to place cursor after deletion (at the start of removed text)
      if (!cursorNode) {
        cursorNode = node
        cursorOffset = startInNode
      }

      if (remaining <= 0) break
    }
    charCount += nodeLen
  }

  // Place cursor at the position where trigger was removed
  if (cursorNode) {
    const sel = window.getSelection()
    if (sel) {
      const range = document.createRange()
      range.setStart(cursorNode, cursorOffset)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }
}

// 关闭斜杠命令菜单
function closeSlashCommandMenu() {
  commandPalette.closeMenu()
  slashTriggerPosition.value = -1
}

// 关闭上下文菜单
function closeContextMenu() {
  showContextMenu.value = false
  contextSearchQuery.value = ''
  contextTriggerPosition.value = -1
  highlightedContextItem.value = null
}

// 处理图片文件读取为 base64
function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 创建图片附件对象
function createImageAttachment(file: File, dataUrl: string): ImageAttachment {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    type: 'image',
    mimeType: file.type,
    previewUrl: dataUrl,
    data: dataUrl
  }
}

// 处理单个图片文件
async function handleImageFile(file: File) {
  if (!file.type.startsWith('image/')) return
  
  try {
    const dataUrl = await readImageAsDataUrl(file)
    const imageAttachment = createImageAttachment(file, dataUrl)
    attachedImages.value.push(imageAttachment)
    insertImageChip(imageAttachment)
  } catch (error) {
    console.error('Failed to read image file:', error)
  }
}

// 插入图片 chip
function insertImageChip(image: ImageAttachment) {
  const editor = editorRef.value
  if (!editor) return
  
  const chip = document.createElement('span')
  chip.className = 'mention-chip is-image'
  chip.setAttribute('data-image-id', image.id)
  chip.setAttribute('contenteditable', 'false')
  
  const icon = document.createElement('span')
  icon.className = 'chip-icon'
  icon.textContent = '🖼️'
  
  const name = document.createElement('span')
  name.className = 'chip-name'
  name.textContent = image.name
  
  chip.appendChild(icon)
  chip.appendChild(name)
  
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    range.deleteContents()
    range.insertNode(chip)
    
    // 添加尾随空格
    const space = document.createTextNode('\u00A0')
    range.collapse(false)
    range.insertNode(space)
    
    // 移动光标到空格后
    const finalRange = document.createRange()
    finalRange.setStartAfter(space)
    finalRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(finalRange)
  } else {
    editor.appendChild(chip)
    editor.appendChild(document.createTextNode('\u00A0'))
  }
  
  inputText.value = getEditorPlainText()
}

/**
 * Build a mention chip element from a marker (`@file:"..."`, `@folder:"..."`,
 * `@image:"..."`). Mirrors the structure produced by `insertMentionChip` /
 * `insertImageChip` so chips pasted from a previously sent message round-trip
 * back into the editor identically.
 */
function buildChipElementFromMarker(kind: 'file' | 'folder' | 'image', value: string): HTMLElement {
  const isFolder = kind === 'folder'
  const isImage = kind === 'image'
  const chip = document.createElement('span')
  let className = 'mention-chip'
  if (isFolder) className += ' is-folder'
  if (isImage) className += ' is-image'
  chip.className = className
  chip.setAttribute('contenteditable', 'false')
  if (isImage) {
    chip.setAttribute('data-image-id', value)
  } else {
    chip.setAttribute('data-path', value)
    chip.setAttribute('data-is-folder', String(isFolder))
  }

  const icon = document.createElement('span')
  icon.className = 'chip-icon'
  icon.textContent = isImage ? '🖼️' : (isFolder ? '📁' : '📄')

  const nameSpan = document.createElement('span')
  nameSpan.className = 'chip-name'
  // Display the trailing path segment for files/folders; image markers carry an id,
  // so we fall back to the id itself (the original sender's preview is not available).
  nameSpan.textContent = isImage ? value : (pathBasename(value) || value)

  chip.appendChild(icon)
  chip.appendChild(nameSpan)
  return chip
}

/** Insert pasted plain text at the cursor, converting any mention markers back into chips. */
function insertPastedTextWithMarkers(text: string) {
  if (!text) return
  const MARKER_RE = /@(file|folder|image):"([^"]+)"/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let inserted = false

  while ((match = MARKER_RE.exec(text)) !== null) {
    const [full, kind, value] = match
    const before = text.slice(lastIndex, match.index)
    if (before) {
      document.execCommand('insertText', false, before)
    }

    const chip = buildChipElementFromMarker(kind as 'file' | 'folder' | 'image', value)
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      range.insertNode(chip)
      const after = document.createRange()
      after.setStartAfter(chip)
      after.collapse(true)
      sel.removeAllRanges()
      sel.addRange(after)
    } else {
      editorRef.value?.appendChild(chip)
    }

    lastIndex = match.index + full.length
    inserted = true
  }

  const tail = text.slice(lastIndex)
  if (tail) {
    document.execCommand('insertText', false, tail)
  }

  if (inserted) {
    inputText.value = getEditorPlainText()
  }
}

// 处理粘贴事件 - 支持粘贴图片
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
          handleImageFile(file)
        }
      }
    }

    // 如果没有图片，继续处理文本（识别 @file/@folder/@image 标记并还原为 chip）
    if (!hasImage) {
      const text = e.clipboardData?.getData('text/plain') || ''
      insertPastedTextWithMarkers(text)
    }
  } else {
    // 回退到普通文本粘贴
    const text = e.clipboardData?.getData('text/plain') || ''
    insertPastedTextWithMarkers(text)
  }
}

// Handle click in editor
function handleEditorClick() {
  setTimeout(() => {
    checkSlashTrigger()
    checkContextTrigger()
  }, 0)
}

// 清除斜杠搜索 - 同时清除输入框中的 /
function clearSlashSearch() {
  const queryLen = commandPalette.searchQuery.value.length
  commandPalette.updateSearch('')
  if (slashTriggerPosition.value >= 0) {
    removeTriggerText(slashTriggerPosition.value, queryLen + 1)
    inputText.value = getEditorPlainText()
    editorRef.value?.focus()
  }
}

// 清除上下文搜索 - 同时清除输入框中的 @
function clearContextSearch() {
  const queryLen = contextSearchQuery.value.length
  contextSearchQuery.value = ''
  if (contextTriggerPosition.value >= 0) {
    removeTriggerText(contextTriggerPosition.value, queryLen + 1) // +1 for @
    inputText.value = getEditorPlainText()
    editorRef.value?.focus()
  }
}

// 处理斜杠命令键盘事件
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

// 处理上下文键盘事件
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

// 导航斜杠命令
function navigateSlashCommands(direction: number) {
  if (direction > 0) {
    commandPalette.navigateDown()
  } else {
    commandPalette.navigateUp()
  }

  nextTick(() => {
    const highlightedEl = slashListRef.value?.querySelector('.highlighted')
    highlightedEl?.scrollIntoView({ block: 'nearest' })
  })
}

// 导航上下文项
function navigateContextItems(direction: number) {
  const items = filteredContextItems.value
  if (items.length === 0) return

  const currentIndex = items.findIndex(i => i.path === highlightedContextItem.value)
  let newIndex = currentIndex + direction

  if (newIndex < 0) newIndex = items.length - 1
  if (newIndex >= items.length) newIndex = 0

  highlightedContextItem.value = items[newIndex].path

  nextTick(() => {
    const highlightedEl = contextListRef.value?.querySelector('.highlighted')
    highlightedEl?.scrollIntoView({ block: 'nearest' })
  })
}

// 打开技能管理器
function openSkillsManager() {
  commandPalette.closeMenu()
  emit('open-skills')
}

// 浏览文件
async function handleBrowseFiles() {
  closeContextMenu()
  try {
    const result = await api.selectFiles()
    if (!result.canceled && result.filePaths.length > 0) {
      for (const filePath of result.filePaths) {
        const name = props.workingDirectory
          ? filePath.replace(props.workingDirectory, '').replace(/^[/\\]/, '')
          : filePath.split(/[/\\]/).pop() || filePath

        // 避免重复添加
        if (!attachedFiles.value.some(f => f.path === filePath)) {
          attachedFiles.value.push({
            name,
            path: filePath,
            isFolder: false
          })
          // Insert inline chip
          insertMentionChip(name, filePath, false)
        }
      }
    }
  } catch (error) {
    console.error('Failed to browse files:', error)
  }
}

// 处理 editor 键盘事件
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

  // 处理上下文菜单的键盘导航
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

  // Enter without Shift = send
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
    return
  }

  // Shift+Enter = newline (default contenteditable behavior)

  // Backspace: if cursor is right after a chip, delete the whole chip
  if (event.key === 'Backspace') {
    const sel = window.getSelection()
    if (sel && sel.isCollapsed && sel.rangeCount) {
      const range = sel.getRangeAt(0)
      const container = range.startContainer
      const offset = range.startOffset

      // Check if cursor is right after a mention-chip
      let nodeBefore: Node | null = null
      if (container.nodeType === Node.TEXT_NODE && offset === 0) {
        // Cursor at start of text node, check previous sibling
        nodeBefore = container.previousSibling
      } else if (container.nodeType === Node.ELEMENT_NODE && offset > 0) {
        // Cursor inside element, check child at offset-1
        nodeBefore = container.childNodes[offset - 1]
      }

      if (nodeBefore && nodeBefore instanceof Element && (nodeBefore.classList.contains('mention-chip') || nodeBefore.classList.contains('command-chip'))) {
        event.preventDefault()
        // Also remove trailing space
        const nextSib = nodeBefore.nextSibling
        if (nextSib && nextSib.nodeType === Node.TEXT_NODE && nextSib.textContent === '\u00A0') {
          nextSib.remove()
        }
        nodeBefore.remove()
        inputText.value = getEditorPlainText()

        // Also remove from attachedFiles or attachedImages (mention-chip only)
        if (nodeBefore.classList.contains('mention-chip')) {
          const path = nodeBefore.getAttribute('data-path')
          if (path) {
            const idx = attachedFiles.value.findIndex(f => f.path === path)
            if (idx >= 0) attachedFiles.value.splice(idx, 1)
          }

          const imageId = nodeBefore.getAttribute('data-image-id')
          if (imageId) {
            const idx = attachedImages.value.findIndex(img => img.id === imageId)
            if (idx >= 0) attachedImages.value.splice(idx, 1)
          }
        }
      }
    }
  }
}

function handleSendOrStop() {
  console.log('[ChatInput] handleSendOrStop called, isSending:', props.isSending)
  // 如果正在发送中，点击按钮应该停止
  if (props.isSending) {
    console.log('[ChatInput] Emitting stop event')
    emit('stop')
    return
  }
  handleSend()
}

function handleSend() {
  if (props.isSending || isOptimizing.value) return
  if (!hasContent.value && !props.isSending) return
  if (props.disabled) return

  // 如果有打开的斜杠命令菜单或上下文菜单，不执行发送（让菜单处理回车事件）
  if (commandPalette.showMenu.value || showContextMenu.value) return

  function cleanupAfterCommand() {
    clearEditor()
    attachedFiles.value = []
    attachedImages.value = []
  }

  const content = getEditorPlainText().trim()
  const allAttachments = collectAllAttachments()

  // 检查编辑器中是否有 command-chip
  const editor = editorRef.value
  const commandChips = editor ? Array.from(editor.querySelectorAll('.command-chip')) : []

  if (commandChips.length > 0) {
    // 从 chip DOM 提取命令信息
    const chips: CommandChipData[] = commandChips.map((el) => ({
      command: el.getAttribute('data-command') || '',
      label: (el.getAttribute('data-command') || '').replace(/^\//, ''),
      kind: (el.getAttribute('data-kind') || 'slash_command') as CommandKind,
      source: el.getAttribute('data-source') || 'builtin',
    }))

    // 检查是否是 sdk_command — 直接 emit slash-command
    if (chips.length === 1 && chips[0].kind === 'sdk_command') {
      const commandName = chips[0].label
      const userContent = content.replace(/\/cmd:"[^"]+":\w+:\w+\s*/g, '').trim()
      cleanupAfterCommand()
      emit('slash-command', commandName, userContent, allAttachments)
      return
    }

    // 检查是否是 immediate command — 直接 emit slash-command
    if (chips.length === 1 && chips[0].kind === 'immediate') {
      const commandName = chips[0].label
      const userContent = content.replace(/\/cmd:"[^"]+":\w+:\w+\s*/g, '').trim()
      cleanupAfterCommand()
      emit('slash-command', commandName, userContent, allAttachments)
      return
    }

    // 其他命令 — 使用 dispatchCommandChip 生成 prompt
    const userContent = content.replace(/\/cmd:"[^"]+":\w+:\w+\s*/g, '').trim()
    const result = dispatchCommandChip(chips, userContent)

    emit('send', result.prompt, allAttachments, {
      displayLabel: result.displayLabel
    })

    cleanupAfterCommand()
    return
  }

  // 检测是否是斜杠命令（用户直接输入 /command）
  const slashResult = resolveDirectSlash(content)

  if (slashResult.action === 'immediate_command') {
    const commandName = content.slice(1).split(/\s+/)[0]
    const commandArgs = content.slice(1 + commandName.length).trim()
    clearEditor()
    emit('slash-command', commandName, commandArgs, allAttachments)
  } else if (slashResult.action === 'insert_chip' && slashResult.chip) {
    // 直接输入的命令 — 自动发送
    const result = dispatchCommandChip([slashResult.chip], '')
    emit('send', result.prompt, allAttachments, {
      displayLabel: result.displayLabel
    })
    clearEditor()
  } else {
    // 普通消息
    emit('send', content, allAttachments)
  }

  clearEditor()
  attachedFiles.value = []
  attachedImages.value = []
}

// ────────────────────────────────────────────────────────────────────
// Prompt Stash（Ctrl+S 暂存/恢复输入）
// ────────────────────────────────────────────────────────────────────
function handleStash() {
  const sid = chatStore.currentSessionId
  if (!sid) return

  const content = getEditorPlainText().trim()

  // 如果当前输入为空且已有暂存内容 → 恢复暂存（toggle 行为）
  if (!content && attachedFiles.value.length === 0 && attachedImages.value.length === 0) {
    if (chatStore.hasStash(sid)) {
      restoreStash()
    }
    return
  }

  // 暂存当前内容到 chat store（按 sessionId 存储）
  chatStore.stashPrompt(sid, {
    text: content,
    attachments: attachedFiles.value.map(f => ({ ...f })),
    images: attachedImages.value.map(img => ({ ...img })),
    editorHtml: editorRef.value?.innerHTML || '',
  })

  // 清空编辑器
  clearEditor()
  attachedFiles.value = []
  attachedImages.value = []

  // 显示 stash 提示
  showStashHint.value = true
  setTimeout(() => { showStashHint.value = false }, 2500)
}

function restoreStash() {
  const sid = chatStore.currentSessionId
  if (!sid) return

  const stash = chatStore.getStash(sid)
  if (!stash) return

  // 恢复编辑器内容
  const editor = editorRef.value
  if (editor && stash.editorHtml) {
    editor.innerHTML = stash.editorHtml
  }

  // 恢复附件
  attachedFiles.value = stash.attachments.map(f => ({ ...f }))
  attachedImages.value = stash.images.map(img => ({ ...img }))

  // 更新 inputText
  inputText.value = stash.text

  // 清除暂存
  chatStore.clearStash(sid)
  showStashHint.value = false

  // 聚焦编辑器
  nextTick(() => focusEditor())
}

function selectModel(modelValue: string) {
  selectedModel.value = modelValue
  showModelDropdown.value = false
  modelSearchQuery.value = ''

  // 同步到父组件和 Agent 系统
  emit('update:model', modelValue)
}

function closeModelDropdown() {
  showModelDropdown.value = false
  modelSearchQuery.value = ''
}

function selectMode(mode: EffortMode) {
  selectedMode.value = mode
  showModeDropdown.value = false
  // 同步推理深度到父组件和后端
  emit('update:effort', mode)
}

function closeModeDropdown() {
  showModeDropdown.value = false
}

// Agent selector functions
function toggleAgentDropdown() {
  showAgentDropdown.value = !showAgentDropdown.value
}

function selectAgent(agentType: string) {
  selectedAgent.value = agentType
  showAgentDropdown.value = false
  // Sync to parent and chat store
  emit('update:agent', agentType)
}

function closeAgentDropdown() {
  showAgentDropdown.value = false
}

function handleAddClick() {
  showAttachmentMenu.value = !showAttachmentMenu.value
}

function closeAttachmentMenu() {
  showAttachmentMenu.value = false
}

async function handleAttachFile() {
  closeAttachmentMenu()
  try {
    const result = await api.selectFiles()
    if (!result.canceled && result.filePaths.length > 0) {
      for (const filePath of result.filePaths) {
        const name = filePath.split(/[\\/]/).pop() || filePath
        // 避免重复添加
        if (!attachedFiles.value.some(f => f.path === filePath)) {
          attachedFiles.value.push({
            name,
            path: filePath,
            isFolder: false
          })
          insertMentionChip(name, filePath, false)
        }
      }
    }
  } catch (error) {
    console.error('Failed to select files:', error)
  }
}

async function handleOpenProjectFolder() {
  closeAttachmentMenu()
  await openProjectFromPicker()
}

async function handleAttachImage() {
  closeAttachmentMenu()
  try {
    const result = await api.selectFiles()
    if (!result.canceled && result.filePaths.length > 0) {
      for (const filePath of result.filePaths) {
        const name = filePath.split(/[\\/]/).pop() || filePath
        // 从文件路径创建 File 对象（需要在 renderer 进程处理）
        // 使用 fetch 或 fs 来读取文件
        try {
          // 对于 Electron，我们可以直接通过 fs 读取
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

async function readLocalImageAsDataUrl(filePath: string): Promise<string> {
  try {
    // 尝试使用 api 提供的 fs 读取
    const fileData = await (api as any).readFile?.(filePath, { encoding: 'base64' })
    if (fileData) {
      const mimeType = getMimeTypeFromFileName(filePath)
      return `data:${mimeType};base64,${fileData}`
    }
  } catch (e) {
    console.warn('Could not use API to read file, falling back')
  }
  // 如果没有 api，我们需要使用传统方法（这需要 File 对象）
  throw new Error('Need File object')
}

function getMimeTypeFromFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'image/png'
  }
}

async function handleAttachFolder() {
  closeAttachmentMenu()
  try {
    const result = await api.selectFolder()
    if (!result.canceled && result.filePaths.length > 0) {
      const folderPath = result.filePaths[0]
      const name = folderPath.split(/[\\/]/).pop() || folderPath
      // 避免重复添加
      if (!attachedFiles.value.some(f => f.path === folderPath)) {
        attachedFiles.value.push({
          name,
          path: folderPath,
          isFolder: true
        })
        insertMentionChip(name, folderPath, true)
      }
    }
  } catch (error) {
    console.error('Failed to select folder:', error)
  }
}

// 拖拽处理函数
function handleDragEnter(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (hasDragContent(e)) {
    isDragging.value = true
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (hasDragContent(e)) {
    isDragging.value = true
  }
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  // 检查是否真的离开了容器
  const rect = (containerRef.value as HTMLElement).getBoundingClientRect()
  const x = e.clientX
  const y = e.clientY
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
    isDragging.value = false
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragging.value = false
  
  if (!e.dataTransfer) return

  // 1. 处理从目录树拖拽的文件/文件夹
  const claudePath = e.dataTransfer.getData('application/x-claude-path')
  if (claudePath) {
    const nodeType = e.dataTransfer.getData('application/x-claude-type')
    const name = claudePath.split(/[\\/]/).pop() || claudePath
    const isFolder = nodeType === 'directory'
    
    // 避免重复添加
    if (!attachedFiles.value.some(f => f.path === claudePath)) {
      attachedFiles.value.push({
        name,
        path: claudePath,
        isFolder
      })
      insertMentionChip(name, claudePath, isFolder)
      console.log('[ChatInput] Dropped file/folder from tree:', claudePath, isFolder ? '(folder)' : '(file)')
    }
    return
  }

  // 2. 处理图片文件（从系统文件管理器拖拽）
  const files = Array.from(e.dataTransfer?.files || [])
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      handleImageFile(file)
    }
  }
}

function hasDragContent(e: DragEvent): boolean {
  if (!e.dataTransfer?.types) return false
  
  // 检查是否有目录树拖拽的内容
  if (e.dataTransfer.types.includes('application/x-claude-path')) {
    return true
  }
  
  // 检查是否有图片文件
  if (e.dataTransfer.types.includes('Files')) {
    const files = Array.from(e.dataTransfer.files || [])
    return files.some(file => file.type.startsWith('image/'))
  }
  
  return false
}

// 键盘导航
function handleModelKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement

  if (!showModelDropdown.value) {
    const isModelSelectorFocused = modelSelectorRef.value?.contains(target)
    const isInSearchInput = target === modelSearchInput.value

    if ((event.key === 'Enter' || event.key === ' ') && (isModelSelectorFocused || isInSearchInput)) {
      event.preventDefault()
      toggleModelDropdown()
    }
    return
  }

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      closeModelDropdown()
      break
    case 'ArrowDown':
      event.preventDefault()
      navigateModels(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      navigateModels(-1)
      break
    case 'Enter':
      event.preventDefault()
      if (highlightedModel.value) {
        selectModel(highlightedModel.value)
      }
      break
  }
}

function navigateModels(direction: number) {
  const models = filteredModels.value
  if (models.length === 0) return

  const currentIndex = models.findIndex(m => m.value === highlightedModel.value)
  let newIndex = currentIndex + direction

  if (newIndex < 0) newIndex = models.length - 1
  if (newIndex >= models.length) newIndex = 0

  highlightedModel.value = models[newIndex].value

  // 滚动到可视区域
  nextTick(() => {
    const highlightedEl = modelListRef.value?.querySelector('.highlighted')
    highlightedEl?.scrollIntoView({ block: 'nearest' })
  })
}

// 点击外部关闭下拉菜单的指令
const vClickOutside = {
  mounted(el: HTMLElement, binding: any) {
    const clickHandler = (event: Event) => {
      if (!(el === event.target || el.contains(event.target as Node))) {
        binding.value()
      }
    }
    ;(el as any).__clickOutside__ = clickHandler
    document.addEventListener('click', clickHandler, true)
  },
  unmounted(el: HTMLElement) {
    const clickHandler = (el as any).__clickOutside__
    if (clickHandler) {
      document.removeEventListener('click', clickHandler, true)
    }
  }
}

// 监听键盘事件
onMounted(() => {
  document.addEventListener('keydown', handleModelKeydown)
  window.addEventListener('session-created', focusEditor)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleModelKeydown)
  window.removeEventListener('session-created', focusEditor)
})

// 清理事件监听
watch(showModelDropdown, (open) => {
  if (!open) {
    modelSearchQuery.value = ''
  }
})

watch(() => chatStore.currentSessionId, () => {
  focusEditor()
  // 切换会话时，如果新会话有暂存内容，自动恢复
  const sid = chatStore.currentSessionId
  if (sid && chatStore.hasStash(sid)) {
    nextTick(() => restoreStash())
  }
})

// AI 回复完成后，自动恢复暂存的 prompt
watch(() => props.isSending, (sending, prevSending) => {
  if (prevSending && !sending) {
    const sid = chatStore.currentSessionId
    if (sid && chatStore.hasStash(sid)) {
      nextTick(() => restoreStash())
    }
  }
})

// Watch disabled/isSending to toggle contenteditable
watch([() => props.disabled, () => props.isSending], ([disabled, sending]) => {
  const editor = editorRef.value
  if (editor) {
    editor.contentEditable = (!disabled || sending) ? 'true' : 'false'
  }
}, { immediate: true })

// Watch for files added from file tree context menu
watch(pendingFile, (file) => {
  if (!file) return
  
  // Insert the file as a mention chip
  insertMentionChip(file.name, file.path, file.isFolder)
  
  // Add to attached files if not already present
  if (!attachedFiles.value.some(f => f.path === file.path)) {
    attachedFiles.value.push({
      name: file.name,
      path: file.path,
      isFolder: file.isFolder
    })
  }
  
  // Consume the pending file
  consumePendingFile()
  
  // Focus editor
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
    border-color: rgba(99, 102, 241, 0.45);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08);

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
  border-radius: 8px;
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
      rgba(99, 102, 241, 0.18) 50%,
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

// 提示词优化进行中文字提示
.optimize-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.18);
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
    font-size: 15px;
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
      border-radius: 4px;
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
      border-radius: 4px;
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
        background: rgba(99, 102, 241, 0.08);
        border-color: rgba(99, 102, 241, 0.5);
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
  background: transparent;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  background: transparent;
  transition: all 0.15s ease;

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
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

.model-selector,
.mode-selector,
.agent-selector {
  position: relative;
}

.model-btn,
.mode-btn,
.agent-btn {
  background: transparent;

  .model-name,
  .mode-name,
  .agent-name {
    font-weight: 500;
    max-width: 120px;
    @include truncate;
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

  &.has-agent {
    color: var(--accent-primary, #6366f1);
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
.model-dropdown,
.mode-dropdown,
.agent-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 8px;
  min-width: 180px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  z-index: 100;
  overflow: hidden;
}

.model-dropdown {
  min-width: 280px;
}

.agent-dropdown {
  min-width: 300px;

  .dropdown-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .item-desc {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .dropdown-section-label {
    padding: 6px 16px 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    opacity: 0.7;
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
  border-radius: 6px;
  color: var(--text-muted);
  background: transparent;
  transition: all 0.15s ease;

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
    border-radius: 4px;

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
  }

  .ghost-text {
    color: var(--text-muted);
    font-size: 14px;
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
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;

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
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  transition: all 0.15s ease;
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

// 附件菜单
.attachment-menu {
  position: absolute;
  bottom: 80px;
  left: 32px;
  min-width: 200px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  z-index: 100;
  overflow: hidden;
  padding: 4px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  transition: background 0.15s ease;

  &:hover {
    background: var(--surface-hover);
  }

  svg {
    color: var(--text-secondary);
  }
}

// 斜杠命令菜单
.slash-command-menu,
.context-menu {
  position: fixed;
  width: 320px;
  max-height: 320px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.16);
  z-index: 1000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

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
    font-size: 14px;
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
    border-radius: 4px;

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
  }
}

.dropdown-section-title {
  padding: 8px 16px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  background: var(--bg-secondary);
}

.dropdown-section-divider {
  height: 1px;
  background: var(--surface-border);
  margin: 4px 0;
}

.slash-command-menu .dropdown-item,
.context-menu .dropdown-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 16px;
  text-align: left;

  .item-icon {
    color: var(--text-secondary);
    flex-shrink: 0;
    margin-top: 2px;

    &.is-folder {
      color: var(--accent-primary);
    }
  }

  .item-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .item-name {
    font-weight: 500;
    color: var(--text-primary);
  }

  .item-description,
  .item-path {
    font-size: 12px;
    color: var(--text-muted);
    @include truncate;
  }

  .item-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    flex-shrink: 0;

    &.skill {
      background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
      color: var(--accent-primary);
    }

    &.sdk {
      background: color-mix(in srgb, var(--text-secondary) 15%, transparent);
      color: var(--text-secondary);
    }

    &.mcp {
      background: color-mix(in srgb, #f59e0b 15%, transparent);
      color: #f59e0b;
    }
  }
}

.dropdown-footer-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  background: transparent;
  transition: all 0.15s ease;
  text-align: left;

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .item-icon {
    color: var(--accent-primary);
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
</style>
