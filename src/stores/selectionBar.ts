import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 浮条使用场景: 聊天面板(仅解释/添加到对话) 或 文件查看器(全功能) */
export type SelectionBarContext = 'chat' | 'file'

/** 浮条相位机: idle(待操作) → busy(AI 处理中) → result(Keep/Discard) | error */
export type SelectionBarPhase = 'idle' | 'busy' | 'result' | 'error'

/** 选区末行在视口中的位置(px, position:fixed 坐标) */
export interface SelectionBarAnchor {
  top: number
  bottom: number
  left: number
  width: number
}

/**
 * 选中文字浮动操作条的 UI 状态。
 * 全局仅一个浮条: open() 重置全部状态, 新开即关闭旧的。
 */
export const useSelectionBarStore = defineStore('selectionBar', () => {
  const visible = ref(false)
  const context = ref<SelectionBarContext>('chat')
  const phase = ref<SelectionBarPhase>('idle')
  const anchor = ref<SelectionBarAnchor | null>(null)
  const selectedText = ref('')
  /** busy 相位的 i18n key, 组件负责翻译 */
  const busyKey = ref('')
  const error = ref('')
  /** file 场景: Shorten/Tone/Grammar 展开态 */
  const expanded = ref(false)
  /** file 场景: 自由输入的修改描述 */
  const draft = ref('')
  const showExplainCard = ref(false)
  const explainText = ref('')

  function open(payload: { context: SelectionBarContext; selectedText: string; anchor: SelectionBarAnchor }) {
    visible.value = true
    context.value = payload.context
    selectedText.value = payload.selectedText
    anchor.value = payload.anchor
    phase.value = 'idle'
    busyKey.value = ''
    error.value = ''
    expanded.value = false
    draft.value = ''
    showExplainCard.value = false
    explainText.value = ''
  }

  function close() {
    visible.value = false
    phase.value = 'idle'
    anchor.value = null
    selectedText.value = ''
    busyKey.value = ''
    error.value = ''
    expanded.value = false
    draft.value = ''
    showExplainCard.value = false
    explainText.value = ''
  }

  function setAnchor(a: SelectionBarAnchor) {
    anchor.value = a
  }

  function setBusy(key: string) {
    phase.value = 'busy'
    busyKey.value = key
    error.value = ''
    showExplainCard.value = false
  }

  function setResult() {
    phase.value = 'result'
    busyKey.value = ''
  }

  function setError(message: string) {
    phase.value = 'error'
    busyKey.value = ''
    error.value = message
  }

  function setExplain(text: string) {
    explainText.value = text
    showExplainCard.value = true
  }

  function closeExplainCard() {
    showExplainCard.value = false
    explainText.value = ''
  }

  return {
    visible,
    context,
    phase,
    anchor,
    selectedText,
    busyKey,
    error,
    expanded,
    draft,
    showExplainCard,
    explainText,
    open,
    close,
    setAnchor,
    setBusy,
    setResult,
    setError,
    setExplain,
    closeExplainCard,
  }
})
