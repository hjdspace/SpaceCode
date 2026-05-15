<template>
  <div class="ask-user-question-card">
    <div class="card-header">
      <div class="header-icon">
        <MessageCircleQuestion :size="20" />
      </div>
      <div class="header-text">
        <h3>{{ title }}</h3>
        <span>{{ questionCountText }}</span>
      </div>
    </div>
    
    <div class="card-body">
      <div 
        v-for="(question, qIndex) in questions" 
        :key="qIndex"
        class="question-item"
      >
        <div class="question-title">
          <span v-if="question.header" class="chip">{{ question.header }}</span>
          <span>{{ question.question }}</span>
        </div>
        
        <div class="options-grid">
          <button
            v-for="(option, oIndex) in question.options"
            :key="oIndex"
            class="option-btn"
            :class="{ 'selected': isOptionSelected(qIndex, oIndex) }"
            @click="handleOptionClick(qIndex, oIndex, option, question.multiSelect)"
          >
            <div class="option-label">{{ option.label }}</div>
            <div v-if="option.description" class="option-desc">{{ option.description }}</div>
          </button>
        </div>
      </div>
    </div>
    
    <div class="card-footer">
      <button class="footer-btn secondary" @click="handleSkip">
        {{ skipText }}
      </button>
      <button class="footer-btn primary" @click="handleSubmit">
        {{ submitText }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { MessageCircleQuestion } from 'lucide-vue-next'
import type { ToolCall } from '@/types'
import { api } from '@/services/electronAPI'

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
  submit: [answers: Record<string, string>]
  skip: []
}>()

const questions = computed<Question[]>(() => {
  const input = props.toolCall.input || {}
  return input.questions || []
})

const title = computed(() => {
  return questions.value.length > 1 ? '快速选择' : '请做出选择'
})

const questionCountText = computed(() => {
  const count = questions.value.length
  return count > 1 ? `${count}个问题需要您的选择` : '1个问题'
})

const skipText = computed(() => {
  return questions.value.length > 1 ? '跳过全部' : '跳过'
})

const submitText = computed(() => {
  const hasSelections = selections.value.size > 0
  const totalQuestions = questions.value.length
  const answeredQuestions = selections.value.size
  
  if (!hasSelections) return '确认'
  if (answeredQuestions === totalQuestions) return '提交答案'
  return `已选 ${answeredQuestions}/${totalQuestions}`
})

const selections = ref<Map<string, string>>(new Map())

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
  const key = getSelectionKey(qIndex, oIndex)
  
  if (multiSelect) {
    if (selections.value.has(key)) {
      selections.value.delete(key)
    } else {
      selections.value.set(key, option.label)
    }
  } else {
    // 清除同一个问题的其他选择
    for (const [k, _] of selections.value) {
      if (k.startsWith(`${qIndex}-`)) {
        selections.value.delete(k)
      }
    }
    selections.value.set(key, option.label)
  }
}

function handleSkip() {
  emit('skip')
}

function handleSubmit() {
  const answers: Record<string, string> = {}
  
  questions.value.forEach((question, qIndex) => {
    const selectedOptions: string[] = []
    
    question.options.forEach((_, oIndex) => {
      const key = getSelectionKey(qIndex, oIndex)
      if (selections.value.has(key)) {
        selectedOptions.push(selections.value.get(key)!)
      }
    })
    
    if (selectedOptions.length > 0) {
      answers[question.question] = selectedOptions.join(', ')
    }
  })
  
  emit('submit', answers)
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
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 2px;
  }
  
  span {
    font-size: 12px;
    color: var(--text-muted);
  }
}

.card-body {
  padding: 16px 20px;
}

.question-item {
  margin-bottom: 20px;
}

.question-title {
  font-size: 14px;
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
    font-size: 14px;
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