<template>
  <div ref="containerRef" class="chat-input-container">
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
            v-model="slashSearchQuery"
            type="text"
            placeholder="搜索命令..."
            readonly
            tabindex="-1"
          />
          <button v-if="slashSearchQuery" class="clear-btn" @click="clearSlashSearch">
            <X :size="12" />
          </button>
        </div>
        <div class="dropdown-section-title">Commands</div>
        <div class="dropdown-list" ref="slashListRef">
          <div v-if="filteredSlashCommands.length === 0" class="dropdown-empty">
            <span>未找到匹配的命令</span>
          </div>
          <button
            v-for="cmd in filteredSlashCommands"
            :key="cmd.name"
            class="dropdown-item"
            :class="{ highlighted: highlightedSlashCommand === cmd.name }"
            @click="selectSlashCommand(cmd)"
            @mouseenter="highlightedSlashCommand = cmd.name"
          >
            <component :is="cmd.icon" :size="16" class="item-icon" />
            <div class="item-content">
              <span class="item-name">{{ cmd.name }}</span>
              <span class="item-description">{{ cmd.description }}</span>
            </div>
          </button>
        </div>
        <div class="dropdown-section-divider"></div>
        <button class="dropdown-footer-item" @click="openSkillsManager">
          <Zap :size="14" class="item-icon" />
          <span>管理技能</span>
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
            placeholder="搜索文件或文件夹..."
            readonly
            tabindex="-1"
          />
          <button v-if="contextSearchQuery" class="clear-btn" @click="clearContextSearch">
            <X :size="12" />
          </button>
        </div>
        <div class="dropdown-section-title">添加上下文</div>
        <div class="dropdown-list" ref="contextListRef">
          <div v-if="isLoadingContext" class="dropdown-loading">
            <Loader2 :size="16" class="spin" />
            <span>搜索中...</span>
          </div>
          <div v-else-if="filteredContextItems.length === 0" class="dropdown-empty">
            <span>未找到匹配的文件或文件夹</span>
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
          <span>浏览文件...</span>
        </button>
      </div>
    </Transition>

    <div class="input-wrapper" :class="{ 'has-content': hasContent, 'is-sending': isSending }">
      <!-- 命令 Badge — 嵌入输入框内部 -->
      <Transition name="badge">
        <div v-if="activeBadge" class="command-badge-bar">
          <div class="command-badge" :class="`badge-kind-${activeBadge.kind}`">
            <span class="badge-label">/{{ activeBadge.label }}</span>
            <span class="badge-description">{{ activeBadge.description }}</span>
            <button class="badge-remove" @click="clearBadge">
              <X :size="12" />
            </button>
          </div>
        </div>
      </Transition>

      <!-- 文本输入区域 — contenteditable 支持内联 chip -->
      <div class="textarea-wrapper" @click="focusEditor">
        <div
          ref="editorRef"
          class="inline-editor"
          contenteditable="true"
          :data-placeholder="placeholder"
          @input="handleEditorInput"
          @keydown="handleEditorKeydown"
          @click="handleEditorClick"
          @paste="handleEditorPaste"
        ></div>
      </div>

      <!-- 底部工具栏：+ 号、模型选择、发送按钮 -->
      <div class="input-toolbar">
        <div class="toolbar-left">
          <!-- + 号按钮 -->
          <button class="toolbar-btn add-btn" @click="handleAddClick" title="添加附件">
            <Plus :size="18" />
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
                  <span>Model</span>
                  <button
                    v-if="canRefreshModels"
                    class="refresh-btn"
                    @click="refreshModels"
                    :disabled="isLoadingModels"
                    title="刷新模型列表"
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
                    placeholder="搜索模型..."
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
                    <span>加载中...</span>
                  </div>
                  <div v-else-if="modelLoadError && filteredModels.length === 0" class="dropdown-error">
                    <AlertCircle :size="16" />
                    <span>{{ modelLoadError }}</span>
                    <button v-if="canRefreshModels" class="retry-btn" @click="refreshModels">
                      重试
                    </button>
                  </div>
                  <div v-else-if="filteredModels.length === 0" class="dropdown-empty">
                    <span>未找到匹配的模型</span>
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
                  <span>Agent</span>
                </div>
                <div class="dropdown-list" ref="agentListRef">
                  <!-- Default (no agent) -->
                  <button
                    class="dropdown-item"
                    :class="{ active: !selectedAgent }"
                    @click="selectAgent('')"
                    @mouseenter="highlightedAgent = ''"
                  >
                    <span class="item-name">Default</span>
                    <span class="item-desc">Standard Claude Code session</span>
                    <Check v-if="!selectedAgent" :size="14" class="check-icon" />
                  </button>
                  <!-- Built-in agents -->
                  <template v-if="builtInAgents.length">
                    <div class="dropdown-section-label">Built-in</div>
                    <button
                      v-for="agent in builtInAgents"
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
                  <!-- Custom agents -->
                  <template v-if="customAgents.length">
                    <div class="dropdown-section-label">Custom</div>
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
        </div>

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

    <!-- 附件菜单弹窗 -->
    <Transition name="dropdown">
      <div v-if="showAttachmentMenu" class="attachment-menu" v-click-outside="closeAttachmentMenu">
        <button class="attachment-item" @click="handleAttachFile">
          <FileText :size="16" />
          <span>Attach files</span>
        </button>
        <button class="attachment-item" @click="handleAttachFolder">
          <Folder :size="16" />
          <span>Add folder to context</span>
        </button>
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
  Code, GitBranch, Bug, Bookmark, Layers, MessageSquare, Eye, Cpu
} from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { useSkillsStore } from '@/stores/skills'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import type { AgentInfo } from '@/types'
import { api } from '@/services/electronAPI'

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
  kind?: 'immediate' | 'sdk_command' | 'codepilot_command' | 'agent_skill' | 'slash_command'
  immediate?: boolean
  aliases?: string[]
}

interface ContextItem {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
}

interface SendOptions {
  badge?: CommandBadge
  displayLabel?: string
}

const emit = defineEmits<{
  send: [content: string, attachments: Attachment[], options?: SendOptions]
  'slash-command': [command: string, args: string, attachments: Attachment[]]
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
}>()

const settingsStore = useSettingsStore()
const skillsStore = useSkillsStore()
const appStore = useAppStore()

const inputText = ref('')
const editorRef = ref<HTMLElement | null>(null)
const containerRef = ref<HTMLElement | null>(null)
const showModelDropdown = ref(false)
const showModeDropdown = ref(false)
const showAttachmentMenu = ref(false)
const attachedFiles = ref<Attachment[]>([])

// 命令 Badge 系统
const activeBadge = ref<CommandBadge | null>(null)
const hasActiveBadge = computed(() => activeBadge.value !== null)

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
  if (!selectedAgent.value) return 'Agent'
  return selectedAgent.value
})

// 斜杠命令相关
const showSlashCommandMenu = ref(false)
const slashSearchQuery = ref('')
const slashSearchInput = ref<HTMLInputElement | null>(null)
const slashListRef = ref<HTMLElement | null>(null)
const highlightedSlashCommand = ref<string | null>(null)
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
import { resolveDirectSlash, dispatchBadge } from '@/lib/message-input-logic'
import type { CommandBadge } from '@/types'

// Icon mapping for commands
const iconMap: Record<string, any> = {
  HelpCircle, Trash2, Coins, Minimize2, Stethoscope, FilePlus, Zap, Layers,
  Terminal, Settings, Code, GitBranch, Bug, Bookmark, Eye, Cpu, MessageSquare
}

// 内置斜杠命令列表 - 从常量生成
const builtinSlashCommands = computed<SlashCommand[]>(() => {
  return BUILT_IN_COMMANDS.map(cmd => ({
    name: cmd.name,
    description: cmd.description,
    icon: iconMap[cmd.icon] || Zap,
    kind: cmd.kind,
    immediate: cmd.immediate,
    aliases: cmd.aliases
  }))
})

// 技能命令
const skillCommands = computed<SlashCommand[]>(() => {
  return skillsStore.skills.map(skill => ({
    name: skill.name,
    description: skill.description || `技能: /${skill.name}`,
    icon: Zap
  }))
})

// 所有斜杠命令
const allSlashCommands = computed<SlashCommand[]>(() => {
  return [...builtinSlashCommands.value, ...skillCommands.value]
})

// 过滤后的斜杠命令
const filteredSlashCommands = computed<SlashCommand[]>(() => {
  if (!slashSearchQuery.value) return allSlashCommands.value
  const query = slashSearchQuery.value.toLowerCase()
  return allSlashCommands.value.filter(cmd =>
    cmd.name.toLowerCase().includes(query) ||
    cmd.description.toLowerCase().includes(query) ||
    cmd.aliases?.some(alias => alias.toLowerCase().includes(query))
  )
})

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
  return model?.label || selectedModel.value || 'Select Model'
})

const hasContent = computed(() => {
  if (inputText.value.trim().length > 0) return true
  if (attachedFiles.value.length > 0) return true
  if (hasActiveBadge.value) return true

  const editor = editorRef.value
  if (!editor) return false
  if (editor.textContent?.trim()) return true
  return editor.querySelectorAll('.mention-chip').length > 0
})
const canSend = computed(() => (hasContent.value) && !props.isSending)

// ─── ContentEditable Utilities ───────────────────────────────

/** Extract plain text from contenteditable, replacing chips with @path markers */
function getEditorPlainText(): string {
  const editor = editorRef.value
  if (!editor) return ''

  function walkNodes(parent: Node): string {
    let text = ''
    for (const node of Array.from(parent.childNodes)) {
      if (node instanceof Element && node.classList.contains('mention-chip')) {
        const path = node.getAttribute('data-path') || ''
        const isFolder = node.getAttribute('data-is-folder') === 'true'
        text += isFolder ? `@folder:"${path}" ` : `@file:"${path}" `
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

    switch (settingsStore.authMethod) {
      case 'anthropic_compatible':
        baseUrl = settingsStore.anthropicConfig.baseUrl || 'https://api.anthropic.com'
        apiKey = settingsStore.anthropicConfig.apiKey
        break
      case 'openai_compatible':
        baseUrl = settingsStore.openaiConfig.baseUrl || 'https://api.openai.com/v1'
        apiKey = settingsStore.openaiConfig.apiKey
        break
      case 'gemini_api':
        baseUrl = settingsStore.geminiConfig.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
        apiKey = settingsStore.geminiConfig.apiKey
        break
    }

    if (!apiKey) {
      modelLoadError.value = '请先配置 API Key'
      return
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/models`
    const result = await api.httpFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!result) {
      modelLoadError.value = 'HTTP 代理不可用'
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
      modelLoadError.value = `获取失败 (${result.status})`
    }
  } catch (error) {
    console.error('[ChatInput] Failed to fetch models:', error)
    modelLoadError.value = error instanceof Error ? error.message : '网络错误'
  } finally {
    isLoadingModels.value = false
  }
}

// 刷新模型列表
function refreshModels() {
  fetchModelsFromBaseUrl()
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

  // 检查是否在一行的开始处输入了 /
  const lastNewLine = textBeforeCursor.lastIndexOf('\n')
  const textAfterLastNewLine = textBeforeCursor.slice(lastNewLine + 1)

  // 匹配 / 开头，后面跟着可选的字母数字
  const slashMatch = textAfterLastNewLine.match(/^\/(\w*)$/)

  if (slashMatch && !showContextMenu.value) {
    slashTriggerPosition.value = lastNewLine + 1
    showSlashCommandMenu.value = true
    slashSearchQuery.value = slashMatch[1] || ''
    highlightedSlashCommand.value = filteredSlashCommands.value[0]?.name || null

    // 计算菜单位置，保持焦点在 editor
    nextTick(() => {
      updateSlashMenuPosition()
      editorRef.value?.focus()
    })
  } else if (!textAfterLastNewLine.startsWith('/')) {
    closeSlashCommandMenu()
  } else if (showSlashCommandMenu.value) {
    // 同步输入框内容到搜索查询
    slashSearchQuery.value = textAfterLastNewLine.slice(1)
    if (filteredSlashCommands.value.length > 0) {
      highlightedSlashCommand.value = filteredSlashCommands.value[0].name
    }
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

  if (hasInvalidChar || showSlashCommandMenu.value) {
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
    closeSlashCommandMenu()
    clearEditor()
    emit('slash-command', cmd.name, '', attachedFiles.value)
    return
  }

  // 非立即执行命令：直接设置为 badge
  closeSlashCommandMenu()
  clearEditor()

  activeBadge.value = {
    command: `/${cmd.name}`,
    label: cmd.name,
    description: cmd.description || '',
    kind: cmd.kind || 'slash_command'
  }

  // 聚焦回 editor
  nextTick(() => {
    editorRef.value?.focus()
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
  showSlashCommandMenu.value = false
  slashSearchQuery.value = ''
  slashTriggerPosition.value = -1
  highlightedSlashCommand.value = null
}

// 关闭上下文菜单
function closeContextMenu() {
  showContextMenu.value = false
  contextSearchQuery.value = ''
  contextTriggerPosition.value = -1
  highlightedContextItem.value = null
}

// Handle paste — strip HTML, paste as plain text
function handleEditorPaste(e: ClipboardEvent) {
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') || ''
  document.execCommand('insertText', false, text)
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
  const queryLen = slashSearchQuery.value.length
  slashSearchQuery.value = ''
  if (slashTriggerPosition.value >= 0) {
    removeTriggerText(slashTriggerPosition.value, queryLen + 1) // +1 for /
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
  if (!showSlashCommandMenu.value) return

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      closeSlashCommandMenu()
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
      const cmd = filteredSlashCommands.value.find(c => c.name === highlightedSlashCommand.value)
      if (cmd) {
        selectSlashCommand(cmd)
      }
      break
    case 'Tab':
      event.preventDefault()
      const tabCmd = filteredSlashCommands.value.find(c => c.name === highlightedSlashCommand.value)
      if (tabCmd) {
        selectSlashCommand(tabCmd)
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
  const commands = filteredSlashCommands.value
  if (commands.length === 0) return

  const currentIndex = commands.findIndex(c => c.name === highlightedSlashCommand.value)
  let newIndex = currentIndex + direction

  if (newIndex < 0) newIndex = commands.length - 1
  if (newIndex >= commands.length) newIndex = 0

  highlightedSlashCommand.value = commands[newIndex].name

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
  closeSlashCommandMenu()
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
  // 处理斜杠命令菜单的键盘导航
  if (showSlashCommandMenu.value) {
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
        const cmd = filteredSlashCommands.value.find(c => c.name === highlightedSlashCommand.value)
        if (cmd) {
          selectSlashCommand(cmd)
        }
        return
      case 'Escape':
        event.preventDefault()
        closeSlashCommandMenu()
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

      if (nodeBefore && nodeBefore instanceof Element && nodeBefore.classList.contains('mention-chip')) {
        event.preventDefault()
        // Also remove trailing space
        const nextSib = nodeBefore.nextSibling
        if (nextSib && nextSib.nodeType === Node.TEXT_NODE && nextSib.textContent === '\u00A0') {
          nextSib.remove()
        }
        nodeBefore.remove()
        inputText.value = getEditorPlainText()

        // Also remove from attachedFiles
        const path = nodeBefore.getAttribute('data-path')
        if (path) {
          const idx = attachedFiles.value.findIndex(f => f.path === path)
          if (idx >= 0) attachedFiles.value.splice(idx, 1)
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
  const mentions = collectMentions()
  if ((!canSend.value && mentions.length === 0 && !hasActiveBadge.value) || props.disabled) return

  // 如果有打开的斜杠命令菜单或上下文菜单，不执行发送（让菜单处理回车事件）
  if (showSlashCommandMenu.value || showContextMenu.value) return

  // 关闭所有下拉菜单
  showModelDropdown.value = false
  showModeDropdown.value = false
  showAttachmentMenu.value = false
  showAgentDropdown.value = false
  closeSlashCommandMenu()
  closeContextMenu()
  modelSearchQuery.value = ''

  const content = getEditorPlainText().trim()

  // 如果有活跃的 Badge，使用 dispatchBadge 展开
  if (hasActiveBadge.value && activeBadge.value) {
    const result = dispatchBadge(activeBadge.value, content)

    // 发送展开后的提示词
    emit('send', result.prompt, mentions, {
      badge: activeBadge.value,
      displayLabel: result.displayLabel
    })

    // 清除状态
    clearEditor()
    attachedFiles.value = []
    activeBadge.value = null
    return
  }

  // 检测是否是斜杠命令
  const slashResult = resolveDirectSlash(content)

  if (slashResult.action === 'immediate_command') {
    // 立即执行命令
    const commandName = content.slice(1).split(/\s+/)[0]
    const commandArgs = content.slice(1 + commandName.length).trim()
    clearEditor()
    emit('slash-command', commandName, commandArgs, mentions)
  } else if (slashResult.action === 'set_badge' && slashResult.badge) {
    // 设置为 Badge，等待用户添加上下文
    activeBadge.value = slashResult.badge
    clearEditor()
  } else if (slashResult.action === 'unknown_slash_badge' && slashResult.badge) {
    // 未知命令也作为 Badge 处理
    activeBadge.value = slashResult.badge
    clearEditor()
  } else {
    // 普通消息
    emit('send', content, mentions)
  }

  clearEditor()
  attachedFiles.value = []
}

// 清除 Badge
function clearBadge() {
  activeBadge.value = null
  editorRef.value?.focus()
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
})

// Watch disabled/isSending to toggle contenteditable
watch([() => props.disabled, () => props.isSending], ([disabled, sending]) => {
  const editor = editorRef.value
  if (editor) {
    editor.contentEditable = (!disabled || sending) ? 'true' : 'false'
  }
}, { immediate: true })
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
}

// 文本输入区域
.textarea-wrapper {
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
    }
  }
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

.loading-icon {
  color: var(--accent-primary);
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

// 命令 Badge 样式 — 嵌入输入框内部
.command-badge-bar {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--surface-border);
  margin-bottom: 8px;
}

.command-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 13px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  transition: all 0.15s ease;

  .badge-label {
    font-weight: 600;
    color: var(--accent-primary);
  }

  .badge-description {
    color: var(--text-secondary);
    font-size: 12px;
  }

  .badge-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    color: var(--text-muted);
    transition: all 0.15s ease;
    margin-left: 4px;

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
  }

  // 不同 kind 的样式
  &.badge-kind-sdk_command {
    background: rgba(var(--accent-primary-rgb), 0.08);
    border-color: var(--accent-primary);
  }

  &.badge-kind-codepilot_command {
    background: rgba(245, 158, 11, 0.08);
    border-color: rgba(245, 158, 11, 0.5);

    .badge-label {
      color: #f59e0b;
    }
  }

  &.badge-kind-agent_skill {
    background: rgba(16, 185, 129, 0.08);
    border-color: rgba(16, 185, 129, 0.5);

    .badge-label {
      color: #10b981;
    }
  }

  &.badge-kind-slash_command {
    background: rgba(99, 102, 241, 0.08);
    border-color: rgba(99, 102, 241, 0.5);

    .badge-label {
      color: #6366f1;
    }
  }
}

// Badge 过渡动画
.badge-enter-active,
.badge-leave-active {
  transition: all 0.2s ease;
}

.badge-enter-from,
.badge-leave-to {
  opacity: 0;
  transform: translateY(-8px);
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
