import { electronAPI } from './_context'

export interface AgentListItem {
  agentType: string
  description: string
  source: string
  model?: string
  color?: string
}

export const agents = {
  listAgents: (cwd?: string): Promise<AgentListItem[]> => {
    if (electronAPI?.claudeCode?.listAgents) {
      return electronAPI.claudeCode.listAgents(cwd)
    }
    return Promise.resolve([])
  },
  scanLibrary: (cwd?: string): Promise<any> =>
    electronAPI?.agents?.scanLibrary(cwd) || Promise.resolve({ agents: [] }),
  getInstalled: (cwd?: string): Promise<any> =>
    electronAPI?.agents?.getInstalled(cwd) || Promise.resolve({ agents: [] }),
  install: (name: string, scope: string, cwd?: string): Promise<void> =>
    electronAPI?.agents?.install(name, scope, cwd) || Promise.resolve(),
  uninstall: (name: string, scope: string, cwd?: string): Promise<void> =>
    electronAPI?.agents?.uninstall(name, scope, cwd) || Promise.resolve(),
  listWorkflows: (): Promise<any> =>
    electronAPI?.agents?.listWorkflows() || Promise.resolve({ workflows: [] }),
  saveWorkflow: (workflow: unknown): Promise<void> =>
    electronAPI?.agents?.saveWorkflow(workflow) || Promise.resolve(),
  deleteWorkflow: (id: string): Promise<void> =>
    electronAPI?.agents?.deleteWorkflow(id) || Promise.resolve(),
  exportWorkflow: (id: string, scope: string, cwd?: string): Promise<any> =>
    electronAPI?.agents?.exportWorkflow(id, scope, cwd) || Promise.resolve(null),
  saveCustom: (agentName: string, content: string): Promise<{ success: boolean; path: string }> =>
    electronAPI?.agents?.saveCustom(agentName, content) || Promise.reject('Agents API not available'),
}
