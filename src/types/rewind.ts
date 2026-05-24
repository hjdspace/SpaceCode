/**
 * Rewind types - aligned with claude-code TUI /rewind command
 */

/** Rewind action options matching claude-code TUI */
export type RewindOption = 'both' | 'conversation' | 'code' | 'summarize' | 'cancel'

/** State for the rewind feature */
export interface RewindState {
  showDialog: boolean
  selectedMessageId: string | null
  selectedOption: RewindOption
  summarizeFeedback: string
  isRewinding: boolean
  error: string | null
  showCodeConfirm: boolean       // 是否显示代码回滚确认弹窗
  filesToRewind: string[]        // 将要回滚的文件路径列表
}

/** Diff statistics for rewind preview */
export interface RewindDiffStats {
  filesChanged: number
  insertions: number
  deletions: number
}

/** Props for the RewindDialog component */
export interface RewindDialogProps {
  show: boolean
  selectedMessageId: string | null
  selectedOption: RewindOption
  summarizeFeedback: string
  isRewinding: boolean
  error: string | null
  diffStats: RewindDiffStats | null
}

/** Emits for the RewindDialog component */
export interface RewindDialogEmits {
  'update:show': (value: boolean) => void
  'update:selectedOption': (value: RewindOption) => void
  'update:summarizeFeedback': (value: string) => void
  confirm: () => void
  cancel: () => void
}

/** Props for the MessageSelector component */
export interface MessageSelectorProps {
  messages: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
  }>
  selectedMessageId: string | null
}

/** Emits for the MessageSelector component */
export interface MessageSelectorEmits {
  select: (messageId: string) => void
}
