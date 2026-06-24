/**
 * useSessionTaskProgress
 *
 * 按 sessionId 解析最近一次 TodoWrite 工具调用，得到该会话的任务列表与进度。
 * 不依赖全局 currentSessionId，可在分屏多 pane 场景下供 PaneHeader / capsule
 * 等组件独立显示每个会话的任务监控数据。
 *
 * 数据源：会话消息列表里所有 assistant message 的 toolCalls，最后一条
 * `TodoWrite` 的 `input.todos` 即为最新任务快照（这与 ChatPanel.vue 中的
 * sessionContext 同步逻辑保持一致）。
 */

import { computed, type Ref } from 'vue'
import { useChatSessionStore } from '@/stores/chatSession'

export interface SessionTaskItem {
  id?: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  isSubtask?: boolean
}

export interface SessionTaskProgress {
  /** 已完成（不含子任务）数量 */
  completed: number
  /** 总数（不含子任务） */
  total: number
}

/**
 * @param sessionIdRef 可为 ref/computed/原始值
 */
export function useSessionTaskProgress(
  sessionIdRef: Ref<string | null | undefined> | (() => string | null | undefined),
) {
  const chatStore = useChatSessionStore()

  const sessionId = computed(() => {
    return typeof sessionIdRef === 'function'
      ? sessionIdRef()
      : sessionIdRef.value
  })

  const tasks = computed<SessionTaskItem[]>(() => {
    const sid = sessionId.value
    if (!sid) return []
    const msgs = chatStore.getDisplayMessages?.(sid) ?? []
    // 从后向前找最近一次 TodoWrite
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i] as any
      const toolCalls = msg?.toolCalls
      if (!toolCalls || !Array.isArray(toolCalls)) continue
      // 同一条消息内可能有多个 toolCalls，取最后一个 TodoWrite
      for (let j = toolCalls.length - 1; j >= 0; j--) {
        const tc = toolCalls[j]
        if (tc?.name === 'TodoWrite' && Array.isArray(tc.input?.todos)) {
          return (tc.input.todos as any[]).map(t => ({
            id: t.id,
            content: t.content || '',
            status: (t.status as SessionTaskItem['status']) || 'pending',
            isSubtask: !!t.isSubtask,
          }))
        }
      }
    }
    return []
  })

  const progress = computed<SessionTaskProgress>(() => {
    const list = tasks.value
    const total = list.filter(t => !t.isSubtask).length
    const completed = list.filter(t => !t.isSubtask && t.status === 'completed').length
    return { completed, total }
  })

  const hasTasks = computed(() => tasks.value.length > 0)

  return {
    sessionId,
    tasks,
    progress,
    hasTasks,
  }
}
