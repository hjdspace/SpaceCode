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

      <!-- ExitPlanMode：只展示计划正文（Markdown），input 的其余字段一律不显示 -->
      <template v-else-if="isPlanApproval">
        <div v-if="planContent" class="plan-preview">
          <MarkdownRenderer :content="planContent" />
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
        {{ alwaysAllowLabel }}
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
  FileEdit, Terminal as TerminalIcon, FileText as FileTextIcon, Shield,
  ClipboardCheck
} from 'lucide-vue-next'
import { useTurnStore } from '@/stores/turn'
import { isPermissionGrantPermanent } from '@/utils/permissionScope'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

interface Props {
  messageId: string
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
  /**
   * 卡片所属的会话。嵌入式面板（看板接管面板、侧边任务）显示的会话不是
   * currentSessionId，缺这一层就会把应答送到用户正在看的另一条会话上。
   */
  sessionId?: string
}

const props = defineProps<Props>()
const { t, te } = useI18n()
const turnStore = useTurnStore()

const status = ref<'pending' | 'processing' | 'completed' | 'denied'>('pending')
const isProcessing = ref(false)

const toolIconMap: Record<string, any> = {
  'Edit': FileEdit,
  'Write': FileEdit,
  'Read': FileTextIcon,
  'Bash': TerminalIcon,
  'ExitPlanMode': ClipboardCheck,
}

const toolIcon = computed(() => toolIconMap[props.toolName] || Shield)

const toolDisplayName = computed(() => {
  const key = `permission.card.toolNames.${props.toolName}`
  // te 先探路：未知工具名直接回退原始名，避免 vue-i18n 刷 missing key 告警
  if (!te(key)) return props.toolName
  return t(key)
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

const isPlanApproval = computed(() => props.toolName === 'ExitPlanMode')

const planContent = computed(() => {
  const plan = props.input.plan
  return typeof plan === 'string' ? plan.trim() : ''
})

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

// 引擎在 can_use_tool 里随请求附带 permission_suggestions —— 那才是"始终允许"的内容。
// 没有它就没有任何可落地的规则，按钮也就无从生效，所以按它驱动显隐，而不是按工具名猜。
const permissionSuggestions = computed(
  () => turnStore.getPendingPermissionForToolUse(props.toolUseId, props.sessionId)?.permissionSuggestions,
)

const showAlwaysAllow = computed(() => !!permissionSuggestions.value?.length)

const alwaysAllowLabel = computed(() =>
  isPermissionGrantPermanent(permissionSuggestions.value)
    ? t('permission.card.actions.alwaysAllow')
    : t('permission.card.actions.allowForThisSession'),
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
      props.input,
      undefined,
      undefined,
      props.sessionId
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
      t('permission.card.actions.denied'),
      {},
      props.sessionId
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

  // 必须在 allowPermission 之前取：它会 consume 掉 pending 条目，之后 computed 就空了。
  const suggestions = permissionSuggestions.value
  try {
    await turnStore.allowPermission(
      props.messageId,
      props.toolUseId,
      props.input,
      'user_permanent',
      suggestions,
      props.sessionId
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

<style scoped lang="scss">
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
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
}

.danger-indicator {
  font-size: var(--text-sm);
  color: #f59e0b;
  font-weight: 500;
}

.card-content {
  margin-bottom: 16px;
  font-size: var(--text-md);
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
  font-size: var(--text-sm);
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
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
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
  font-size: var(--text-md);
  color: var(--text-primary);
  word-break: break-all;
}

.generic-info {
  padding: 12px;
  background: var(--surface-secondary);
  border-radius: 6px;
  max-height: 200px;
  overflow-y: auto;
  @include scrollbar-overlay;
}

.json-preview {
  margin: 0;
  font-family: monospace;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.plan-preview {
  padding: 4px 14px 12px;
  background: var(--surface-soft);
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  max-height: 480px;
  overflow-y: auto;
  @include scrollbar-overlay;
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
  font-size: var(--text-md);
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
  font-size: var(--text-md);
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
