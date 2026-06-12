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
              <label class="form-label">{{ t('cron.modal.taskName') }}</label>
              <input
                v-model="form.name"
                type="text"
                class="form-input"
                :placeholder="t('cron.modal.taskNamePlaceholder')"
              />
            </div>

            <!-- Description -->
            <div class="form-group">
              <label class="form-label">
                {{ t('cron.modal.taskDesc') }}
                <span class="optional">{{ t('cron.modal.optional') }}</span>
              </label>
              <input
                v-model="form.description"
                type="text"
                class="form-input"
                :placeholder="t('cron.modal.taskDescPlaceholder')"
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

            <!-- Prompt -->
            <div class="form-group">
              <label class="form-label">{{ t('cron.modal.prompt') }}</label>
              <textarea
                v-model="form.prompt"
                class="form-input"
                :placeholder="t('cron.modal.promptPlaceholder')"
                rows="4"
              />
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
            <button class="btn btn-primary" :disabled="submitting" @click="handleSubmit">
              {{ isEdit ? t('cron.modal.save') : t('cron.modal.create') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useCronStore, type CronTask } from '@/stores/cron'
import { useAppStore } from '@/stores/app'

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

const isEdit = computed(() => !!props.editTask?.id)
const submitting = ref(false)

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
  description: string
  frequency: string
  hour: string
  minute: string
  customCron: string
  recurring: boolean
  prompt: string
}

const defaultForm = (): FormState => ({
  name: '',
  description: '',
  frequency: 'daily',
  hour: '09',
  minute: '00',
  customCron: '',
  recurring: true,
  prompt: '',
})

const form = reactive<FormState>(defaultForm())

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

watch(cronExpression, async (expr) => {
  try {
    cronDescription.value = await cronStore.describeCron(expr)
  } catch {
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

function resetForm() {
  Object.assign(form, defaultForm())
  if (props.editTask) {
    populateFromTask(props.editTask)
  }
}

function populateFromTask(task: CronTask) {
  form.name = task.name || ''
  form.description = task.description || ''
  form.frequency = task.frequency || 'daily'
  form.recurring = task.recurring !== false
  form.prompt = task.prompt || ''
  form.customCron = task.frequency === 'custom' ? task.cron : ''

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

watch(() => props.visible, (val) => {
  if (val) {
    resetForm()
  }
})

watch(() => props.editTask, (task) => {
  if (task && props.visible) {
    populateFromTask(task)
  }
}, { immediate: true })

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

async function handleSubmit() {
  if (!form.name.trim()) return

  const h = parseInt(form.hour) || 0
  const m = parseInt(form.minute) || 0
  const cron = buildCron(form.frequency, h, m, form.customCron || undefined)

  // Validate cron expression
  try {
    const result = await cronStore.validateCron(cron)
    if (!result.valid) return
  } catch {
    return
  }

  submitting.value = true
  try {
    const projectRoot = appStore.projectRoot
    if (!projectRoot) return

    const scheduledTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

    if (isEdit.value && props.editTask?.id) {
      await cronStore.updateTask(projectRoot, props.editTask.id, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        cron,
        prompt: form.prompt.trim(),
        recurring: form.recurring,
        frequency: form.frequency,
        scheduledTime,
      })
    } else {
      await cronStore.createTask(projectRoot, {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        cron,
        prompt: form.prompt.trim(),
        recurring: form.recurring,
        frequency: form.frequency,
        scheduledTime,
        enabled: true,
      })
    }
    close()
  } finally {
    submitting.value = false
  }
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
  width: 520px;
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

textarea.form-input {
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
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
  font-size: var(--font-size-base);
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
