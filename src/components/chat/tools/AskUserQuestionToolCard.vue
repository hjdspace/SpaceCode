<template>
  <div
    v-if="shouldRender"
    class="ask-user-question-card"
    :class="{ 'is-resolved': !isPending && !isSummary, 'is-summary': isSummary }"
  >
    <!-- 汇总模式：提问完成后折叠展示 -->
    <template v-if="isSummary">
      <div class="summary-header" @click="toggleSummary">
        <div class="header-icon">
          <MessageCircleQuestion :size="20" />
        </div>
        <div class="header-text">
          <h3>{{ t('askUser.summaryTitle') }}</h3>
          <span>{{ summaryStatusText }}</span>
        </div>
        <ChevronDown :size="18" class="summary-chevron" :class="{ 'is-expanded': isSummaryExpanded }" />
      </div>
      <div v-if="isSummaryExpanded" class="card-body">
        <div v-for="(question, qIndex) in questions" :key="qIndex" class="summary-item">
          <div class="summary-question">
            <span v-if="question.header" class="chip">{{ question.header }}</span>
            <span class="question-text">{{ question.question }}</span>
          </div>
          <div class="summary-answer">
            <CheckCircle2 :size="14" class="answer-icon" />
            <span>{{ getAnswerForQuestion(question.question) }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- 交互模式：pending 时展示选项 -->
    <template v-else>
      <div class="card-header">
        <div class="header-icon">
          <MessageCircleQuestion :size="20" />
        </div>
        <div class="header-text">
          <h3>{{ title }}</h3>
          <span>{{ statusText }}</span>
        </div>
        <div v-if="isPaged" class="header-progress">
          <span class="progress-text">{{ currentPage + 1 }} / {{ questions.length }}</span>
          <div class="progress-dots">
            <span
              v-for="(_, idx) in questions"
              :key="idx"
              class="dot"
              :class="{
                active: idx === currentPage,
                done: isQuestionAnswered(idx) && idx !== currentPage,
              }"
            />
          </div>
        </div>
      </div>

      <div class="card-body">
        <template v-if="currentQuestion">
          <div class="question-item" :key="currentPage">
            <div class="question-title">
              <span v-if="currentQuestion.header" class="chip">{{ currentQuestion.header }}</span>
              <span>{{ currentQuestion.question }}</span>
              <span v-if="currentQuestion.multiSelect" class="multi-hint">{{ t('askUser.multiSelect') }}</span>
            </div>

            <div class="options-grid">
              <button
                v-for="(option, oIndex) in currentQuestion.options"
                :key="oIndex"
                class="option-btn"
                :class="{ 'selected': isOptionSelected(currentPage, oIndex) }"
                :disabled="!isPending"
                @click="handleOptionClick(currentPage, oIndex, option, currentQuestion.multiSelect)"
              >
                <div class="option-label">{{ option.label }}</div>
                <div v-if="option.description" class="option-desc">{{ option.description }}</div>
              </button>
            </div>

            <div class="custom-input-wrap">
              <label class="custom-input-label">{{ t('askUser.customInputHint') }}</label>
              <textarea
                v-model="customInputs[currentPage]"
                class="custom-input"
                rows="2"
                :placeholder="t('askUser.customInputPlaceholder')"
                :disabled="!isPending"
                @input="onCustomInput(currentPage)"
              />
            </div>
          </div>
        </template>
      </div>

      <div class="card-footer">
        <button
          class="footer-btn secondary"
          :disabled="!isPending"
          @click="handleSkip"
        >
          {{ skipText }}
        </button>
        <div class="footer-spacer" />
        <button
          v-if="isPaged"
          class="footer-btn ghost"
          :disabled="!isPending || currentPage === 0"
          @click="goPrev"
        >
          {{ t('askUser.prevPage') }}
        </button>
        <button
          v-if="isPaged && !isLastPage"
          class="footer-btn primary"
          :disabled="!isPending || !isQuestionAnswered(currentPage)"
          @click="goNext"
        >
          {{ t('askUser.nextPage') }}
        </button>
        <button
          v-if="!isPaged || isLastPage"
          class="footer-btn primary"
          :disabled="!isPending || answeredQuestionCount === 0"
          @click="handleSubmit"
        >
          {{ submitText }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessageCircleQuestion, ChevronDown, CheckCircle2 } from 'lucide-vue-next'
import type { ToolCall } from '@/types'
import { useChatStore } from '@/stores/chat'

interface QuestionOption {
  label: string
  description?: string
  preview?: string
}

interface Question {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect?: boolean
}

const props = defineProps<{
  toolCall: ToolCall
}>()

const emit = defineEmits<{
  /**
   * 用户提交答案。payload 是「合并了 answers 之后的完整 updatedInput」，
   * 直接对应 engine 在 can_use_tool 决策里的 PermissionAllowResult.updatedInput。
   * 父级链路应当把它传给 chatStore.allowPermission(messageId, toolUseId, updatedInput)。
   */
  submit: [updatedInput: Record<string, unknown>]
  /**
   * 用户跳过 / 拒绝。父级链路应当把它传给 chatStore.denyPermission(...)。
   */
  skip: []
}>()

const { t } = useI18n()
const chatStore = useChatStore()

const questions = computed<Question[]>(() => {
  const input = props.toolCall.input || {}
  return (input as { questions?: Question[] }).questions || []
})

/**
 * 卡片是否还可交互：当且仅当 chat store 中存在与本 toolCall 对应的
 * pending can_use_tool 请求时为 true。这样可以避免：
 *   1) 历史会话/旧消息里看到这张卡片时不小心被点中
 *   2) 用户连续点提交导致重复 control_response
 */
const isPending = computed(() =>
  chatStore.hasPendingPermissionForToolUse(props.toolCall.id),
)

/**
 * 是否需要渲染整张卡片。
 *
 * 引擎侧 AskUserQuestion 是 `shouldDefer: true` 工具：模型首次调用时
 * schema 尚未通过 ToolSearch 加载，引擎会直接给出 input 校验失败的
 * tool_result（status='error'）—— 这种"幽灵 toolCall"没有真实 questions，
 * 也永远不会发出 permission_request。如果照常渲染，就会出现 issue 截图里
 * "已回答 / 本次提问已结束"的空卡片。
 *
 * 规则：
 * - 已经被本地标成 error 的 toolCall：不渲染
 * - 工具输入里没有 questions（或为空数组）：不渲染
 * - 其他情况都渲染：pending 时显示交互 UI，completed 时显示汇总卡片
 */
const shouldRender = computed(() => {
  if (props.toolCall.status === 'error') return false
  if (questions.value.length === 0) return false
  return true
})

/**
 * 汇总模式：提问已完成（无 pending permission 且 status=completed）。
 * 此时不再显示交互选项，改为折叠汇总卡片，展开后展示每个问题及用户回答。
 */
const isSummary = computed(() =>
  !isPending.value && props.toolCall.status === 'completed',
)

/** 汇总卡片默认折叠 */
const isSummaryExpanded = ref(false)

function toggleSummary() {
  isSummaryExpanded.value = !isSummaryExpanded.value
}

/**
 * 从 toolCall.output 解析 "question"="answer" 对。
 * 历史会话恢复时组件本地状态（selections/customInputs）为空，需从 output 回溯。
 * engine 的 mapToolResultToToolResultBlockParam 产出格式：
 * User has answered your questions: "q1"="a1", "q2"="a2". ...
 */
function parseAnswersFromOutput(output?: string): Record<string, string> {
  if (!output) return {}
  const answers: Record<string, string> = {}
  const regex = /"([^"]+)"="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(output)) !== null) {
    answers[match[1]] = match[2]
  }
  return answers
}

/**
 * 汇总展示用的答案映射：优先用本地 selections/customInputs（live 会话，
 * 组件未 remount），为空时回退解析 toolCall.output（历史会话恢复）。
 */
const resolvedAnswers = computed<Record<string, string>>(() => {
  const answers: Record<string, string> = {}
  questions.value.forEach((question, qIndex) => {
    const parts: string[] = []
    question.options.forEach((option, oIndex) => {
      if (selections.value.has(getSelectionKey(qIndex, oIndex))) {
        parts.push(option.label)
      }
    })
    const custom = (customInputs.value[qIndex] || '').trim()
    if (custom) parts.push(custom)
    if (parts.length > 0) {
      answers[question.question] = parts.join(', ')
    }
  })
  if (Object.keys(answers).length > 0) return answers
  return parseAnswersFromOutput(props.toolCall.output)
})

function getAnswerForQuestion(questionText: string): string {
  return resolvedAnswers.value[questionText] || t('askUser.noAnswer')
}

const summaryStatusText = computed(() => {
  const total = questions.value.length
  const answeredCount = questions.value.filter(q => resolvedAnswers.value[q.question]).length
  if (answeredCount === 0) return t('askUser.summarySkipped')
  if (answeredCount < total) return t('askUser.summaryPartial', { answered: answeredCount, total })
  return t('askUser.summaryAnswered', { count: total })
})

const isPaged = computed(() => questions.value.length > 1)

const currentPage = ref(0)

const currentQuestion = computed<Question | undefined>(() => questions.value[currentPage.value])

const isLastPage = computed(() => currentPage.value >= questions.value.length - 1)

const title = computed(() => {
  if (!isPending.value) return t('askUser.answered')
  return isPaged.value ? t('askUser.quickSelect') : t('askUser.pleaseSelect')
})

const statusText = computed(() => {
  if (!isPending.value) return t('askUser.questionEnded')
  const count = questions.value.length
  return count > 1 ? t('askUser.questionsCount', { count }) : t('askUser.oneQuestion')
})

const skipText = computed(() => {
  return isPaged.value ? t('askUser.skipAll') : t('askUser.skip')
})

const submitText = computed(() => {
  const totalQuestions = questions.value.length
  const answeredQuestions = answeredQuestionCount.value

  if (answeredQuestions === 0) return t('askUser.pleaseSelectFirst')
  if (answeredQuestions === totalQuestions) return t('askUser.submitAnswer')
  return t('askUser.answeredProgress', { answered: answeredQuestions, total: totalQuestions })
})

const selections = ref<Map<string, string>>(new Map())
// 每个问题的自定义输入（按问题索引存放）。即使 LLM 没给合适选项，用户也能补充。
const customInputs = ref<Record<number, string>>({})

function isQuestionAnswered(qIndex: number): boolean {
  const prefix = `${qIndex}-`
  for (const key of selections.value.keys()) {
    if (key.startsWith(prefix)) return true
  }
  const custom = customInputs.value[qIndex]
  return !!(custom && custom.trim().length > 0)
}

/** Counts how many distinct questions currently have at least one answer (option or custom text). */
const answeredQuestionCount = computed(() => {
  let count = 0
  for (let i = 0; i < questions.value.length; i++) {
    if (isQuestionAnswered(i)) count += 1
  }
  return count
})

function getSelectionKey(qIndex: number, oIndex: number): string {
  return `${qIndex}-${oIndex}`
}

function isOptionSelected(qIndex: number, oIndex: number): boolean {
  return selections.value.has(getSelectionKey(qIndex, oIndex))
}

function handleOptionClick(
  qIndex: number, 
  oIndex: number, 
  option: QuestionOption,
  multiSelect?: boolean
) {
  if (!isPending.value) return
  const key = getSelectionKey(qIndex, oIndex)
  
  if (multiSelect) {
    if (selections.value.has(key)) {
      selections.value.delete(key)
    } else {
      selections.value.set(key, option.label)
    }
  } else {
    // 清除同一问题的旧选择。先把要删的 key 收集到数组里，再删除——
    // 避免在 Vue reactive Map 的迭代器上同时改写。
    const prefix = `${qIndex}-`
    const toDelete = Array.from(selections.value.keys()).filter(k => k.startsWith(prefix))
    for (const k of toDelete) selections.value.delete(k)
    selections.value.set(key, option.label)
  }
}

function onCustomInput(_qIndex: number) {
  // 仅用于触发 reactive 更新；当前不需要额外副作用。
  void _qIndex
}

function goPrev() {
  if (!isPending.value) return
  if (currentPage.value > 0) currentPage.value -= 1
}

function goNext() {
  if (!isPending.value) return
  if (!isQuestionAnswered(currentPage.value)) return
  if (currentPage.value < questions.value.length - 1) currentPage.value += 1
}

function handleSkip() {
  if (!isPending.value) return
  emit('skip')
}

function handleSubmit() {
  if (!isPending.value) return

  const answers: Record<string, string> = {}
  questions.value.forEach((question, qIndex) => {
    const parts: string[] = []
    question.options.forEach((option, oIndex) => {
      const key = getSelectionKey(qIndex, oIndex)
      if (selections.value.has(key)) {
        // engine 强制 option label 在每题内唯一（UNIQUENESS_REFINE），
        // 且 SDK 的 outputSchema.answers 描述说多选答案以逗号分隔。
        parts.push(option.label)
        void option
      }
    })
    const custom = (customInputs.value[qIndex] || '').trim()
    if (custom) parts.push(custom)
    if (parts.length > 0) {
      answers[question.question] = parts.join(', ')
    }
  })

  // engine 在 permissionPromptToolResultToPermissionDecision 之后会用
  // updatedInput 当作工具的真实输入再走一遍 zod 校验。
  // AskUserQuestion 的 inputSchema 要求 answers 是 Record<string,string>，
  // 即便允许 optional 也得避免空对象 → 否则引擎拿到空 answers，工具回结果
  // "User has answered your questions: " 后面跟空串，模型会困惑甚至再次重问，
  // 造成"点了确认没有反应"的体感。这里再守一道：没选任何选项就直接 return。
  if (Object.keys(answers).length === 0) return

  // 必须把 answers 合并回原 input 后再交给上层——engine 在
  // permissionPromptToolResultToPermissionDecision 之后会用 updatedInput
  // 当作工具的真实输入再走一遍 zod 校验，缺任何字段都会 deny。
  const original = (props.toolCall.input || {}) as Record<string, unknown>
  emit('submit', { ...JSON.parse(JSON.stringify(original)), answers })
}
</script>

<style lang="scss" scoped>
.ask-user-question-card {
  background: linear-gradient(180deg, var(--surface-glass) 0%, var(--bg-primary) 100%);
  border: 1px solid var(--surface-border);
  border-radius: 20px;
  overflow: hidden;
  margin-top: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);

  &.is-resolved {
    opacity: 0.7;
    filter: grayscale(0.2);
  }

  &.is-summary {
    opacity: 1;
    filter: none;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }
}

.summary-header {
  padding: 14px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  background: var(--surface-glass);
  border-bottom: 1px solid var(--surface-border);
  transition: background 0.2s ease;
  user-select: none;

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
  padding: 12px 0;
  border-bottom: 1px solid var(--surface-border);

  &:last-child {
    border-bottom: none;
  }
}

.summary-question {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 6px;

  .question-text {
    font-size: var(--font-size-base);
    font-weight: 500;
    color: var(--text-secondary);
  }
}

.summary-answer {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding-left: 4px;
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.5;

  .answer-icon {
    color: var(--accent-primary);
    flex-shrink: 0;
    margin-top: 2px;
  }
}

.card-header {
  padding: 18px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%);
  border-bottom: 1px solid var(--surface-border);
}

.header-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: radial-gradient(circle at 30% 30%, var(--accent-primary-light) 0%, var(--accent-primary) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
  flex-shrink: 0;
}

.header-text {
  flex: 1;
  
  h3 {
    font-size: calc(var(--font-size-base) + 1px);
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 2px;
  }
  
  span {
    font-size: 12px;
    color: var(--text-muted);
  }
}

.header-progress {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.progress-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.progress-dots {
  display: flex;
  gap: 5px;

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--surface-border);
    transition: all 0.2s ease;

    &.done {
      background: var(--accent-primary);
      opacity: 0.7;
    }

    &.active {
      background: var(--accent-primary);
      transform: scale(1.3);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
    }
  }
}

.card-body {
  padding: 16px 20px;
}

.multi-hint {
  margin-left: auto;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent-primary);
  background: rgba(59, 130, 246, 0.12);
  border-radius: 999px;
}

.custom-input-wrap {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.custom-input-label {
  font-size: 12px;
  color: var(--text-muted);
}

.custom-input {
  width: 100%;
  padding: 10px 12px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  resize: vertical;
  min-height: 56px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;

  &::placeholder {
    color: var(--text-muted);
  }

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.footer-spacer {
  flex: 1;
}

.question-item {
  margin-bottom: 20px;
}

.question-title {
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 12px;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.chip {
  padding: 4px 10px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%);
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  border: 1px solid rgba(59, 130, 246, 0.2);
  flex-shrink: 0;
}

.options-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.option-btn {
  position: relative;
  width: 100%;
  text-align: left;
  padding: 14px 16px 14px 50px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  
  &::before {
    content: '';
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    width: 22px;
    height: 22px;
    border: 2px solid var(--border-strong);
    border-radius: 6px;
    transition: all 0.2s ease;
    background: transparent;
  }
  
  &:hover {
    border-color: var(--border-strong);
    background: var(--surface-glass-hover);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  
  &.selected {
    border-color: var(--accent-primary);
    background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(139, 92, 246, 0.1) 100%);
    
    &::before {
      border-color: var(--accent-primary);
      background: var(--accent-primary);
    }
    
    &::after {
      content: '✓';
      position: absolute;
      left: 19px;
      top: 50%;
      transform: translateY(-50%);
      color: white;
      font-size: 12px;
      font-weight: bold;
    }
  }
  
  &:active {
    transform: scale(0.98);
  }
}

.option-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.option-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.card-footer {
  padding: 16px 20px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  background: var(--surface-glass);
  border-top: 1px solid var(--surface-border);
}

.footer-btn {
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    pointer-events: none;
  }
  
  &:active {
    transform: scale(0.97);
  }
  
  &.secondary {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
    
    &:hover {
      background: var(--surface-glass-hover);
      border-color: var(--accent-primary);
      color: var(--text-primary);
    }
  }

  &.ghost {
    background: var(--surface-glass);
    border: 1px solid var(--surface-border);
    color: var(--text-secondary);

    &:hover {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
    }
  }
  
  &.primary {
    background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary, #8b5cf6) 100%);
    border: none;
    color: white;
    font-weight: 600;
    
    &:hover {
      box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3);
      transform: translateY(-1px);
    }
  }
}

@media (max-width: 768px) {
  .ask-user-question-card {
    border-radius: 16px;
    margin-top: 8px;
  }
  
  .card-header {
    padding: 14px 16px;
  }
  
  .header-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
  }
  
  .header-text h3 {
    font-size: var(--font-size-base);
  }
  
  .card-body {
    padding: 12px 16px;
  }
  
  .question-item {
    margin-bottom: 16px;
  }
  
  .question-title {
    font-size: 13px;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  
  .options-grid {
    gap: 8px;
  }
  
  .option-btn {
    padding: 12px 14px 12px 46px;
    border-radius: 10px;
    
    &::before {
      width: 20px;
      height: 20px;
      left: 12px;
    }
    
    &.selected::after {
      left: 17px;
      font-size: 11px;
    }
  }
  
  .option-label {
    font-size: 13px;
  }
  
  .option-desc {
    font-size: 11px;
  }
  
  .card-footer {
    padding: 14px 16px 18px;
    gap: 8px;
  }
  
  .footer-btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
  }
}
</style>