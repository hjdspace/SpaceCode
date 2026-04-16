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

          <!-- 模型选择器 -->
          <div class="model-selector">
            <button class="toolbar-btn model-btn" @click="showModelDropdown = !showModelDropdown">
              <span class="model-name">{{ selectedModelLabel }}</span>
              <ChevronDown :size="14" class="dropdown-icon" :class="{ open: showModelDropdown }" />
            </button>
            <!-- 模型下拉菜单 -->
            <Transition name="dropdown">
              <div v-if="showModelDropdown" class="model-dropdown" v-click-outside="closeModelDropdown">
                <div class="dropdown-header">Model</div>
                <div class="dropdown-list">
                  <button
                    v-for="model in availableModels"
                    :key="model.value"
                    class="dropdown-item"
                    :class="{ active: selectedModel === model.value }"
                    @click="selectModel(model.value)"
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
          @click="handleSend"
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
import { ref, computed, onMounted } from 'vue'
import { ArrowUp, Plus, ChevronDown, Check, FileText, Folder, Square, X } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { api } from '@/services/electronAPI'

export interface Attachment {
  name: string
  path: string
  isFolder: boolean
}

const emit = defineEmits<{
  send: [content: string, attachments: Attachment[]]
}>()

const props = defineProps<{
  disabled?: boolean
  isSending?: boolean
  placeholder?: string
}>()

const settingsStore = useSettingsStore()

const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const showModelDropdown = ref(false)
const showModeDropdown = ref(false)
const showAttachmentMenu = ref(false)
const attachedFiles = ref<Attachment[]>([])

// 模式列表
const availableModes = ['Speed', 'Balance', 'Quality']
const selectedMode = ref('Balance')

// 模型列表 - 可以从设置中配置
const availableModels = computed(() => {
  const models: { label: string; value: string }[] = []

  // 根据当前认证方式获取可用模型
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
      // 添加用户自定义的模型
      if (settingsStore.anthropicConfig.sonnetModel) {
        const customModel = settingsStore.anthropicConfig.sonnetModel
        if (!models.some(m => m.value === customModel)) {
          models.unshift({ label: customModel, value: customModel })
        }
      }
      break
    case 'openai_compatible':
      models.push(
        { label: 'GPT-4', value: 'gpt-4' },
        { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
        { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' }
      )
      if (settingsStore.openaiConfig.sonnetModel) {
        const customModel = settingsStore.openaiConfig.sonnetModel
        if (!models.some(m => m.value === customModel)) {
          models.unshift({ label: customModel, value: customModel })
        }
      }
      break
    case 'gemini_api':
      models.push(
        { label: 'Gemini Pro', value: 'gemini-pro' },
        { label: 'Gemini Pro Vision', value: 'gemini-pro-vision' }
      )
      if (settingsStore.geminiConfig.sonnetModel) {
        const customModel = settingsStore.geminiConfig.sonnetModel
        if (!models.some(m => m.value === customModel)) {
          models.unshift({ label: customModel, value: customModel })
        }
      }
      break
  }

  return models
})

const selectedModel = ref('')

// 初始化选中的模型
onMounted(() => {
  const config = settingsStore.config
  selectedModel.value = config.model || availableModels.value[0]?.value || ''
})

const selectedModelLabel = computed(() => {
  const model = availableModels.value.find(m => m.value === selectedModel.value)
  return model?.label || selectedModel.value || 'Select Model'
})

const hasContent = computed(() => inputText.value.trim().length > 0)
const canSend = computed(() => hasContent.value && !props.isSending)

function handleSend() {
  if ((!canSend.value && attachedFiles.value.length === 0) || props.disabled) return

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
}

function closeModelDropdown() {
  showModelDropdown.value = false
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
</script>

<style lang="scss" scoped>
.chat-input-container {
  padding: 16px 20px 20px;
  background: var(--bg-primary);
  flex-shrink: 0;
  position: relative;
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
  min-width: 220px;
}

.dropdown-header {
  padding: 12px 16px 8px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--surface-border);
}

.dropdown-list {
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
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
  transition: background 0.15s ease;

  &:hover {
    background: var(--surface-hover);
  }

  &.active {
    background: var(--surface-active);
  }

  .item-name {
    @include truncate;
  }

  .check-icon {
    color: var(--accent-primary);
    flex-shrink: 0;
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
