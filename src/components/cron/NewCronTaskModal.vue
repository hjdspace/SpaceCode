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

            <!-- 执行计划 — 摘要行 + 弹出编辑面板。模式决定生效字段，有效期写进 startsAt/endsAt 由调度器门控 -->
            <div class="form-group">
              <label class="form-label">{{ t('cron.modal.schedule') }}</label>
              <div class="summary-row">
                <div class="summary-item">
                  <span class="summary-caption">{{ t('cron.modal.frequency') }}</span>
                  <button
                    ref="freqTriggerRef"
                    type="button"
                    class="summary-trigger"
                    :class="{ 'summary-trigger--invalid': !!freqError || !cronValid }"
                    :aria-expanded="freqOpen"
                    @click="toggleFreq"
                  >
                    <span class="summary-value">{{ frequencySummary }}</span>
                    <ChevronDown :size="14" class="summary-chevron" :class="{ open: freqOpen }" />
                  </button>
                </div>

                <!-- 单次没有窗口概念：它的日期本身就是绝对时刻 -->
                <div v-if="form.mode !== 'once'" class="summary-item">
                  <span class="summary-caption">{{ t('cron.modal.validity') }}</span>
                  <button
                    ref="validityTriggerRef"
                    type="button"
                    class="summary-trigger"
                    :class="{ 'summary-trigger--invalid': !!validityError }"
                    :aria-expanded="validityOpen"
                    @click="toggleValidity"
                  >
                    <span class="summary-value">{{ validitySummary }}</span>
                    <ChevronDown :size="14" class="summary-chevron" :class="{ open: validityOpen }" />
                  </button>
                </div>
              </div>
              <!-- 面板打开时错误只在面板里说一遍，免得同一句话出现两次 -->
              <p v-if="scheduleError && !freqOpen && !validityOpen" class="field-error">{{ scheduleError }}</p>
            </div>

            <PopoverPanel :open="freqOpen" :anchor="freqTriggerRef" @close="freqOpen = false">
              <div class="editor-panel">
                <div
                  class="mode-group"
                  role="radiogroup"
                  :aria-label="t('cron.modal.schedule')"
                  @keydown="onModeKeydown"
                >
                  <button
                    v-for="opt in modeOptions"
                    :key="opt.value"
                    type="button"
                    class="mode-btn"
                    role="radio"
                    :data-value="opt.value"
                    :aria-checked="form.mode === opt.value"
                    :tabindex="form.mode === opt.value ? 0 : -1"
                    :class="{ selected: form.mode === opt.value }"
                    @click="form.mode = opt.value"
                  >
                    {{ opt.label }}
                  </button>
                </div>

                <!-- 单次：日期 + 时刻合成一个绝对时刻（cron 无年份语义，靠 startsAt 定年） -->
                <div v-if="form.mode === 'once'" class="panel-field">
                  <label class="field-caption">{{ t('cron.modal.runDate') }}</label>
                  <div class="field-row">
                    <CalendarField
                      v-model="form.onceDate"
                      :label="t('cron.modal.runDate')"
                      :min="todayValue"
                      :invalid="!!onceError"
                    />
                    <TimeWheelField
                      v-model="timeValue"
                      :label="t('cron.modal.time')"
                      :invalid="!!onceError"
                    />
                  </div>
                </div>

                <template v-if="form.mode === 'repeat'">
                  <div class="panel-field">
                    <label class="field-caption">{{ t('cron.modal.frequency') }}</label>
                    <div
                      class="chip-row"
                      role="radiogroup"
                      :aria-label="t('cron.modal.frequency')"
                      @keydown="onRepeatKeydown"
                    >
                      <button
                        v-for="opt in repeatOptions"
                        :key="opt.value"
                        type="button"
                        class="chip"
                        role="radio"
                        :data-value="opt.value"
                        :aria-checked="form.repeat === opt.value"
                        :tabindex="form.repeat === opt.value ? 0 : -1"
                        :class="{ selected: form.repeat === opt.value }"
                        @click="form.repeat = opt.value"
                      >
                        {{ opt.label }}
                      </button>
                    </div>
                  </div>

                  <div v-if="form.repeat === 'custom'" class="panel-field">
                    <label class="field-caption">{{ t('cron.modal.customCron') }}</label>
                    <input
                      v-model="form.customCron"
                      type="text"
                      class="form-input form-input--mono"
                      placeholder="0 9 * * *"
                    />
                    <p v-if="!cronValid" class="field-error">
                      {{ t('cron.modal.invalidSchedule') }}
                    </p>
                  </div>
                  <div v-else class="panel-field">
                    <label class="field-caption">{{ t('cron.modal.time') }}</label>
                    <TimeWheelField v-model="timeValue" :label="t('cron.modal.time')" />
                  </div>
                </template>

                <div v-if="form.mode === 'interval'" class="panel-field">
                  <label class="field-caption">{{ t('cron.modal.interval') }}</label>
                  <div class="field-row">
                    <span class="inline-text">{{ t('cron.modal.intervalEvery') }}</span>
                    <input
                      v-model="form.intervalValue"
                      type="number"
                      class="num-input"
                      :class="{ 'num-input--invalid': intervalError }"
                      min="1"
                      :max="intervalMax"
                      step="1"
                      inputmode="numeric"
                    />
                    <div
                      class="chip-row"
                      role="radiogroup"
                      :aria-label="t('cron.modal.intervalUnit')"
                      @keydown="onUnitKeydown"
                    >
                      <button
                        v-for="opt in unitOptions"
                        :key="opt.value"
                        type="button"
                        class="chip"
                        role="radio"
                        :data-value="opt.value"
                        :aria-checked="form.intervalUnit === opt.value"
                        :tabindex="form.intervalUnit === opt.value ? 0 : -1"
                        :class="{ selected: form.intervalUnit === opt.value }"
                        @click="form.intervalUnit = opt.value"
                      >
                        {{ opt.label }}
                      </button>
                    </div>
                  </div>
                </div>

                <p v-if="freqError" class="field-error">{{ freqError }}</p>
              </div>
            </PopoverPanel>

            <PopoverPanel :open="validityOpen" :anchor="validityTriggerRef" @close="validityOpen = false">
              <div class="editor-panel">
                <div class="panel-field">
                  <label class="field-caption">{{ t('cron.modal.validity') }}</label>
                  <div class="field-row">
                    <CalendarField
                      v-model="form.startDate"
                      :label="t('cron.modal.validity')"
                      :max="form.endDate"
                      :invalid="!!validityError"
                    />
                    <span class="inline-text">{{ t('cron.modal.validityTo') }}</span>
                    <CalendarField
                      v-model="form.endDate"
                      :label="t('cron.modal.validity')"
                      :min="form.startDate || todayValue"
                      :invalid="!!validityError"
                    />
                  </div>
                </div>
                <div class="panel-foot">
                  <button
                    v-if="form.startDate || form.endDate"
                    type="button"
                    class="link-btn"
                    @click="clearValidity"
                  >
                    {{ t('cron.modal.validityForever') }}
                  </button>
                </div>
                <p v-if="validityError" class="field-error">{{ validityError }}</p>
              </div>
            </PopoverPanel>

            <!-- Prompt — 与主聊天共用同一个输入框（/ 技能、@ 上下文、图片）。
                 放在表单末尾：输入框下方的工作空间/分支下拉向上展开，需要留出身位 -->
            <div class="form-group prompt-group">
              <label class="form-label">{{ t('cron.modal.prompt') }}</label>
              <ChatInput
                ref="promptInputRef"
                draft-scope="none"
                compact
                :show-actions="false"
                :enter-submits="false"
                :working-directory="effectiveWorkspace"
                :model-value="form.model"
                :permission-mode="form.permissionMode"
                :placeholder="t('cron.modal.promptPlaceholder')"
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

            <!-- 预览：与调度器同一套 cron + 窗口，所见即所跑 -->
            <div v-if="cronExpression" class="cron-preview">
              <span class="cron-preview-expr">{{ cronExpression }}</span>
              <span class="cron-preview-sep" />
              <span class="cron-preview-desc">{{ cronDescription }}</span>
              <template v-if="nextRunText">
                <span class="cron-preview-sep" />
                <span class="cron-preview-next">
                  <Clock :size="12" />
                  {{ nextRunText }}
                </span>
              </template>
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
import { X, Clock, ChevronDown } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useCronStore, type CronTask, type CronScheduleMode } from '@/stores/cron'
import { useAppStore } from '@/stores/app'
import { usePermissionPolicyStore } from '@/stores/permissionPolicy'
import { useDialog } from '@/composables/useDialog'
import { api, type CronAttachment } from '@/services/electronAPI'
import { nextRunAt, formatNextFire } from '@/lib/cronHelper'
import type { PermissionMode } from '@/shared/channels/claudeCode'
import type { ImageAttachment } from '@/composables/types'
import ChatInput from '@/components/chat/ChatInput.vue'
import ChatContextToolbar from '@/components/chat/ChatContextToolbar.vue'
import PopoverPanel from '@/components/common/PopoverPanel.vue'
import CalendarField from '@/components/common/CalendarField.vue'
import TimeWheelField from '@/components/common/TimeWheelField.vue'

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

type RepeatKind = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom'
type IntervalUnit = 'minute' | 'hour'

const REPEAT_VALUES: RepeatKind[] = ['daily', 'weekdays', 'weekly', 'monthly', 'custom']
const MODE_VALUES: CronScheduleMode[] = ['once', 'repeat', 'interval']
const UNIT_VALUES: IntervalUnit[] = ['minute', 'hour']

/** 间隔上限由 5 字段 cron 的取值域决定：分钟 0-59、小时 0-23 */
const INTERVAL_MAX: Record<IntervalUnit, number> = { minute: 59, hour: 23 }

const modeOptions = computed(() => [
  { value: 'once' as CronScheduleMode, label: t('cron.modal.modeOnce') },
  { value: 'repeat' as CronScheduleMode, label: t('cron.modal.modeRepeat') },
  { value: 'interval' as CronScheduleMode, label: t('cron.modal.modeInterval') },
])

const repeatOptions = computed(() => [
  { value: 'daily' as RepeatKind, label: t('cron.modal.freqDaily') },
  { value: 'weekdays' as RepeatKind, label: t('cron.modal.freqWeekdays') },
  { value: 'weekly' as RepeatKind, label: t('cron.modal.freqWeekly') },
  { value: 'monthly' as RepeatKind, label: t('cron.modal.freqMonthly') },
  { value: 'custom' as RepeatKind, label: t('cron.modal.freqCustom') },
])

const unitOptions = computed(() => [
  { value: 'minute' as IntervalUnit, label: t('cron.modal.intervalUnitMinute') },
  { value: 'hour' as IntervalUnit, label: t('cron.modal.intervalUnitHour') },
])

/** roving tabindex：选中项才可 Tab 进入，方向键在组内移动焦点并切换 */
function onRadioGroupKeydown(
  e: KeyboardEvent,
  values: readonly string[],
  select: (value: string) => void,
) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown'
    ? 1
    : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
      ? -1
      : 0
  if (!step) return
  e.preventDefault()
  const group = e.currentTarget as HTMLElement
  const current = values.indexOf((document.activeElement as HTMLElement | null)?.dataset?.value ?? '')
  // values 全部来自本文件的字面量，选择器不需要转义
  const next = values[(Math.max(current, 0) + step + values.length) % values.length]
  select(next)
  group.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus()
}

function onModeKeydown(e: KeyboardEvent) {
  onRadioGroupKeydown(e, MODE_VALUES, (v) => { form.mode = v as CronScheduleMode })
}

function onRepeatKeydown(e: KeyboardEvent) {
  onRadioGroupKeydown(e, REPEAT_VALUES, (v) => { form.repeat = v as RepeatKind })
}

function onUnitKeydown(e: KeyboardEvent) {
  onRadioGroupKeydown(e, UNIT_VALUES, (v) => { form.intervalUnit = v as IntervalUnit })
}

function clearValidity() {
  form.startDate = ''
  form.endDate = ''
}

interface FormState {
  name: string
  /** 编辑器内容的初始值；提交时以编辑器实时内容为准 */
  prompt: string
  mode: CronScheduleMode
  repeat: RepeatKind
  intervalValue: string
  intervalUnit: IntervalUnit
  onceDate: string
  startDate: string
  endDate: string
  hour: string
  minute: string
  customCron: string
  workspace: string
  branch: string
  model: string
  effort: string
  agent: string
  permissionMode: PermissionMode
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toInt(value: string): number {
  return parseInt(value, 10) || 0
}

function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 原生 date input 交出 YYYY-MM-DD；直接 new Date(str) 会按 UTC 解析并错一天 */
function parseLocalDate(value: string, endOfDay = false): number | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!matched) return null
  const [, y, mo, d] = matched
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
  ).getTime()
}

const defaultForm = (): FormState => ({
  name: '',
  prompt: '',
  mode: 'repeat',
  repeat: 'daily',
  intervalValue: '15',
  intervalUnit: 'minute',
  onceDate: toLocalDateStr(new Date()),
  startDate: '',
  endDate: '',
  hour: '09',
  minute: '00',
  customCron: '',
  workspace: appStore.projectRoot || '',
  branch: '',
  model: '',
  effort: '',
  agent: '',
  permissionMode: permissionPolicy.currentPermissionMode,
})

const form = reactive<FormState>(defaultForm())

/** 排期摘要行的两个弹出面板：同一时刻只开一个，避免互相盖住 */
const freqOpen = ref(false)
const validityOpen = ref(false)
const freqTriggerRef = ref<HTMLElement | null>(null)
const validityTriggerRef = ref<HTMLElement | null>(null)

function toggleFreq() {
  validityOpen.value = false
  freqOpen.value = !freqOpen.value
}

function toggleValidity() {
  freqOpen.value = false
  validityOpen.value = !validityOpen.value
}

/** 单次没有有效期可编辑，摘要行里那一栏已经不显示了 */
watch(() => form.mode, (mode) => {
  if (mode === 'once') validityOpen.value = false
})

/** 滚轮选择器交出 HH:MM，落回 form.hour/minute 供 cron 合成 */
const timeValue = computed({
  get: () => `${pad(toInt(form.hour))}:${pad(toInt(form.minute))}`,
  set: (value: string) => {
    const [hour, minute] = value.split(':')
    form.hour = hour
    form.minute = minute
  },
})

/** 提示词里的 @ 上下文与 / 技能按任务自己的工作空间解析 */
const effectiveWorkspace = computed(() => form.workspace || appStore.projectRoot || '')

const todayValue = computed(() => toLocalDateStr(new Date()))

const intervalMax = computed(() => INTERVAL_MAX[form.intervalUnit])

/** 单次的绝对时刻，同时充当调度门控的 startsAt */
const onceAt = computed(() => {
  const day = parseLocalDate(form.onceDate)
  if (day === null) return null
  const at = new Date(day)
  at.setHours(toInt(form.hour), toInt(form.minute), 0, 0)
  return at.getTime()
})

const startsAt = computed(() =>
  form.mode === 'once' ? onceAt.value : parseLocalDate(form.startDate))
const endsAt = computed(() =>
  form.mode === 'once' ? null : parseLocalDate(form.endDate, true))

const onceError = computed(() => {
  if (form.mode !== 'once') return ''
  if (onceAt.value === null) return t('cron.modal.errPickDate')
  if (onceAt.value <= Date.now()) return t('cron.modal.errTimePast')
  return ''
})

const intervalError = computed(() => {
  if (form.mode !== 'interval') return ''
  const n = Number(form.intervalValue)
  if (!Number.isInteger(n) || n < 1 || n > intervalMax.value) {
    return t('cron.modal.errIntervalRange', { min: 1, max: intervalMax.value })
  }
  return ''
})

const validityError = computed(() => {
  if (form.mode === 'once') return ''
  const end = parseLocalDate(form.endDate, true)
  if (form.endDate && (end === null || end <= Date.now())) return t('cron.modal.errEndPast')
  const start = parseLocalDate(form.startDate)
  if (end !== null && start !== null && end <= start) return t('cron.modal.errEndBeforeStart')
  return ''
})

const scheduleError = computed(
  () => onceError.value || intervalError.value || validityError.value,
)

/** 面板打开时错误只写在面板里，单次时刻与间隔取值都在这张面板上编辑 */
const freqError = computed(() => onceError.value || intervalError.value)

/** 摘要行只说清「什么时候跑」；模式词只在单次的时候出现，因为那是一段绝对时刻 */
const frequencySummary = computed(() => {
  if (form.mode === 'once') {
    return `${t('cron.modal.modeOnce')} ${form.onceDate || '—'} ${timeValue.value}`
  }
  if (form.mode === 'interval') {
    const unit = form.intervalUnit === 'minute'
      ? t('cron.modal.intervalUnitMinute')
      : t('cron.modal.intervalUnitHour')
    return `${t('cron.modal.intervalEvery')} ${form.intervalValue || '—'} ${unit}`
  }
  if (form.repeat === 'custom') {
    return `${t('cron.modal.freqCustom')} ${form.customCron.trim() || '—'}`
  }
  const label = repeatOptions.value.find((opt) => opt.value === form.repeat)?.label ?? ''
  return `${label} ${timeValue.value}`
})

const validitySummary = computed(() => {
  const { startDate, endDate } = form
  if (!startDate && !endDate) return t('cron.modal.validityForever')
  if (startDate && endDate) return `${startDate} ${t('cron.modal.validityTo')} ${endDate}`
  if (startDate) return t('cron.modal.validityFrom', { date: startDate })
  return t('cron.modal.validityUntil', { date: endDate })
})

const cronExpression = computed(() => {
  const h = toInt(form.hour)
  const m = toInt(form.minute)
  if (form.mode === 'once') {
    if (onceAt.value === null) return ''
    const at = new Date(onceAt.value)
    return `${at.getMinutes()} ${at.getHours()} ${at.getDate()} ${at.getMonth() + 1} *`
  }
  if (form.mode === 'interval') {
    const n = Number(form.intervalValue)
    if (!Number.isInteger(n) || n < 1 || n > intervalMax.value) return ''
    return form.intervalUnit === 'minute' ? `*/${n} * * * *` : `0 */${n} * * *`
  }
  if (form.repeat === 'custom') return form.customCron.trim()
  switch (form.repeat) {
    case 'weekdays': return `${m} ${h} * * 1-5`
    case 'weekly': return `${m} ${h} * * 1`
    case 'monthly': return `${m} ${h} 1 * *`
    default: return `${m} ${h} * * *`
  }
})

const cronDescription = ref('')
const cronValid = ref(true)

/** 预览与主进程同一套 cron + 窗口，避免 UI 说一套、调度器做一套 */
const nextRunText = computed(() => {
  if (!cronExpression.value || !cronValid.value) return ''
  return formatNextFire(nextRunAt({
    cron: cronExpression.value,
    startsAt: startsAt.value ?? undefined,
    endsAt: endsAt.value ?? undefined,
    recurring: form.mode !== 'once',
  }))
})

/** 排期非法或没有可写入任务文件的项目时不给创建，避免提交后清空编辑器丢内容 */
const canSubmit = computed(
  () => cronValid.value && !scheduleError.value && !!appStore.projectRoot,
)

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

/** 间隔不额外存字段，N 与单位从 cron 的 step 反解，避免同一个事实存两处 */
function parseIntervalCron(cron: string): { unit: IntervalUnit; value: number } | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minute, hour, dom, month, dow] = parts
  if (dom !== '*' || month !== '*' || dow !== '*') return null
  if (hour === '*' && /^\*\/\d+$/.test(minute)) {
    return { unit: 'minute', value: Number(minute.slice(2)) }
  }
  if (minute === '0' && /^\*\/\d+$/.test(hour)) {
    return { unit: 'hour', value: Number(hour.slice(2)) }
  }
  return null
}

/** 窗口字段上线前的任务没有 scheduleMode：单次看 recurring，间隔看 step，其余归周期 */
function resolveMode(task: CronTask): CronScheduleMode {
  if (task.scheduleMode) return task.scheduleMode
  if (task.recurring === false) return 'once'
  if (parseIntervalCron(task.cron)) return 'interval'
  return 'repeat'
}

function populateFromTask(task: CronTask) {
  form.name = task.name || ''
  form.prompt = task.prompt || ''
  form.mode = resolveMode(task)
  form.workspace = task.workspace || appStore.projectRoot || ''
  form.branch = task.branch || ''
  form.model = task.model || ''
  form.effort = task.effort || ''
  form.agent = task.agent || ''
  form.permissionMode = (task.permissionMode as PermissionMode) || permissionPolicy.currentPermissionMode

  const [minuteField, hourField] = task.cron.trim().split(/\s+/)
  if (task.scheduledTime) {
    const [h, m] = task.scheduledTime.split(':')
    form.hour = h || '09'
    form.minute = m || '00'
  } else if (/^\d+$/.test(minuteField) && /^\d+$/.test(hourField)) {
    form.minute = minuteField.padStart(2, '0')
    form.hour = hourField.padStart(2, '0')
  }

  if (form.mode === 'once') {
    // 老单次任务只有月/日/时/分，取它下一次匹配时刻来还原用户本来的日期意图
    const at = task.startsAt ?? nextRunAt(task)?.getTime()
    if (at !== undefined) {
      const date = new Date(at)
      form.onceDate = toLocalDateStr(date)
      form.hour = pad(date.getHours())
      form.minute = pad(date.getMinutes())
    }
    return
  }

  if (form.mode === 'interval') {
    const parsed = parseIntervalCron(task.cron)
    if (parsed) {
      form.intervalUnit = parsed.unit
      form.intervalValue = String(parsed.value)
    }
  } else {
    form.repeat = task.frequency && REPEAT_VALUES.includes(task.frequency as RepeatKind)
      ? (task.frequency as RepeatKind)
      : 'custom'
    if (form.repeat === 'custom') form.customCron = task.cron
  }

  // 单次不带回 startDate：那一行在单次下不显示，留着就成了看不见的门控
  form.startDate = task.startsAt ? toLocalDateStr(new Date(task.startsAt)) : ''
  form.endDate = task.endsAt ? toLocalDateStr(new Date(task.endsAt)) : ''
}

watch(() => props.visible, async (val) => {
  if (!val) return
  Object.assign(form, defaultForm())
  freqOpen.value = false
  validityOpen.value = false
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
  if (scheduleError.value) {
    // 错误已在字段下方内联显示；回车发送绕过了禁用按钮，这里兜住
    await showAlert(scheduleError.value)
    restorePrompt(prompt)
    return
  }
  if (!cronValid.value) {
    await showAlert(t('cron.modal.invalidSchedule'))
    restorePrompt(prompt)
    return
  }

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
      cron: cronExpression.value,
      prompt,
      scheduleMode: form.mode,
      recurring: form.mode !== 'once',
      // frequency/scheduledTime 只对周期有意义：间隔从 cron 的 step 反解，单次由 startsAt 定位
      frequency: form.mode === 'repeat' ? form.repeat : undefined,
      scheduledTime: form.mode === 'repeat' && form.repeat !== 'custom'
        ? `${pad(toInt(form.hour))}:${pad(toInt(form.minute))}`
        : undefined,
      startsAt: startsAt.value ?? undefined,
      endsAt: endsAt.value ?? undefined,
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

  // 自适应高度由 useContentEditor 写成内联 height（上限 200px）；
  // min-height 优先于内联 height，用它抬高提示词的默认高度
  :deep(.inline-editor) {
    min-height: 140px;
  }
}

// Schedule mode segmented control + chips
.mode-group {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.mode-btn {
  padding: 9px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  text-align: center;
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
  cursor: pointer;

  &:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  &.selected {
    background: var(--accent-primary-glow);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
}

.panel-field {
  margin-top: 14px;
}

.field-caption {
  display: block;
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin-bottom: 5px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.inline-text {
  font-size: var(--text-md);
  color: var(--text-secondary);
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  padding: 6px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
  cursor: pointer;

  &:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  &.selected {
    background: var(--accent-primary-glow);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
}

// 排期摘要行：点 trigger 才展开编辑面板
.summary-row {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.summary-caption {
  font-size: var(--text-md);
  color: var(--text-secondary);
}

.summary-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 300px;
  padding: 7px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-md);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    border-color: var(--border-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  &--invalid {
    border-color: var(--error);
  }
}

.summary-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.summary-chevron {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform var(--transition-fast);

  &.open {
    transform: rotate(180deg);
  }
}

// 弹出面板内的编辑区。面板被 Teleport 到 body，slot 内容仍带本组件的 scope id
.editor-panel {
  width: 380px;
  padding: 14px;
}

.panel-foot {
  display: flex;
  justify-content: flex-end;
  min-height: 20px;
  margin-top: 8px;
}

.num-input {
  width: 64px;
  padding: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-md);
  font-family: var(--font-mono);
  text-align: center;
  outline: none;
  transition: all var(--transition-fast);

  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }

  &--invalid {
    border-color: var(--error);
  }
}

.link-btn {
  padding: 0 2px;
  border: none;
  background: none;
  font-size: var(--text-sm);
  color: var(--accent-primary);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
    border-radius: var(--radius-xs);
  }
}

.field-error {
  margin-top: 6px;
  font-size: var(--text-sm);
  color: var(--error);
}

// Cron preview
.cron-preview {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
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

.cron-preview-next {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
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
