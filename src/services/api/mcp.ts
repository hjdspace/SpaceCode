import { electronAPI } from './_context'

export const mcp = {
  getServers: (): Promise<any> =>
    electronAPI?.mcp?.getServers() || Promise.resolve(null),
  updateServers: (servers: Record<string, unknown>): Promise<void> =>
    electronAPI?.mcp?.updateServers(servers) || Promise.resolve(),
  addServer: (name: string, config: unknown): Promise<void> =>
    electronAPI?.mcp?.addServer(name, config) || Promise.resolve(),
  deleteServer: (name: string): Promise<void> =>
    electronAPI?.mcp?.deleteServer(name) || Promise.resolve(),
  toggleEnabled: (name: string, enabled: boolean): Promise<void> =>
    electronAPI?.mcp?.toggleEnabled(name, enabled) || Promise.resolve(),
  reconnectServer: (sessionId: string, serverName: string): Promise<void> =>
    electronAPI?.mcp?.reconnectServer(sessionId, serverName) || Promise.resolve(),
  toggleServerRuntime: (sessionId: string, serverName: string, enabled: boolean): Promise<void> =>
    electronAPI?.mcp?.toggleServerRuntime(sessionId, serverName, enabled) || Promise.resolve(),
  probeServer: (config: unknown): Promise<any> =>
    electronAPI?.mcp?.probeServer(config) || Promise.resolve(null),
  checkDependency: (command: string): Promise<any> =>
    electronAPI?.mcp?.checkDependency(command) || Promise.resolve(null),
  installDependency: (command: 'uv'): Promise<any> =>
    electronAPI?.mcp?.installDependency(command) || Promise.resolve({ success: false, error: 'electronAPI unavailable' }),
  onInstallProgress: (callback: (progress: any) => void): (() => void) =>
    electronAPI?.mcp?.onInstallProgress?.(callback) || (() => {}),
  getActiveMcpNames: (): Promise<string[]> =>
    electronAPI?.mcp?.getActiveMcpNames?.() || Promise.resolve([]),
}
