/**
 * Memory Channel 定义 — 项目记忆文件 IPC 的单一真相源。
 *
 * 全部为 invoke channel，前缀 `memory:`：
 *   listProjects — 列出有记忆目录的项目
 *   listFiles    — 列出某项目记忆目录下的 Markdown 文件
 *   readFile     — 读取单个记忆文件
 *   saveFile     — 覆盖写入（或新建）单个记忆文件
 */
import type {
  MemoryFile,
  MemoryFileDetail,
  MemoryFileRevision,
  MemoryProject,
  MemorySaveInput,
} from '@/types/memory'
import { defineChannels } from '@/shared/channelMap'

export const memoryChannels = defineChannels({
  listProjects: {
    req: [] as unknown as [cwd?: string],
    res: null as unknown as { projects: MemoryProject[] },
  },
  listFiles: {
    req: [] as unknown as [projectId: string],
    res: null as unknown as { files: MemoryFile[] },
  },
  readFile: {
    req: [] as unknown as [projectId: string, path: string],
    res: null as unknown as { file: MemoryFileDetail },
  },
  saveFile: {
    req: [] as unknown as [input: MemorySaveInput],
    res: null as unknown as { ok: true; file: MemoryFileRevision },
  },
})

export type MemoryChannelMap = typeof memoryChannels
export type MemoryRendererApi = import('@/shared/channelMap').DeriveRendererApi<MemoryChannelMap>
export type MemoryHandlerMap = import('@/shared/channelMap').DeriveHandler<MemoryChannelMap>
