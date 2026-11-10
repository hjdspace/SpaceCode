/**
 * useSessionTaskProgress
 *
 * 按 sessionId 解析该会话的任务列表与进度，不依赖全局 currentSessionId /
 * sessionContext 单例，可在分屏多 pane、Worker 镜像等宿主里独立取数。
 *
 * 数据源：会话消息列表里所有 assistant message 的 toolCalls。V2 task 工具
 * （TaskCreate / TaskUpdate / TaskList）按顺序增量回放；最后一条 `TodoWrite`
 * 的 `input.todos` 是完整快照，最后覆盖（两族互斥，与 ChatPanel.vue 的
 * sessionContext 同步逻辑保持一致）。这样 Worker 会话的 TodoWrite 不会
 * 泄漏到 Router 页或其他会话的胶囊上。
 */

import { computed, type Ref } from 'vue'
import { useChatSessionStore } from '@/stores/chatSession'
import { syncTaskStateFromToolCall } from '@/utils/taskToolSync'
import type { ToolCall } from '@/types'

export interface SessionTaskItem {
  id?: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  isSubtask?: boolean
  owner?: string
  blockedBy?: string[]
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

    // 会话内回放：V2 task 工具落到本地 Map，最后一条 TodoWrite 覆盖成完整快照
    const local = new Map<string, SessionTaskItem>()
    const manager = {
      createTask(id: string, content: string) {
        local.set(id, { id, content, status: 'pending' })
      },
      updateTask(id: string, updates: Partial<Pick<SessionTaskItem, 'status' | 'owner'>>) {
        const task = local.get(id)
        if (task) local.set(id, { ...task, ...updates })
      },
      clearTasks() {
        local.clear()
      },
      syncTasksFromList(list: Array<{
        id: string
        content: string
        status: string
        owner?: string
        blockedBy?: string[]
      }>) {
        local.clear()
        for (const t of list) {
          local.set(t.id, {
            id: t.id,
            content: t.content,
            status: t.status as SessionTaskItem['status'],
            owner: t.owner,
            blockedBy: t.blockedBy,
          })
        }
      },
    }

    let latestTodos: SessionTaskItem[] | null = null
    for (const msg of msgs) {
      const toolCalls = (msg as any)?.toolCalls
      if (!toolCalls || !Array.isArray(toolCalls)) continue
      for (const tc of toolCalls as ToolCall[]) {
        if (tc.name === 'TodoWrite' && Array.isArray(tc.input?.todos)) {
          latestTodos = (tc.input.todos as any[]).map(t => ({
            id: t.id,
            content: t.content || '',
            status: (t.status as SessionTaskItem['status']) || 'pending',
            isSubtask: !!t.isSubtask,
          }))
        } else if (tc.name === 'TaskCreate' || tc.name === 'TaskUpdate' || tc.name === 'TaskList') {
          syncTaskStateFromToolCall(manager, tc, tc.output || '')
        }
      }
    }
    return latestTodos ?? Array.from(local.values())
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
