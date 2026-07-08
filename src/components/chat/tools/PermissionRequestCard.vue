<template>
  <div class="permission-request-card" :class="[`tool-${toolName}`, status]">
    <!-- 卡片头部 -->
    <div class="card-header">
      <div class="tool-badge">
        <component :is="toolIcon" :size="16" />
        <span>{{ toolDisplayName }}</span>
      </div>
      <span v-if="isDangerous" class="danger-indicator">
        {{ t('permission.card.status.dangerWarning') }}
      </span>
    </div>

    <!-- 动态内容区域 -->
    <div class="card-content">
      <!-- Edit/Write/Read 工具：文件信息展示 -->
      <template v-if="isFileOperation">
        <div class="file-info">
          <FileTextIcon :size="14" />
          <span class="file-path">{{ filePath }}</span>
        </div>
        
        <div v-if="hasDiffContent" class="diff-preview">
          <div class="diff-old">
            <span class="diff-label">-</span>
            <pre>{{ truncatedOldString }}</pre>
          </div>
          <div class="diff-new">
            <span class="diff-label">+</span>
            <pre>{{ truncatedNewString }}</pre>
          </div>
        </div>
      </template>

      <!-- Bash 工具：命令展示 -->
      <template v-else-if="toolName === 'Bash'">
        <div class="command-preview">
          <TerminalIcon :size="14" />
          <code class="command-text">{{ commandText }}</code>
        </div>
      </template>

      <!-- 其他工具：通用信息展示 -->
      <template v-else>
        <div class="generic-info">
          <pre class="json-preview">{{ formattedInput }}</pre>
        </div>
      </template>
    </div>

    <!-- 操作按钮区 -->
    <div class="card-actions" v-if="status === 'pending'">
      <button 
        class="action-btn deny" 
        @click="handleDeny" 
        :disabled="isProcessing"
      >
        <X :size="16" />
        {{ t('permission.card.actions.deny') }}
      </button>
      
      <button 
        v-if="showAlwaysAllow" 
        class="action-btn always-allow" 
        @click="handleAlwaysAllow"
        :disabled="isProcessing"
      >
        <CheckCheck :size="16" />
        {{ t('permission.card.actions.alwaysAllow') }}
      </button>
      
      <button 
        class="action-btn allow primary" 
        @click="handleAllow" 
        :disabled="isProcessing"
      >
        <Check :size="16" />
        {{ t('permission.card.actions.allow') }}
      </button>
    </div>

    <!-- 处理状态反馈 -->
    <div class="card-status" v-else>
      <Loader2 
        v-if="status === 'processing'" 
        :size="16" 
        class="spin" 
      />
      <CheckCircle 
        v-if="status === 'completed'" 
        :size="16" 
        class="status-icon success" 
      />
      <XCircle 
        v-if="status === 'denied'" 
        :size="16" 
        class="status-icon error" 
      />
      <span class="status-text">
        {{ statusText }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { 
  Check, X, CheckCheck, Loader2, CheckCircle, XCircle,
  FileEdit, Terminal as TerminalIcon, FileText as FileTextIcon, Shield
} from 'lucide-vue-next'
import { useTurnStore } from '@/stores/chat'

interface Props {
  messageId: string
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
}

const props = defineProps<Props>()
const { t } = useI18n()
const turnStore = useTurnStore()

const status = ref<'pending' | 'processing' | 'completed' | 'denied'>('pending')
const isProcessing = ref(false)

const toolIconMap: Record<string, any> = {
  'Edit': FileEdit,
  'Write': FileEdit,
  'Read': FileTextIcon,
  'Bash': TerminalIcon,
}

const toolIcon = computed(() => toolIconMap[props.toolName] || Shield)

const toolDisplayName = computed(() => {
  const key = `permission.card.toolNames.${props.toolName}`
  const translated = t(key)
  return translated === key ? props.toolName : translated
})

const isDangerous = computed(() => ['Bash'].includes(props.toolName))

const isFileOperation = computed(() => 
  ['Edit', 'Write', 'Read'].includes(props.toolName)
)

const filePath = computed(() => 
  (props.input.file_path as string) || t('toolCards.permissionUnknownFile')
)

const commandText = computed(() => 
  (props.input.command as string) || ''
)

const oldString = computed(() => props.input.old_string as string || '')
const newString = computed(() => props.input.new_string as string || '')
const hasDiffContent = computed(() => !!oldString.value && !!newString.value)

const MAX_PREVIEW_LENGTH = 200
const truncatedOldString = computed(() => 
  truncate(oldString.value, MAX_PREVIEW_LENGTH)
)
const truncatedNewString = computed(() => 
  truncate(newString.value, MAX_PREVIEW_LENGTH)
)

const formattedInput = computed(() => 
  JSON.stringify(props.input, null, 2)
)

const showAlwaysAllow = computed(() => 
  ['Edit', 'Read', 'Write'].includes(props.toolName)
)

const statusText = computed(() => {
  switch (status.value) {
    case 'processing': return t('permission.card.actions.processing')
    case 'completed': return t('permission.card.actions.completed')
    case 'denied': return t('permission.card.actions.denied')
    default: return t('permission.card.status.requestPending')
  }
})

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

async function handleAllow() {
  isProcessing.value = true
  status.value = 'processing'
  
  try {
    await turnStore.allowPermission(
      props.messageId, 
      props.toolUseId, 
      props.input
    )
    status.value = 'completed'
  } catch (error) {
    console.error(t('permission.card.errors.allowFailed'), error)
    status.value = 'pending'
  } finally {
    isProcessing.value = false
  }
}

async function handleDeny() {
  isProcessing.value = true
  status.value = 'processing'
  
  try {
    await turnStore.denyPermission(
      props.messageId, 
      props.toolUseId, 
      t('permission.card.actions.denied')
    )
    status.value = 'denied'
  } catch (error) {
    console.error(t('permission.card.errors.denyFailed'), error)
    status.value = 'pending'
  } finally {
    isProcessing.value = false
  }
}

async function handleAlwaysAllow() {
  isProcessing.value = true
  status.value = 'processing'
  
  try {
    await turnStore.allowPermission(
      props.messageId, 
      props.toolUseId, 
      props.input, 
      'user_permanent'
    )
    status.value = 'completed'
  } catch (error) {
    console.error(t('permission.card.errors.allowFailed'), error)
    status.value = 'pending'
  } finally {
    isProcessing.value = false
  }
}
</script>

<style scoped>
.permission-request-card {
  margin: 12px 0;
  padding: 16px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  transition: all 0.3s ease;
}

.permission-request-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.permission-request-card.tool-Bash {
  border-left: 3px solid #f59e0b;
}

.permission-request-card.tool-Edit,
.permission-request-card.tool-Write {
  border-left: 3px solid #3b82f6;
}

.permission-request-card.completed {
  border-left-color: #10b981;
}

.permission-request-card.denied {
  border-left-color: #ef4444;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.tool-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.danger-indicator {
  font-size: 12px;
  color: #f59e0b;
  font-weight: 500;
}

.card-content {
  margin-bottom: 16px;
  font-size: 13px;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-secondary);
  border-radius: 6px;
  margin-bottom: 12px;
  color: var(--text-secondary);
}

.file-path {
  font-family: monospace;
  font-size: 12px;
  word-break: break-all;
}

.diff-preview {
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  overflow: hidden;
}

.diff-old,
.diff-new {
  display: flex;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.5;
}

.diff-old {
  background: rgba(239, 68, 68, 0.05);
  border-bottom: 1px solid var(--surface-border);
  color: #dc2626;
}

.diff-new {
  background: rgba(16, 185, 129, 0.05);
  color: #059669;
}

.diff-label {
  font-weight: bold;
  margin-right: 8px;
}

.diff-old pre,
.diff-new pre {
  margin: 0;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.command-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--surface-secondary);
  border-radius: 6px;
  font-family: monospace;
}

.command-text {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
}

.generic-info {
  padding: 12px;
  background: var(--surface-secondary);
  border-radius: 6px;
  max-height: 200px;
  overflow-y: auto;
}

.json-preview {
  margin: 0;
  font-family: monospace;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.card-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--surface-glass);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  background: var(--surface-glass-hover);
  transform: translateY(-1px);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.deny:hover:not(:disabled) {
  border-color: #ef4444;
  color: #ef4444;
}

.action-btn.always-allow:hover:not(:disabled) {
  border-color: #3b82f6;
  color: #3b82f6;
}

.action-btn.primary {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

.action-btn.primary:hover:not(:disabled) {
  background: #2563eb;
  border-color: #2563eb;
}

.card-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  font-size: 13px;
  color: var(--text-tertiary);
}

.status-icon.success {
  color: #10b981;
}

.status-icon.error {
  color: #ef4444;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
