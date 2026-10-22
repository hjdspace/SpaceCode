<template>
  <div v-if="shouldRender" class="plan-question-card" :class="{ 'is-summary': isSummary }">
    <!-- 汇总模式：提问结束后折叠展示问答记录 -->
    <template v-if="isSummary">
      <div class="summary-header" :class="{ 'is-expanded': isSummaryExpanded }" @click="toggleSummary">
        <div class="header-icon" :class="summaryTone">
          <CheckCircle2 v-if="summaryTone === 'ok'" :size="14" />
          <TriangleAlert v-else :size="14" />
        </div>
        <div class="header-text">
          <h3>{{ summaryTitleText }}</h3>
          <span>{{ summaryStatusText }}</span>
        </div>
        <ChevronDown :size="14" class="summary-chevron" :class="{ 'is-expanded': isSummaryExpanded }" />
      </div>
      <div v-if="isSummaryExpanded" class="card-body">
        <div v-for="(question, qIndex) in questions" :key="qIndex" class="summary-item">
          <div class="summary-question">
            <span class="chip">{{ question.header }}</span>
            <span class="question-text">{{ question.question }}</span>
          </div>
          <div class="summary-answer">
            <CheckCircle2 :size="12" class="answer-icon" />
            <span>{{ getAnswerForQuestion(qIndex) }}</span>
            <span v-if="isCustomAnswer(qIndex)" class="custom-tag">{{ t('planMode.question.customTag') }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 交互模式：问卷进行中，逐题作答 -->
    <template v-else>
      <div class="card-header">
        <div class="header-icon">
          <MessageCircleQuestion :size="14" />
        </div>
        <div class="header-text">
          <h3>{{ headerTitle }}</h3>
          <span>{{ statusText }}</span>
        </div>
        <div v-if="isPaged" class="header-progress">
          <span class="progress-text">{{ currentPage + 1 }} / {{ questions.length }}</span>
          <div class="progress-dots">
            <span
              v-for="(_, idx) in questions"
              :key="idx"
              class="dot"
              :class="{ active: idx === currentPage, done: isQuestionAnswered(idx) && idx !== currentPage }"
            />
          </div>
        </div>
      </div>

      <div v-if="currentQuestion" :key="currentPage" class="card-body">
        <div class="question-item">
          <div class="question-title">
            <span class="chip">{{ currentQuestion.header }}</span>
            <span>{{ currentQuestion.question }}</span>
          </div>

          <div class="options-grid">
            <button
              v-for="(option, oIndex) in currentQuestion.options"
              :key="oIndex"
              class="option-btn"
              :class="{ selected: isOptionSelected(currentPage, oIndex) }"
              type="button"
              :disabled="isLocked(currentPage)"
              @click="handleOptionClick(currentPage, oIndex)"
            >
              <div class="option-label"><span>{{ option.label }}</span></div>
              <div v-if="option.description" class="option-desc">{{ option.description }}</div>
            </button>
            <!-- Other 行：扩展 RPC 在选项末尾固定追加 "N. Other (free-form)" -->
            <button
              class="option-btn other-btn"
              :class="{ selected: isOtherSelected(currentPage) }"
              type="button"
              :disabled="isLocked(currentPage)"
              @click="handleOtherClick(currentPage)"
            >
              <div class="option-label"><span>{{ t('planMode.question.other') }}</span></div>
              <div class="option-desc">{{ t('planMode.question.otherDesc') }}</div>
            </button>
          </div>

          <div v-if="isOtherSelected(currentPage)" class="custom-input-wrap">
            <label class="custom-input-label">{{ t('planMode.question.customRequired') }}</label>
            <textarea
              ref="customInputEl"
              v-model="customInputs[currentPage]"
              class="custom-input"
              rows="2"
              :placeholder="t('planMode.question.customPlaceholder')"
              :disabled="isLocked(currentPage)"
              @keydown.enter.exact.prevent="onCustomEnter($event, currentPage)"
            />
            <button
              class="footer-btn primary custom-submit"
              type="button"
              :disabled="submitting || !(customInputs[currentPage] || '').trim()"
              @click="submitCustomAnswer(currentPage)"
            >
              {{ t('planMode.question.customSubmit') }}
            </button>
          </div>
        </div>
      </div>

      <div class="card-footer">
        <button
          v-if="hasPendingMatchedDialog"
          class="footer-btn secondary"
          type="button"
          :disabled="submitting"
          @click="handleSkip"
        >
          {{ t('planMode.question.skip') }}
        </button>
        <div class="footer-spacer" />
        <button
          v-if="isPaged"
          class="footer-btn ghost"
          type="button"
          :disabled="currentPage === 0"
          @click="goPrev"
        >
          {{ t('planMode.question.prev') }}
        </button>
        <button
          v-if="isPaged && !isLastPage"
          class="footer-btn primary"
          type="button"
          :disabled="!isQuestionAnswered(currentPage)"
          @click="goNext"
        >
          {{ t('planMode.question.next') }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCircle2, ChevronDown, MessageCircleQuestion, TriangleAlert } from 'lucide-vue-next'
import type { ToolCall } from '@/types'
import type { ExtensionDialogAnswer } from '@/shared/channels/claudeCode'
import { extensionDialogService, type ExtensionDialog } from '@/services/extensionDialogService'
import { useTurnStore } from '@/stores/turn'
import {
  findDialogForQuestion,
  matchEditorDialogToQuestion,
  optionRowLabel,
  otherRowLabel,
  parseQuestionnaireOutput,
  type PlanModeQuestion,
} from '@/lib/planModeDialogMatcher'

/**
 * pi plan_mode_question 的问卷卡：结构对齐 AskUserQuestionToolCard（图标头 / 进度点 /
 * 带描述选项 / Other 自由填写 / 翻页 / 汇总折叠）。
 *
 * 与引擎的联动靠扩展对话框账本配对（planModeDialogMatcher）：每道题对应一帧
 * `"{header}: {question}"` 标题的 select 对话框；配对成功时点选项 = 直接应答那一帧，
 * 配对失败（扩展改了标题格式 / 历史会话回放）时只更新本地选择 —— 对话框照旧由
 * ExtensionDialogCard 独立渲染应答，不阻塞。
 */
const props = defineProps<{ toolCall: ToolCall }>()

const { t } = useI18n()
const turnStore = useTurnStore()

const questions = computed<PlanModeQuestion[]>(() => {
  const input = props.toolCall.input || {}
  const raw = (input as { questions?: PlanModeQuestion[] }).questions
  return Array.isArray(raw) ? raw.filter(q => q && typeof q.question === 'string') : []
})

const shouldRender = computed(() => {
  if (props.toolCall.status === 'error') return false
  return questions.value.length > 0
})

const isPendingStatus = computed(() =>
  props.toolCall.status === 'pending' || props.toolCall.status === 'running',
)

/** 汇总模式：tool_use 已结束（tool_result 到达） */
const isSummary = computed(() => !isPendingStatus.value && props.toolCall.status === 'completed')

const isPaged = computed(() => questions.value.length > 1)
const currentPage = ref(0)
const currentQuestion = computed<PlanModeQuestion | undefined>(() => questions.value[currentPage.value])
const isLastPage = computed(() => currentPage.value >= questions.value.length - 1)

const headerTitle = computed(() =>
  isPaged.value ? t('planMode.question.titleMulti') : t('planMode.question.titleOne'),
)
const statusText = computed(() =>
  t('planMode.question.statusCount', { count: questions.value.length }),
)

// ── 本地作答状态（qIndex → 选项下标；null = Other） ──
const selections = ref<Map<number, number | null>>(new Map())
const customInputs = ref<Record<number, string>>({})
const customSubmitted = ref<Record<number, string>>({})
/** 该题的 select 帧已被本卡应答（锁住选项，防 UI 与引擎答案错位） */
const answeredQuestionIndexes = ref<Set<number>>(new Set())

const submitting = ref(false)
/** 在途 / 已答的对话框 id（防双答的组件内闸） */
const inFlightDialogIds = new Set<string>()
const answeredDialogIds = new Set<string>()

// ── 与扩展对话框账本的配对（computed 现取，不自存状态） ──
const selectableDialogs = computed(() =>
  extensionDialogService.listPending('select').filter(d => !inFlightDialogIds.has(d.dialogId)),
)
const pendingEditors = computed(() =>
  extensionDialogService.listPending('editor').filter(d => !inFlightDialogIds.has(d.dialogId)),
)

function matchedEditorDialog(qIndex: number): ExtensionDialog | undefined {
  const q = questions.value[qIndex]
  if (!q) return undefined
  for (let i = pendingEditors.value.length - 1; i >= 0; i--) {
    if (matchEditorDialogToQuestion(pendingEditors.value[i], q)) return pendingEditors.value[i]
  }
  return undefined
}

const hasPendingMatchedDialog = computed(() => {
  if (pendingEditors.value.length > 0) return true
  return questions.value.some(q => !!findDialogForQuestion(selectableDialogs.value, q))
})

/**
 * 应答一帧对话框。store 先落回执再发 IPC，失败时撤回 —— 返回 false 时调用方
 * 不应锁定本地状态，用户可以原地重试。吞异常与 ExtensionDialogCard 同理：
 * 失败原因已在 store 日志里。
 */
async function answerDialog(target: ExtensionDialog, answer: ExtensionDialogAnswer, outcome: string): Promise<boolean> {
  if (inFlightDialogIds.has(target.dialogId)) return false
  inFlightDialogIds.add(target.dialogId)
  try {
    await turnStore.answerExtensionDialog(target.sessionId, target.dialogId, answer, outcome)
    answeredDialogIds.add(target.dialogId)
    return true
  } catch {
    return false
  } finally {
    inFlightDialogIds.delete(target.dialogId)
  }
}

function isLocked(qIndex: number): boolean {
  return answeredQuestionIndexes.value.has(qIndex)
}

function isQuestionAnswered(qIndex: number): boolean {
  return selections.value.has(qIndex)
}

const answeredQuestionCount = computed(() => {
  let count = 0
  for (let i = 0; i < questions.value.length; i++) {
    if (isQuestionAnswered(i)) count += 1
  }
  return count
})

function isOptionSelected(qIndex: number, oIndex: number): boolean {
  return selections.value.get(qIndex) === oIndex
}

function isOtherSelected(qIndex: number): boolean {
  return selections.value.has(qIndex) && selections.value.get(qIndex) === null
}

function isCustomAnswer(qIndex: number): boolean {
  return isOtherSelected(qIndex)
}

async function handleOptionClick(qIndex: number, oIndex: number): Promise<void> {
  if (isLocked(qIndex)) return
  const q = questions.value[qIndex]
  if (!q) return
  selections.value.set(qIndex, oIndex)
  // 选了具体选项就清掉 Other 草稿，两态互斥
  if (customInputs.value[qIndex]) {
    customInputs.value = { ...customInputs.value, [qIndex]: '' }
  }
  const dialog = findDialogForQuestion(selectableDialogs.value, q)
  if (!dialog) return // 降级：无配对帧，只更新本地选择，不发 IPC
  const label = optionRowLabel(q, oIndex)
  const ok = await answerDialog(dialog, { kind: 'value', value: label }, label)
  if (!ok) {
    // IPC 失败：卡片退回 pending，解除本地锁定让用户重试
    selections.value.delete(qIndex)
  } else {
    answeredQuestionIndexes.value.add(qIndex)
  }
}

const customInputEl = ref<HTMLTextAreaElement | null>(null)

function handleOtherClick(qIndex: number): void {
  if (isLocked(qIndex)) return
  selections.value.set(qIndex, null)
  void nextTick(() => customInputEl.value?.focus())
}

/** 坑 6：中文输入法的回车确认不能当成「提交」 */
function onCustomEnter(e: KeyboardEvent, qIndex: number): void {
  if (e.isComposing) return
  void submitCustomAnswer(qIndex)
}

/**
 * Other 流程提交：先应答 select 帧为 "N. Other (free-form)"，扩展随后才发 editor 帧；
 * editor 帧到达时由 watch 自动补答用户文本（降级：无 editor 帧时只写本地）。
 */
async function submitCustomAnswer(qIndex: number): Promise<void> {
  const q = questions.value[qIndex]
  if (!q) return
  const text = (customInputs.value[qIndex] ?? '').trim()
  if (!text) return
  customSubmitted.value = { ...customSubmitted.value, [qIndex]: text }

  if (!isLocked(qIndex)) {
    const selectDialog = findDialogForQuestion(selectableDialogs.value, q)
    if (selectDialog) {
      const label = otherRowLabel(q)
      const ok = await answerDialog(selectDialog, { kind: 'value', value: label }, label)
      if (!ok) return // select 帧没答上，editor 帧不会来；用户可重试
      answeredQuestionIndexes.value.add(qIndex)
    }
  }

  const editorDialog = matchedEditorDialog(qIndex)
  if (editorDialog) {
    await answerDialog(editorDialog, { kind: 'value', value: text }, text)
  }
}

// editor 帧在 select 应答之后才到：文本先落 customSubmitted，帧一出现就补答
watch(pendingEditors, async (editors) => {
  if (editors.length === 0) return
  for (let i = 0; i < questions.value.length; i++) {
    const text = customSubmitted.value[i]
    if (!text) continue
    const q = questions.value[i]
    if (!q) continue
    for (let j = editors.length - 1; j >= 0; j--) {
      const hit = editors[j]
      if (answeredDialogIds.has(hit.dialogId)) continue
      if (!matchEditorDialogToQuestion(hit, q)) continue
      await answerDialog(hit, { kind: 'value', value: text }, text)
      break
    }
  }
})

async function handleSkip(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  try {
    for (let i = 0; i < questions.value.length; i++) {
      const q = questions.value[i]
      const outcome = t('planMode.question.skipped')
      const selectDialog = findDialogForQuestion(selectableDialogs.value, q)
      if (selectDialog) await answerDialog(selectDialog, { kind: 'cancel' }, outcome)
      const editorDialog = matchedEditorDialog(i)
      if (editorDialog) await answerDialog(editorDialog, { kind: 'cancel' }, outcome)
    }
  } finally {
    submitting.value = false
  }
}

function goPrev(): void {
  if (currentPage.value > 0) currentPage.value -= 1
}

function goNext(): void {
  if (!isQuestionAnswered(currentPage.value)) return
  if (currentPage.value < questions.value.length - 1) currentPage.value += 1
}

// ── 坑 7：键盘快捷键先判焦点在输入框里，再处理数字选选项 / Enter 翻页 ──
function onKeydown(e: KeyboardEvent): void {
  if (!isPendingStatus.value || isSummary.value) return
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return
  const q = currentQuestion.value
  if (!q) return
  const num = Number.parseInt(e.key, 10)
  if (!Number.isNaN(num) && num >= 1) {
    if (num <= q.options.length) {
      if (!isLocked(currentPage.value)) {
        void handleOptionClick(currentPage.value, num - 1)
        e.preventDefault()
      }
      return
    }
    if (num === q.options.length + 1) {
      handleOtherClick(currentPage.value)
      e.preventDefault()
      return
    }
  }
  if (e.key === 'Enter' && currentPage.value < questions.value.length - 1) {
    goNext()
    e.preventDefault()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

// ── 汇总态 ──
const isSummaryExpanded = ref(false)

function toggleSummary(): void {
  isSummaryExpanded.value = !isSummaryExpanded.value
}

const parsedOutput = computed(() => parseQuestionnaireOutput(props.toolCall.output))

function outputAnswerForQuestion(qIndex: number): string | undefined {
  const answers = parsedOutput.value?.answers
  if (!answers?.length) return undefined
  const q = questions.value[qIndex]
  const byText = answers.find(a => a && a['question'] === q.question)
  const item = byText ?? answers[qIndex]
  if (!item || typeof item !== 'object') return undefined
  for (const key of ['answer', 'value', 'label', 'text']) {
    const v = (item as Record<string, unknown>)[key]
    if (typeof v === 'string' && v) return v
  }
  return undefined
}

function getAnswerForQuestion(qIndex: number): string {
  const local = selections.value.get(qIndex)
  if (local !== undefined) {
    const q = questions.value[qIndex]
    if (local === null) {
      return customSubmitted.value[qIndex] || customInputs.value[qIndex] || t('planMode.question.noAnswer')
    }
    return q.options[local]?.label ?? t('planMode.question.noAnswer')
  }
  const fromOutput = outputAnswerForQuestion(qIndex)
  if (fromOutput) return fromOutput
  // output 能解析（问卷正常结束）→ 这题就是没答；解析失败 → 只能说已结束，不造数据
  return parsedOutput.value ? t('planMode.question.noAnswer') : t('planMode.question.ended')
}

const summaryTone = computed<'ok' | 'warn'>(() => (parsedOutput.value?.cancelled ? 'warn' : 'ok'))

const summaryTitleText = computed(() => {
  if (parsedOutput.value?.cancelled) return t('planMode.question.summarySkipped')
  if (answeredQuestionCount.value === 0 && !parsedOutput.value?.answers?.length) {
    return t('planMode.question.summarySkipped')
  }
  return t('planMode.question.summaryAnswered', { count: questions.value.length })
})

const summaryStatusText = computed(() => {
  if (parsedOutput.value?.cancelled) return t('planMode.question.summarySkippedHint')
  const total = questions.value.length
  const answered = Math.max(answeredQuestionCount.value, parsedOutput.value?.answers?.length ?? 0)
  if (answered === 0) return t('planMode.question.summarySkippedHint')
  if (answered < total) {
    return t('planMode.question.summaryPartial', { answered, total })
  }
  return isSummaryExpanded.value ? '' : t('planMode.question.summaryHint')
})
</script>

<style lang="scss" scoped>
.plan-question-card {
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  overflow: hidden;
  margin: 12px 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);

  &.is-summary {
    box-shadow: none;
  }
}

// ── header（与 AskUserQuestionToolCard 同构）──
.card-header {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface-glass);
  border-bottom: 1px solid var(--surface-border);
}

.header-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-primary);
  flex-shrink: 0;

  &.warn {
    background: color-mix(in srgb, var(--warning) 14%, transparent);
    color: var(--warning);
  }
}

.header-text {
  flex: 1;
  min-width: 0;

  h3 {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 1px;
  }

  span {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
}

.header-progress {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.progress-text {
  font-size: var(--text-2xs);
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.progress-dots {
  display: flex;
  gap: 4px;

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--surface-border);
    transition: all 0.2s ease;

    &.done {
      background: var(--accent-primary);
      opacity: 0.7;
    }

    &.active {
      background: var(--accent-primary);
      transform: scale(1.2);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 18%, transparent);
    }
  }
}

// ── body ──
.card-body {
  padding: 10px 12px;
}

.question-item {
  margin-bottom: 10px;
}

.question-title {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 8px;
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.chip {
  padding: 2px 6px;
  background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
  color: var(--accent-primary);
  font-size: var(--text-2xs);
  font-weight: 600;
  border-radius: 4px;
  flex-shrink: 0;
}

.options-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option-btn {
  position: relative;
  width: 100%;
  text-align: left;
  padding: 8px 10px 8px 32px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;
  font-family: inherit;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  &::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 14px;
    border: 1.5px solid var(--border-strong);
    border-radius: 4px;
    transition: all 0.2s ease;
    background: transparent;
  }

  &:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: var(--surface-glass-hover);
  }

  &.selected {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);

    &::before {
      border-color: var(--accent-primary);
      background: var(--accent-primary);
    }

    &::after {
      content: '✓';
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: white;
      font-size: var(--text-2xs);
      font-weight: bold;
    }
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }
}

.option-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.option-desc {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  line-height: var(--leading-compact);
}

.custom-input-wrap {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.custom-input-label {
  font-size: var(--text-2xs);
  color: var(--text-muted);
}

.custom-input {
  width: 100%;
  padding: 6px 8px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: inherit;
  line-height: var(--leading-normal);
  resize: vertical;
  min-height: 36px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;

  &::placeholder {
    color: var(--text-muted);
  }

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 12%, transparent);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.custom-submit {
  align-self: flex-end;
}

// ── footer ──
.card-footer {
  padding: 8px 12px 10px;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  background: var(--surface-glass);
  border-top: 1px solid var(--surface-border);
}

.footer-spacer {
  flex: 1;
}

.footer-btn {
  padding: 5px 12px;
  border-radius: 6px;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
  border: 1px solid transparent;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    pointer-events: none;
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &.secondary {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);

    &:hover:not(:disabled) {
      background: var(--surface-glass-hover);
      border-color: var(--accent-primary);
      color: var(--text-primary);
    }
  }

  &.ghost {
    background: var(--surface-glass);
    border: 1px solid var(--surface-border);
    color: var(--text-secondary);

    &:hover:not(:disabled) {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
    }
  }

  &.primary {
    background: var(--accent-primary);
    border: none;
    color: white;
    font-weight: 600;

    &:hover:not(:disabled) {
      opacity: 0.9;
    }
  }
}

// ── 汇总态（与 AskUserQuestionToolCard summary 同构）──
.summary-header {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  background: var(--surface-glass);
  transition: background 0.2s ease;
  user-select: none;

  &.is-expanded {
    border-bottom: 1px solid var(--surface-border);
  }

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.summary-chevron {
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform 0.2s ease;

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.summary-item {
  padding: 8px 0;
  border-bottom: 1px solid var(--surface-border);

  &:last-child {
    border-bottom: none;
  }
}

.summary-question {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 4px;

  .question-text {
    font-size: var(--text-md);
    font-weight: 500;
    color: var(--text-secondary);
  }
}

.summary-answer {
  display: flex;
  gap: 4px;
  align-items: flex-start;
  padding-left: 4px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: var(--leading-normal);

  .answer-icon {
    color: var(--accent-primary);
    flex-shrink: 0;
    margin-top: 1px;
  }

  .custom-tag {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    padding: 0 4px;
    flex-shrink: 0;
  }
}
</style>
