<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="modal-overlay" @click.self="close">
        <div class="modal">
          <div class="modal-header">
            <div class="modal-title">
              {{ isEdit ? t('cron.modal.editTitle') : t('cron.modal.createTitle') }}
            </div>
            <button class="modal-close" @click="close">
              <X :size="18" />
            </button>
          </div>

          <div class="modal-body">
            <!-- Task Name -->
            <div class="form-group">
              <label class="form-label">
                {{ t('cron.modal.taskName') }}
                <span class="optional">{{ t('cron.modal.optional') }}</span>
              </label>
              <input
                v-model="form.name"
                type="text"
                class="form-input"
                :placeholder="t('cron.modal.taskNamePlaceholder')"
              />
            </div>

            <!-- Frequency -->
            <div class="form-group">
              <label class="form-label">{{ t('cron.modal.frequency') }}</label>
              <div class="frequency-grid">
                <div
                  v-for="opt in frequencyOptions"
                  :key="opt.value"
                  class="frequency-option"
                  :class="{ selected: form.frequency === opt.value }"
                  @click="form.frequency = opt.value"
                >
                  {{ opt.label }}
                </div>
              </div>
            </div>

            <!-- Custom Cron (shown when frequency is 'custom') -->
            <div v-if="form.frequency === 'custom'" class="form-group">
              <label class="form-label">{{ t('cron.modal.customCron') }}</label>
              <input
                v-model="form.customCron"
                type="text"
                class="form-input form-input--mono"
                placeholder="* * * * *"
              />
            </div>

            <!-- Time (hidden for hourly and custom) -->
            <div v-if="showTimePicker" class="form-group">
              <label class="form-label">{{ t('cron.modal.time') }}</label>
              <div class="time-picker-row">
                <input
                  v-model="form.hour"
                  type="text"
                  class="time-input"
                  maxlength="2"
                  @blur="normalizeTime('hour')"
                />
                <span class="time-separator">:</span>
                <input
                  v-model="form.minute"
                  type="text"
                  class="time-input"
                  maxlength="2"
                  @blur="normalizeTime('minute')"
                />
              </div>
            </div>

            <!-- Task Type -->
            <div class="form-group">
              <label class="form-label">{{ t('cron.modal.taskType') }}</label>
              <div class="type-group">
                <div
                  class="type-option"
                  :class="{ selected: form.recurring }"
                  @click="form.recurring = true"
                >
                  <div class="type-radio" />
                  <span>{{ t('cron.modal.recurring') }}</span>
                </div>
                <div
                  class="type-option"
                  :class="{ selected: !form.recurring }"
                  @click="form.recurring = false"
                >
                  <div class="type-radio" />
                  <span>{{ t('cron.modal.oneShot') }}</span>
                </div>
              </div>
            </div>

            <!-- Prompt — 与主聊天共用同一个输入框（/ 技能、@ 上下文、图片）。
                 放在表单末尾：输入框下方的工作空间/分支下拉向上展开，需要留出身位 -->
            <div class="form-group prompt-group">
              <label class="form-label">{{ t('cron.modal.prompt') }}</label>
              <ChatInput
                ref="promptInputRef"
                draft-scope="none"
                compact
                :working-directory="effectiveWorkspace"
                :model-value="form.model"
                :permission-mode="form.permissionMode"
                :placeholder="t('cron.modal.promptPlaceholder')"
                @send="handleSend"
                @slash-command="handleSlashCommand"
                @update:model="(m: string) => form.model = m"
                @update:effort="(e: string) => form.effort = e"
                @update:agent="(a: string) => form.agent = a"
                @update:permission-mode="(m: PermissionMode) => form.permissionMode = m"
              >
                <template #context-toolbar>
                  <ChatContextToolbar
                    :workspace="form.workspace"
                    :branch="form.branch"
                    @update:workspace="handleWorkspaceChange"
                    @update:branch="(b: string) => form.branch = b"
                  />
                </template>
              </ChatInput>
            </div>

            <!-- Cron Preview -->
            <div v-if="cronExpression" class="cron-preview">
              <span class="cron-preview-expr">{{ cronExpression }}</span>
              <span class="cron-preview-sep" />
              <span class="cron-preview-desc">{{ cronDescription }}</span>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-secondary" @click="close">
              {{ t('common.cancel') }}
            </button>
            <button
              class="btn btn-primary"
              :disabled="submitting || !canSubmit"
              @click="handleSubmitClick"
            >
              {{ isEdit ? t('cron.modal.save') : t('cron.modal.create') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useCronStore, type CronTask } from '@/stores/cron'
import { useAppStore } from '@/stores/app'
import { usePermissionPolicyStore } from '@/stores/permissionPolicy'
import { useDialog } from '@/composables/useDialog'
import { api, type CronAttachment } from '@/services/electronAPI'
import type { PermissionMode } from '@/shared/channels/claudeCode'
import type { ImageAttachment } from '@/composables/types'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatContextToolbar from '@/components/chat/ChatContextToolbar.vue'

interface Props {
  visible: boolean
  editTask?: CronTask
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const { t } = useI18n()
const cronStore = useCronStore()
const appStore = useAppStore()
const permissionPolicy = usePermissionPolicyStore()
const { showAlert } = useDialog()

const isEdit = computed(() => !!props.editTask?.id)
const submitting = ref(false)
const promptInputRef = ref<InstanceType<typeof ChatInput> | null>(null)

const frequencyOptions = computed(() => [
  { value: 'hourly', label: t('cron.modal.freqHourly') },
  { value: 'daily', label: t('cron.modal.freqDaily') },
  { value: 'weekdays', label: t('cron.modal.freqWeekdays') },
  { value: 'weekly', label: t('cron.modal.freqWeekly') },
  { value: 'monthly', label: t('cron.modal.freqMonthly') },
  { value: 'custom', label: t('cron.modal.freqCustom') },
])

const showTimePicker = computed(() => form.frequency !== 'hourly' && form.frequency !== 'custom')

interface FormState {
  name: string
  /** 编辑器内容的初始值；提交时以编辑器实时内容为准 */
  prompt: string
  frequency: string
  hour: string
  minute: string
  customCron: string
  recurring: boolean
  workspace: string
  branch: string
  model: string
  effort: string
  agent: string
  permissionMode: PermissionMode
}

const defaultForm = (): FormState => ({
  name: '',
  prompt: '',
  frequency: 'daily',
  hour: '09',
  minute: '00',
  customCron: '',
  recurring: true,
  workspace: appStore.projectRoot || '',
  branch: '',
  model: '',
  effort: '',
  agent: '',
  permissionMode: permissionPolicy.currentPermissionMode,
})

const form = reactive<FormState>(defaultForm())

/** 提示词里的 @ 上下文与 / 技能按任务自己的工作空间解析 */
const effectiveWorkspace = computed(() => form.workspace || appStore.projectRoot || '')

function buildCron(frequency: string, hour: number, minute: number, customCron?: string): string {
  if (frequency === 'custom' && customCron) return customCron
  switch (frequency) {
    case 'hourly': return `${minute} * * * *`
    case 'daily': return `${minute} ${hour} * * *`
    case 'weekdays': return `${minute} ${hour} * * 1-5`
    case 'weekly': return `${minute} ${hour} * * 1`
    case 'monthly': return `${minute} ${hour} 1 * *`
    default: return `${minute} ${hour} * * *`
  }
}

const cronExpression = computed(() => {
  const h = parseInt(form.hour) || 0
  const m = parseInt(form.minute) || 0
  return buildCron(form.frequency, h, m, form.customCron || undefined)
})

const cronDescription = ref('')
const cronValid = ref(true)

/** 频率非法或没有可写入任务文件的项目时不给创建，避免提交后清空编辑器丢内容 */
const canSubmit = computed(() => cronValid.value && !!appStore.projectRoot)

watch(cronExpression, async (expr) => {
  try {
    const result = await cronStore.validateCron(expr)
    cronValid.value = result.valid
    cronDescription.value = result.valid ? await cronStore.describeCron(expr) : expr
  } catch {
    cronValid.value = false
    cronDescription.value = expr
  }
}, { immediate: true })

function normalizeTime(field: 'hour' | 'minute') {
  if (field === 'hour') {
    const v = parseInt(form.hour) || 0
    form.hour = String(Math.max(0, Math.min(23, v))).padStart(2, '0')
  } else {
    const v = parseInt(form.minute) || 0
    form.minute = String(Math.max(0, Math.min(59, v))).padStart(2, '0')
  }
}

function populateFromTask(task: CronTask) {
  form.name = task.name || ''
  form.prompt = task.prompt || ''
  form.frequency = task.frequency || 'daily'
  form.recurring = task.recurring !== false
  form.customCron = task.frequency === 'custom' ? task.cron : ''
  form.workspace = task.workspace || appStore.projectRoot || ''
  form.branch = task.branch || ''
  form.model = task.model || ''
  form.effort = task.effort || ''
  form.agent = task.agent || ''
  form.permissionMode = (task.permissionMode as PermissionMode) || permissionPolicy.currentPermissionMode

  if (task.scheduledTime) {
    const parts = task.scheduledTime.split(':')
    form.hour = parts[0] || '09'
    form.minute = parts[1] || '00'
  } else {
    // Try to parse from cron expression
    const cronParts = task.cron.split(/\s+/)
    if (cronParts.length >= 2) {
      form.minute = cronParts[0].padStart(2, '0')
      form.hour = cronParts[1].padStart(2, '0')
    }
  }
}

watch(() => props.visible, async (val) => {
  if (!val) return
  Object.assign(form, defaultForm())
  if (props.editTask) populateFromTask(props.editTask)
  await nextTick()
  promptInputRef.value?.setContent(form.prompt)
  promptInputRef.value?.focus()
})

function close() {
  emit('update:visible', false)
}

function handleEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleEsc)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleEsc)
})

/** 换工作空间后旧仓库的分支不再相关 */
function handleWorkspaceChange(path: string) {
  form.workspace = path
  form.branch = ''
}

function handleSend(content: string, attachments: { images: ImageAttachment[] }) {
  submit(content, attachments.images)
}

/** 斜杠命令对定时任务而言就是提示词正文，不执行聊天侧的即时命令 */
function handleSlashCommand(command: string, args: string, attachments: { images: ImageAttachment[] }) {
  submit(`/${command}${args ? ` ${args}` : ''}`, attachments.images)
}

function handleSubmitClick() {
  const captured = promptInputRef.value?.getContent()
  if (!captured) return
  submit(captured.text, captured.attachments.images)
}

async function submit(content: string, images: ImageAttachment[]) {
  if (submitting.value) return
  const prompt = content.trim()
  if (!prompt) return

  // 聊天输入框 send 后会自行清空，所以这些校验失败的路径都要把内容放回去
  const projectRoot = appStore.projectRoot
  if (!projectRoot) {
    await showAlert(t('cron.modal.noProject'))
    restorePrompt(prompt)
    return
  }
  if (!cronValid.value) {
    await showAlert(t('cron.modal.invalidSchedule'))
    restorePrompt(prompt)
    return
  }

  const h = parseInt(form.hour) || 0
  const m = parseInt(form.minute) || 0
  const cron = buildCron(form.frequency, h, m, form.customCron || undefined)

  submitting.value = true
  try {
    const root = form.workspace || projectRoot
    const attachments: CronAttachment[] = []
    for (const img of images) {
      const result = await api.cron.saveAttachment(root, {
        id: img.id,
        name: img.name,
        dataUrl: img.data,
      })
      if (!result?.path) {
        await showAlert(t('cron.modal.attachmentFailed', { name: img.name }))
        restorePrompt(prompt)
        return
      }
      attachments.push({ id: img.id, name: img.name, path: result.path })
    }

    const payload = {
      name: form.name.trim() || prompt.split('\n')[0].slice(0, 40),
      cron,
      prompt,
      recurring: form.recurring,
      frequency: form.frequency,
      scheduledTime: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      workspace: form.workspace || undefined,
      branch: form.branch || undefined,
      model: form.model || undefined,
      effort: form.effort || undefined,
      agent: form.agent || undefined,
      permissionMode: form.permissionMode,
      attachments: attachments.length ? attachments : undefined,
    }

    if (isEdit.value && props.editTask?.id) {
      await cronStore.updateTask(projectRoot, props.editTask.id, payload)
    } else {
      await cronStore.createTask(projectRoot, { ...payload, enabled: true })
    }
    close()
  } catch (err: any) {
    await showAlert(t('cron.modal.saveFailed', { error: err?.message || String(err) }))
    restorePrompt(prompt)
  } finally {
    submitting.value = false
  }
}

/** 聊天输入框 send 后会自行清空，保存失败时把用户写的内容放回去 */
function restorePrompt(prompt: string) {
  promptInputRef.value?.setContent(prompt)
}
</script>

<style lang="scss" scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  width: 680px;
  max-width: calc(100vw - 48px);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.modal-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  transition: all var(--transition-fast);
  border: none;
  background: none;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.modal-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--border-strong);
    border-radius: 3px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--text-disabled);
  }
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-subtle);
}

// Form elements
.form-group {
  margin-bottom: 18px;
}

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;

  .optional {
    color: var(--text-disabled);
    font-weight: 400;
    margin-left: 4px;
  }
}

.form-input {
  width: 100%;
  padding: 9px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 13px;
  transition: all var(--transition-fast);
  outline: none;

  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }

  &::placeholder {
    color: var(--text-disabled);
  }

  &--mono {
    font-family: var(--font-mono);
  }
}

// 复用聊天输入框：去掉它作为「页面底部栏」的外边距与分隔线
.prompt-group {
  :deep(.chat-input-container) {
    padding: 0;
    background: transparent;
    border-top: none;
  }

  :deep(.inline-editor) {
    max-height: 220px;
    overflow-y: auto;
  }
}

// Frequency selector
.frequency-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.frequency-option {
  padding: 10px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
  cursor: pointer;

  &:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  &.selected {
    background: var(--accent-primary-glow);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
}

// Time picker
.time-picker-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.time-input {
  width: 64px;
  padding: 9px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-base);
  font-family: var(--font-mono);
  text-align: center;
  outline: none;
  transition: all var(--transition-fast);

  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }
}

.time-separator {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-muted);
}

// Task type radio
.type-group {
  display: flex;
  gap: 16px;
}

.type-option {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
}

.type-radio {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  flex-shrink: 0;

  .type-option.selected & {
    border-color: var(--accent-primary);

    &::after {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-primary);
    }
  }
}

// Cron preview
.cron-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  margin-top: 6px;
}

.cron-preview-expr {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--accent-primary);
  font-weight: 500;
}

.cron-preview-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.cron-preview-sep {
  width: 1px;
  height: 16px;
  background: var(--border-default);
}

// Buttons
.btn {
  padding: 8px 18px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  transition: all var(--transition-fast);
  cursor: pointer;
  border: none;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn-secondary {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.btn-primary {
  background: var(--accent-primary);
  color: #fff;
  box-shadow: 0 1px 3px rgba(13, 148, 136, 0.2);

  &:hover:not(:disabled) {
    background: var(--accent-primary-hover);
    box-shadow: 0 2px 6px rgba(13, 148, 136, 0.3);
  }
}

// Modal transition
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--transition-normal);

  .modal {
    transition: transform var(--transition-normal);
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .modal {
    transform: translateY(12px) scale(0.97);
  }
}

.modal-enter-to,
.modal-leave-from {
  opacity: 1;

  .modal {
    transform: translateY(0) scale(1);
  }
}
</style>
