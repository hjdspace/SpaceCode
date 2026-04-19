<template>
  <div class="chat-input-container">
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
          @input="autoResize"
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

        <!-- 发送按钮 -->
        <button
          class="send-btn"
          :class="{ 'has-content': hasContent || attachedFiles.length > 0, 'is-sending': isSending }"
          :disabled="(!canSend && attachedFiles.length === 0) || disabled"
          @click.stop.prevent="handleSend"
        >
          <ArrowUp v-if="!isSending" :size="18" />
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
  Search, Loader2, RefreshCw, AlertCircle 
} from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
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

const emit = defineEmits<{
  send: [content: string, attachments: Attachment[]]
  'update:model': [model: string]
}>()

const props = defineProps<{
  disabled?: boolean
  isSending?: boolean
  placeholder?: string
  modelValue?: string
}>()

const settingsStore = useSettingsStore()

const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const showModelDropdown = ref(false)
const showModeDropdown = ref(false)
const showAttachmentMenu = ref(false)
const attachedFiles = ref<Attachment[]>([])

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

function handleSend() {
  if ((!canSend.value && attachedFiles.value.length === 0) || props.disabled) return

  // 关闭所有下拉菜单
  showModelDropdown.value = false
  showModeDropdown.value = false
  showAttachmentMenu.value = false
  modelSearchQuery.value = ''

  emit('send', inputText.value, attachedFiles.value)
  inputText.value = ''
  attachedFiles.value = []

  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }
}

function autoResize() {
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
    textareaRef.value.style.height = Math.min(textareaRef.value.scrollHeight, 200) + 'px'
  }
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
