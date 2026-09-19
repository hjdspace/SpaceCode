/**
 * Memory renderer API — invoke channels 从 channel 定义表驱动生成。
 *
 * 类型从 memoryChannels 自动派生，与 preload bridge、主进程 handler
 * 共享同一份类型真相源。
 */
import { memoryChannels } from '@/shared/channels/memory'
import type { MemoryRendererApi } from '@/shared/channels/memory'
import { createRendererApi, type AnyElectronAPI } from '@/shared/rendererApi'
import { electronAPI } from './_context'

export const memory: MemoryRendererApi = createRendererApi(
  memoryChannels,
  'memory',
  electronAPI as unknown as AnyElectronAPI,
  {
    // 无 IPC 桥接（如 H5 远程访问）时列表为空；
    // 读写需要真实的文件系统通道，直接拒绝并由调用方转成错误提示。
    listProjects: () => ({ projects: [] }),
    listFiles: () => ({ files: [] }),
    readFile: () => {
      throw new Error('Memory files are only available in the desktop app')
    },
    saveFile: () => {
      throw new Error('Memory files are only available in the desktop app')
    },
  },
)
