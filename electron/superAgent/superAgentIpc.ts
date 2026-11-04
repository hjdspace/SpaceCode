/**
 * Super Agent IPC 入口（T01 #71）：把 shared 定义的命令挂到 ipcMain 上。
 * 只做入口校验与转发；领域规则在 service。
 */
import { ipcMain } from 'electron'
import { registerHandlers } from '@/shared/handlerRegistry'
import { SUPER_AGENT_PREFIX, superAgentNamespace } from '@/shared/channels/superAgent'
import { createSuperAgentService } from './service'

function requireRepoRoot(repoRoot: unknown): string {
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') {
    throw new Error('repoRoot is required')
  }
  return repoRoot
}

export function registerSuperAgentIPCHandlers(): void {
  const service = createSuperAgentService()

  registerHandlers(ipcMain, superAgentNamespace.channels, SUPER_AGENT_PREFIX, {
    state: (repoRoot) => service.state(requireRepoRoot(repoRoot)),
    routerBind: (repoRoot) => service.routerBind(requireRepoRoot(repoRoot)),
  })
}
