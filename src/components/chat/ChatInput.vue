<template>
  <div ref="containerRef" class="chat-input-container">
    <!-- 附件列表显示在输入框上方 -->
    <Transition name="attachments">
      <div v-if="attachedFiles.length > 0" class="attachments-bar">
        <div class="attachment-list">
          <div
            v-for="(file, index) in attachedFiles"
            :key="file.path"
            class="attachment-chip"
            :class="{ 'is-folder': file.isFolder }"
          >
            <component :is="file.isFolder ? Folder : FileText" :size="14" />
            <span class="attachment-name">{{ file.name }}</span>
            <button class="remove-btn" @click="removeAttachment(index)">
              <X :size="12" />
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 命令 Badge 显示 -->
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
          <div v-if="filteredContextItems.length === 0" class="dropdown-empty">
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
              <span class="item-path">{{ item.path }}</span>
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
      <!-- 文本输入区域 -->
      <div class="textarea-wrapper">
        <textarea
          ref="textareaRef"
          v-model="inputText"
          :placeholder="placeholder"
          rows="1"
          :disabled="disabled || isSending"
          @keydown.enter.exact.prevent="handleSend"
          @input="handleInput"
          @keydown="handleTextareaKeydown"
          @click="handleTextareaClick"
        ></textarea>
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

          <!-- 模式选择器 (类似 Medium) -->
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
        </div>

        <!-- 发送/停止按钮 -->
        <button
          class="send-btn"
          :class="{ 'has-content': hasContent || attachedFiles.length > 0, 'is-sending': props.isSending }"
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
const textareaRef = ref<HTMLTextAreaElement | null>(null)
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

// 模式列表
const availableModes = ['Speed', 'Balance', 'Quality']
const selectedMode = ref('Balance')

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

// 过滤后的上下文项
const filteredContextItems = computed<ContextItem[]>(() => {
  if (!contextSearchQuery.value) return contextItems.value
  const query = contextSearchQuery.value.toLowerCase()
  return contextItems.value.filter(item =>
    item.name.toLowerCase().includes(query) ||
    item.path.toLowerCase().includes(query)
  )
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

const selectedModelLabel = computed(() => {
  const model = availableModels.value.find(m => m.value === selectedModel.value)
  return model?.label || selectedModel.value || 'Select Model'
})

const hasContent = computed(() => inputText.value.trim().length > 0)
const canSend = computed(() => (hasContent.value || attachedFiles.value.length > 0) && !props.isSending)

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
function handleInput() {
  autoResize()
  checkSlashTrigger()
  checkContextTrigger()
}

// 自动调整高度
function autoResize() {
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
    textareaRef.value.style.height = Math.min(textareaRef.value.scrollHeight, 200) + 'px'
  }
}

// 检查斜杠触发
function checkSlashTrigger() {
  const textarea = textareaRef.value
  if (!textarea) return

  const cursorPosition = textarea.selectionStart
  const textBeforeCursor = inputText.value.slice(0, cursorPosition)

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

    // 计算菜单位置，保持焦点在 textarea
    nextTick(() => {
      updateSlashMenuPosition()
      // 保持焦点在 textarea，不自动聚焦到搜索框
      textareaRef.value?.focus()
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
  const textarea = textareaRef.value
  if (!textarea) return

  const cursorPosition = textarea.selectionStart
  const textBeforeCursor = inputText.value.slice(0, cursorPosition)

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
  contextTriggerPosition.value = lastAtIndex
  showContextMenu.value = true
  contextSearchQuery.value = textAfterAt

  // 加载上下文项目
  loadContextItems()

  nextTick(() => {
    updateContextMenuPosition()
    // 保持焦点在 textarea，不自动聚焦到搜索框
    textareaRef.value?.focus()
  })
}

// 加载上下文项目（文件和文件夹）
async function loadContextItems() {
  if (!props.workingDirectory) return

  isLoadingContext.value = true
  try {
    // 使用 readDir API 获取文件列表
    const entries = await api.readDir(props.workingDirectory)
    const items: ContextItem[] = entries.map(entry => ({
      name: entry.name,
      path: entry.name,
      type: entry.isDirectory ? 'directory' : 'file'
    }))

    // 文件夹排在前面，然后按名称排序
    items.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name)
      }
      return a.type === 'directory' ? -1 : 1
    })

    contextItems.value = items.slice(0, 50) // 限制显示数量
    if (items.length > 0) {
      highlightedContextItem.value = items[0].path
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
  const textarea = textareaRef.value
  if (!container || !textarea) return

  const containerRect = container.getBoundingClientRect()
  const textareaRect = textarea.getBoundingClientRect()

  // 菜单从输入框顶部向上弹出，与容器左边缘对齐
  slashMenuPosition.value = {
    bottom: `${window.innerHeight - textareaRect.top + 8}px`,
    left: `${containerRect.left}px`
  }
}

// 更新上下文菜单位置 - 在输入框上方弹出，与容器左对齐
function updateContextMenuPosition() {
  const container = containerRef.value
  const textarea = textareaRef.value
  if (!container || !textarea) return

  const containerRect = container.getBoundingClientRect()
  const textareaRect = textarea.getBoundingClientRect()

  // 菜单从输入框顶部向上弹出，与容器左边缘对齐
  contextMenuPosition.value = {
    bottom: `${window.innerHeight - textareaRect.top + 8}px`,
    left: `${containerRect.left}px`
  }
}

// 选择斜杠命令
function selectSlashCommand(cmd: SlashCommand) {
  if (cmd.immediate || cmd.kind === 'immediate') {
    closeSlashCommandMenu()
    inputText.value = ''
    emit('slash-command', cmd.name, '', attachedFiles.value)
    return
  }

  // 非立即执行命令：直接设置为 badge
  closeSlashCommandMenu()
  inputText.value = ''

  activeBadge.value = {
    command: `/${cmd.name}`,
    label: cmd.name,
    description: cmd.description || '',
    kind: cmd.kind || 'slash_command'
  }

  // 聚焦回 textarea
  nextTick(() => {
    textareaRef.value?.focus()
    autoResize()
  })
}

// 选择上下文项
function selectContextItem(item: ContextItem) {
  const beforeTrigger = inputText.value.slice(0, contextTriggerPosition.value)
  const afterTrigger = inputText.value.slice(textareaRef.value?.selectionStart || 0)

  // 使用特殊格式嵌入上下文
  const contextTag = item.type === 'directory'
    ? `@folder:"${item.path}"`
    : `@file:"${item.path}"`

  inputText.value = beforeTrigger + contextTag + ' ' + afterTrigger
  closeContextMenu()

  // 聚焦回 textarea
  nextTick(() => {
    textareaRef.value?.focus()
    const newCursorPos = beforeTrigger.length + contextTag.length + 1
    textareaRef.value?.setSelectionRange(newCursorPos, newCursorPos)
  })
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

// 清除斜杠搜索 - 同时清除输入框中的 /
function clearSlashSearch() {
  slashSearchQuery.value = ''
  if (slashTriggerPosition.value >= 0) {
    const beforeTrigger = inputText.value.slice(0, slashTriggerPosition.value)
    const afterTrigger = inputText.value.slice(slashTriggerPosition.value + 1)
    inputText.value = beforeTrigger + afterTrigger
    textareaRef.value?.focus()
  }
}

// 清除上下文搜索 - 同时清除输入框中的 @
function clearContextSearch() {
  contextSearchQuery.value = ''
  if (contextTriggerPosition.value >= 0) {
    const beforeTrigger = inputText.value.slice(0, contextTriggerPosition.value)
    const afterTrigger = inputText.value.slice(contextTriggerPosition.value + 1)
    inputText.value = beforeTrigger + afterTrigger
    textareaRef.value?.focus()
  }
}

// 处理斜杠命令键盘事件
function handleSlashKeydown(event: KeyboardEvent) {
  if (!showSlashCommandMenu.value) return

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      closeSlashCommandMenu()
      textareaRef.value?.focus()
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
      textareaRef.value?.focus()
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
        const relativePath = props.workingDirectory
          ? filePath.replace(props.workingDirectory, '').replace(/^[/\\]/, '')
          : filePath

        const beforeTrigger = inputText.value.slice(0, contextTriggerPosition.value)
        const afterTrigger = inputText.value.slice(textareaRef.value?.selectionStart || 0)
        const contextTag = `@file:"${relativePath}"`

        inputText.value = beforeTrigger + contextTag + ' ' + afterTrigger
      }
    }
  } catch (error) {
    console.error('Failed to browse files:', error)
  }
}

// 处理 textarea 键盘事件
function handleTextareaKeydown(event: KeyboardEvent) {
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
}

// 处理 textarea 点击
function handleTextareaClick() {
  // 延迟检查，确保光标位置已更新
  setTimeout(() => {
    checkSlashTrigger()
    checkContextTrigger()
  }, 0)
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
  if ((!canSend.value && attachedFiles.value.length === 0 && !hasActiveBadge.value) || props.disabled) return

  // 如果有打开的斜杠命令菜单或上下文菜单，不执行发送（让菜单处理回车事件）
  if (showSlashCommandMenu.value || showContextMenu.value) return

  // 关闭所有下拉菜单
  showModelDropdown.value = false
  showModeDropdown.value = false
  showAttachmentMenu.value = false
  closeSlashCommandMenu()
  closeContextMenu()
  modelSearchQuery.value = ''

  const content = inputText.value.trim()

  // 如果有活跃的 Badge，使用 dispatchBadge 展开
  if (hasActiveBadge.value && activeBadge.value) {
    const result = dispatchBadge(activeBadge.value, content)

    // 发送展开后的提示词
    emit('send', result.prompt, attachedFiles.value, {
      badge: activeBadge.value,
      displayLabel: result.displayLabel
    })

    // 清除状态
    inputText.value = ''
    attachedFiles.value = []
    activeBadge.value = null

    if (textareaRef.value) {
      textareaRef.value.style.height = 'auto'
    }
    return
  }

  // 检测是否是斜杠命令
  const slashResult = resolveDirectSlash(content)

  if (slashResult.action === 'immediate_command') {
    // 立即执行命令
    const commandName = content.slice(1).split(/\s+/)[0]
    const commandArgs = content.slice(1 + commandName.length).trim()
    inputText.value = ''
    emit('slash-command', commandName, commandArgs, attachedFiles.value)
  } else if (slashResult.action === 'set_badge' && slashResult.badge) {
    // 设置为 Badge，等待用户添加上下文
    activeBadge.value = slashResult.badge
    inputText.value = ''
    if (textareaRef.value) {
      textareaRef.value.style.height = 'auto'
    }
  } else if (slashResult.action === 'unknown_slash_badge' && slashResult.badge) {
    // 未知命令也作为 Badge 处理
    activeBadge.value = slashResult.badge
    inputText.value = ''
    if (textareaRef.value) {
      textareaRef.value.style.height = 'auto'
    }
  } else {
    // 普通消息
    emit('send', content, attachedFiles.value)
  }

  inputText.value = ''
  attachedFiles.value = []

  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }
}

// 清除 Badge
function clearBadge() {
  activeBadge.value = null
  textareaRef.value?.focus()
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

function selectMode(mode: string) {
  selectedMode.value = mode
  showModeDropdown.value = false
}

function closeModeDropdown() {
  showModeDropdown.value = false
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
      }
    }
  } catch (error) {
    console.error('Failed to select folder:', error)
  }
}

function removeAttachment(index: number) {
  attachedFiles.value.splice(index, 1)
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
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleModelKeydown)
})

// 清理事件监听
watch(showModelDropdown, (open) => {
  if (!open) {
    modelSearchQuery.value = ''
  }
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

// 附件栏样式
.attachments-bar {
  margin-bottom: 12px;
  padding: 0 4px;
}

.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary);
  transition: all 0.15s ease;

  &.is-folder {
    background: var(--accent-primary-glow);
    border-color: var(--accent-primary);
  }

  svg {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .attachment-name {
    max-width: 200px;
    @include truncate;
  }

  .remove-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    color: var(--text-muted);
    transition: all 0.15s ease;

    &:hover {
      background: var(--surface-hover);
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
}

// 文本输入区域
.textarea-wrapper {
  flex: 1;
  min-height: 24px;
  margin-bottom: 12px;

  textarea {
    width: 100%;
    resize: none;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 15px;
    line-height: 1.5;
    max-height: 200px;
    padding: 0;

    &::placeholder {
      color: var(--text-muted);
    }

    &:disabled {
      opacity: 0.6;
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
.mode-selector {
  position: relative;
}

.model-btn,
.mode-btn {
  background: transparent;

  .model-name,
  .mode-name {
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
.mode-dropdown {
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

// 命令 Badge 样式
.command-badge-bar {
  margin-bottom: 12px;
  padding: 0 4px;
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

.attachments-enter-active,
.attachments-leave-active {
  transition: all 0.2s ease;
}

.attachments-enter-from,
.attachments-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
