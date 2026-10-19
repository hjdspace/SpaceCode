/**
 * 跨会话写入账本 —— 记录"本 App 里哪个会话最后写了这个文件"。
 *
 * 会话归属靠工具事件，但并行会话在同一仓库上跑，回合窗口观测会把别人的写入
 * 也算进来。账本把权威信息（自己派发的 Write/Edit）记下来，让展示层能够分辨
 * "我写的"与"我写过、但随后被别的会话覆盖"。
 *
 * 局限：在终端或别的 IDE 里跑的写入不会进账本，那部分只能靠回合窗口判定，
 * 所以它只做降级标记，不做删除依据 —— 唯一被账本剔除的是"窗口观测 + 别人是最后写入者"。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { FILE_TOOLS } from '@/stores/turn/types'
import { extractToolFilePaths, resolveToolPathKey } from '@/lib/sessionFileChanges'
import { normalizeProjectPathKey } from '@/utils/recentProjectRoots'

export interface FileWriteRecord {
  sessionId: string
  tool: string
  at: number
}

export interface RecordToolWriteArgs {
  projectRoot: string | null
  sessionId: string
  toolName: string
  input: Record<string, any> | undefined
  workingDirectory?: string
}

export const useFileWriteLedgerStore = defineStore('fileWriteLedger', () => {
  /** projectRoot 归一键 → 文件键 → 最后写入者。跨项目切换靠键隔离，不做清理。 */
  const byProject = ref(new Map<string, Map<string, FileWriteRecord>>())

  /**
   * 登记一次写文件工具的落盘。只认写文件工具；调用失败的登记由调用方挡掉
   * （那边才知道这次结果是不是 error）。
   */
  function recordToolWrite(args: RecordToolWriteArgs, at = Date.now()): void {
    const { projectRoot, sessionId, toolName, input, workingDirectory } = args
    if (!projectRoot || !sessionId || !input) return
    if (!FILE_TOOLS.has(toolName)) return

    const options = { projectRoot, workingDirectory: workingDirectory || projectRoot }
    const paths = extractToolFilePaths(input)
      .map(raw => resolveToolPathKey(raw, options))
      .filter((path): path is string => Boolean(path))
    if (paths.length === 0) return

    const key = normalizeProjectPathKey(projectRoot)
    const project = byProject.value.get(key) || new Map<string, FileWriteRecord>()
    for (const path of paths) {
      const previous = project.get(path)
      // 迟到的工具结果不该覆盖更新的写入
      if (previous && previous.at > at) continue
      project.set(path, { sessionId, tool: toolName, at })
    }
    byProject.value.set(key, project)
  }

  function lastWriter(
    projectRoot: string | null | undefined,
    path: string,
  ): FileWriteRecord | null {
    if (!projectRoot) return null
    return byProject.value.get(normalizeProjectPathKey(projectRoot))?.get(path) ?? null
  }

  return {
    byProject,
    recordToolWrite,
    lastWriter,
  }
})
