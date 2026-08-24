import { ref, readonly } from 'vue'
import type { RewindOption, RewindState } from '@/types/rewind'

/**
 * Rewind 对话框 UI 状态机 module。
 *
 * 从 chatSession store 中提取的 deep module：
 * - 小 interface：`rewindState`（只读 ref）+ `patchRewindState`（单一批量更新方法）
 * - 实现吸收了 8 个独立 setter，调用方只需 patch 需要变更的字段
 *
 * 前身是 store 中的 setShowRewindDialog / setRewindSelectedMessage /
 * setRewindSelectedOption / setRewindSummarizeFeedback / setRewindError /
 * setShowCodeConfirm / setFilesToRewind / resetRewindState 共 8 个一行函数。
 */
export function useRewindDialog() {
  const rewindState = ref<RewindState>({
    showDialog: false,
    selectedMessageId: null,
    selectedOption: 'both',
    summarizeFeedback: '',
    isRewinding: false,
    error: null,
    showCodeConfirm: false,
    filesToRewind: [],
  })

  /** 批量更新 rewind 状态，只传需要变更的字段。 */
  function patchRewindState(patch: Partial<RewindState>): void {
    rewindState.value = { ...rewindState.value, ...patch }
  }

  /** 重置到初始状态。 */
  function resetRewindState(): void {
    rewindState.value = {
      showDialog: false,
      selectedMessageId: null,
      selectedOption: 'both',
      summarizeFeedback: '',
      isRewinding: false,
      error: null,
      showCodeConfirm: false,
      filesToRewind: [],
    }
  }

  return {
    rewindState: readonly(rewindState),
    patchRewindState,
    resetRewindState,
  }
}
