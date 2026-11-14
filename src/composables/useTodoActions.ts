/**
 * 待办 → 输入框 的两个动作，以及面板内的一次性提示条。
 *
 * 提示条状态放在模块作用域（与 useDialog 同一套做法）：行菜单、详情抽屉、
 * 快速新建都要发提示，但只有 TodoManager 一个宿主渲染它。走 errorHandler 的
 * toast 不合适 —— 那个通道只有 error/warning 两种皮，成功提示会被画成报错。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { buildTodoAgentPrompt } from '@/shared/todoReference'
import type { Todo } from '@/shared/channels/todo'

const notice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null

const NOTICE_MS = 2600

export function useTodoActions() {
  const appStore = useAppStore()
  const { t } = useI18n()

  function notify(message: string): void {
    notice.value = message
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => {
      notice.value = null
      noticeTimer = null
    }, NOTICE_MS)
  }

  function dismissNotice(): void {
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = null
    notice.value = null
  }

  /** 待办面板占着中央面板，不关掉它 ChatInput 根本没挂载，注入会一直悬着。 */
  function revealComposer(): void {
    appStore.showTodoManager = false
    appStore.activeCenterTab = 'chat'
  }

  function referenceInComposer(todo: Todo): void {
    revealComposer()
    appStore.pushToInput({ todo: { id: todo.id, title: todo.title } })
    notify(t('todo.composer.referenced', { title: todo.title }))
  }

  function handToAgent(todo: Todo): void {
    revealComposer()
    appStore.pushToInput({
      todo: { id: todo.id, title: todo.title },
      text: buildTodoAgentPrompt(todo),
    })
    notify(t('todo.composer.agentPromptReady', { title: todo.title }))
  }

  async function copyTitle(todo: Todo): Promise<void> {
    try {
      await navigator.clipboard.writeText(todo.title)
      notify(t('todo.composer.copied'))
    } catch {
      // 剪贴板被系统拒绝时不弹错误：标题还在行上，用户自己选得中。
    }
  }

  return { notice, notify, dismissNotice, referenceInComposer, handToAgent, copyTitle }
}