import { ref, type Ref } from 'vue'
import type {
  ExtensionDialogCloseReason,
  ExtensionDialogRequest,
} from '@/shared/channels/claudeCode'

/**
 * 渲染层看到的一条 pi 扩展对话框。
 *
 * 不复用 `permissionService`：那张表按 `toolUseId` 索引，是 Claude 权限卡片的承重墙，
 * 而扩展对话框带的是 pi 自己的 UUID，时间线上也没有对应的工具条目可挂 (#54)。
 */
export interface ExtensionDialog extends ExtensionDialogRequest {
  sessionId: string
  state: 'pending' | 'resolved'
  /** 用户看到的哪个标签被点了 —— 卡片上留下的回执就用它，不再二次翻译一遍 */
  outcomeText?: string
  /** state 为 resolved 且不是用户答的时候，说明它是怎么没的 */
  closedReason?: ExtensionDialogCloseReason
  /**
   * 问出来那一刻落在时间线上的哪个位置（渲染层自己的坐标，不进 wire 类型）。
   *
   * 对话框不属于任何一条 message，也没有 toolCallId，所以只能由渲染层在收到帧的那一刻
   * 替它记下游标；不记的话它只能被追加到时间线末尾，用户答完之后 LLM 接着往下说，
   * 卡片就把最新输出压在下面，看着像一直挂在底部 (#54)。
   */
  anchorMessageId?: string
  anchorEventId?: string
  /**
   * 提问发生时锚点消息还没有任何 timeline 事件（典型是 `/plan` 菜单在模型输出前
   * 弹出）。此时位置是「消息开头」而不是「消息末尾」：之后流式产生的推理、工具行
   * 都该排在卡片之后，否则卡片会被顶到最新输出下面，看着像一直挂在底部 (#54)。
   */
  anchorAtStart?: boolean
}

export class ExtensionDialogService {
  /** sessionId → dialogId → 对话框。Map 保持插入顺序，菜单连问时卡片就按问的顺序排 */
  private dialogs: Ref<Map<string, Map<string, ExtensionDialog>>> = ref(new Map())

  open(sessionId: string, request: ExtensionDialogRequest): void {
    const next = new Map(this.dialogs.value)
    let bySession = next.get(sessionId)
    if (!bySession) {
      bySession = new Map()
      next.set(sessionId, bySession)
    }
    bySession.set(request.dialogId, { ...request, sessionId, state: 'pending' })
    this.dialogs.value = next
  }

  get(sessionId: string, dialogId: string): ExtensionDialog | undefined {
    return this.dialogs.value.get(sessionId)?.get(dialogId)
  }

  /** 按到达顺序返回该会话的全部对话框；已应答的也留着，它们构成菜单那一路的痕迹 */
  list(sessionId: string): ExtensionDialog[] {
    const bySession = this.dialogs.value.get(sessionId)
    return bySession ? Array.from(bySession.values()) : []
  }

  hasPending(sessionId: string): boolean {
    return this.list(sessionId).some(dialog => dialog.state === 'pending')
  }

  /**
   * 记一次应答。调用点在 IPC 之前，失败时由 `revertToPending` 撤回 —— 卡片得先收起
   * 再等回执，否则双击会答出两条；而没送达的那次不能留在界面上冒充已答。
   */
  resolve(sessionId: string, dialogId: string, outcomeText: string): void {
    this.mutate(sessionId, dialogId, dialog => ({ ...dialog, state: 'resolved', outcomeText }))
  }

  revertToPending(sessionId: string, dialogId: string): void {
    this.mutate(sessionId, dialogId, dialog => ({ ...dialog, state: 'pending', outcomeText: undefined }))
  }

  /**
   * 引擎那侧这个问题已经不存在了（超时、进程没了、另一个端答掉了）。
   * 用户答过的不覆盖：他的回执比后到的关闭通知可信。
   */
  close(sessionId: string, dialogId: string, reason: ExtensionDialogCloseReason): void {
    const dialog = this.get(sessionId, dialogId)
    if (!dialog || dialog.state === 'resolved') return
    this.mutate(sessionId, dialogId, current => ({ ...current, state: 'resolved', closedReason: reason }))
  }

  /** 会话的进程不在了，它欠的对话框就都算过期：卡片退场，别留一张点不动的 */
  closeAllForSession(sessionId: string, reason: ExtensionDialogCloseReason): void {
    for (const dialog of this.list(sessionId)) {
      if (dialog.state === 'pending') this.close(sessionId, dialog.dialogId, reason)
    }
  }

  clear(sessionId?: string): void {
    if (!sessionId) {
      this.dialogs.value = new Map()
      return
    }
    const next = new Map(this.dialogs.value)
    next.delete(sessionId)
    this.dialogs.value = next
  }

  private mutate(
    sessionId: string,
    dialogId: string,
    patch: (dialog: ExtensionDialog) => ExtensionDialog,
  ): void {
    const bySession = this.dialogs.value.get(sessionId)
    const current = bySession?.get(dialogId)
    if (!current) return

    const nextBySession = new Map(bySession)
    nextBySession.set(dialogId, patch(current))
    const next = new Map(this.dialogs.value)
    next.set(sessionId, nextBySession)
    this.dialogs.value = next
  }
}

export const extensionDialogService = new ExtensionDialogService()
