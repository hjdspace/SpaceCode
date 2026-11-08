// electron/preload/skillManager.ts
// 技能管理器 V2 域：技能中心、分发、包、诊断与 Agent 管理。

import { SCHEMA_MANAGER_CHANNELS } from '../skillManagerV2/channels'
import type { PreloadIpc } from './types'

export function createSkillManagerApi(ipcRenderer: PreloadIpc) {
  return {
    skillManagerV2: {
      bootstrap: (): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('skill-manager:bootstrap'),
      init: () =>
        ipcRenderer.invoke('skill-manager:init'),
      getOverview: () =>
        ipcRenderer.invoke('skill-manager:overview'),
      refresh: () =>
        ipcRenderer.invoke('skill-manager:refresh'),
      getSettings: () =>
        ipcRenderer.invoke('skill-manager:settings'),
      updateSettings: (patch: Record<string, unknown>) =>
        ipcRenderer.invoke('skill-manager:update-settings', patch),
      listCenterSkills: () =>
        ipcRenderer.invoke('skill-manager:list-center-skills'),
      getSkillDetail: (skillId: string) =>
        ipcRenderer.invoke('skill-manager:get-skill-detail', skillId),
      previewDeleteCenterSkill: (skillId: string) =>
        ipcRenderer.invoke('skill-manager:preview-delete-center-skill', skillId),
      executeDeleteCenterSkill: (skillId: string) =>
        ipcRenderer.invoke('skill-manager:execute-delete-center-skill', skillId),
      openPath: (targetPath: string): Promise<string> =>
        ipcRenderer.invoke('skill-manager:open-path', targetPath),
      previewAddCenterSkill: (input: Record<string, unknown>) =>
        ipcRenderer.invoke('skill-manager:preview-add-center-skill', input),
      executeAddCenterSkill: (input: Record<string, unknown>, decisions: Record<string, unknown>[]) =>
        ipcRenderer.invoke('skill-manager:execute-add-center-skill', input, decisions),
      previewDistribute: (skillIds: string[], targetAgentIds: string[], requestedMode: string) =>
        ipcRenderer.invoke('skill-manager:preview-distribute', skillIds, targetAgentIds, requestedMode),
      executeDistribute: (preview: Record<string, unknown>) =>
        ipcRenderer.invoke('skill-manager:execute-distribute', preview),
      deleteTarget: (targetId: string) =>
        ipcRenderer.invoke('skill-manager:delete-target', targetId),
      scanAgentInventory: (agentId: string) =>
        ipcRenderer.invoke('skill-manager:scan-agent-inventory', agentId),
      listUnmanaged: () =>
        ipcRenderer.invoke('skill-manager:list-unmanaged'),
      listAgentSkillInventory: () =>
        ipcRenderer.invoke('skill-manager:list-agent-skill-inventory'),
      previewAdopt: (agentId: string, unmanagedId: string) =>
        ipcRenderer.invoke('skill-manager:preview-adopt', agentId, unmanagedId),
      executeAdopt: (agentId: string, unmanagedId: string, option: string, renamedId?: string) =>
        ipcRenderer.invoke('skill-manager:execute-adopt', agentId, unmanagedId, option, renamedId),
      executeAdoptBatch: (items: Record<string, unknown>[]) =>
        ipcRenderer.invoke('skill-manager:execute-adopt-batch', items),

      // Skill Packs
      listPacks: () =>
        ipcRenderer.invoke('skill-manager:list-packs'),
      getPackDetail: (packId: string) =>
        ipcRenderer.invoke('skill-manager:get-pack-detail', packId),
      upsertPack: (input: Record<string, unknown>) =>
        ipcRenderer.invoke('skill-manager:upsert-pack', input),
      previewDeletePack: (packId: string) =>
        ipcRenderer.invoke('skill-manager:preview-delete-pack', packId),
      deletePack: (packId: string) =>
        ipcRenderer.invoke('skill-manager:delete-pack', packId),
      previewApplyPack: (packId: string, targetAgentIds: string[], requestedMode: string) =>
        ipcRenderer.invoke('skill-manager:preview-apply-pack', packId, targetAgentIds, requestedMode),
      executeApplyPack: (packId: string, targetAgentIds: string[], requestedMode: string) =>
        ipcRenderer.invoke('skill-manager:execute-apply-pack', packId, targetAgentIds, requestedMode),
      previewRemovePackFromAgent: (packId: string, agentId: string) =>
        ipcRenderer.invoke('skill-manager:preview-remove-pack-from-agent', packId, agentId),
      executeRemovePackFromAgent: (packId: string, agentId: string) =>
        ipcRenderer.invoke('skill-manager:execute-remove-pack-from-agent', packId, agentId),

      // Copy Sync
      previewSyncCopy: (targetId: string) =>
        ipcRenderer.invoke('skill-manager:preview-sync-copy', targetId),
      executeSyncCopy: (targetId: string, action: string) =>
        ipcRenderer.invoke('skill-manager:execute-sync-copy', targetId, action),
      previewCopyTargetDiff: (targetId: string) =>
        ipcRenderer.invoke('skill-manager:preview-copy-diff', targetId),

      // Diagnosis
      runDiagnosis: () =>
        ipcRenderer.invoke('skill-manager:run-diagnosis'),
      listDiagnosisIssues: () =>
        ipcRenderer.invoke('skill-manager:list-diagnosis-issues'),
      executeSafeFixes: () =>
        ipcRenderer.invoke('skill-manager:execute-safe-fixes'),
      exportSnapshot: () =>
        ipcRenderer.invoke('skill-manager:export-snapshot'),

      // Agent Management
      listAgents: () =>
        ipcRenderer.invoke('skill-manager:list-agents'),
      getAgentDetail: (agentId: string) =>
        ipcRenderer.invoke('skill-manager:get-agent-detail', agentId),
      scanAgentDetail: (agentId: string) =>
        ipcRenderer.invoke('skill-manager:scan-agent-detail', agentId),
      refreshAgentVersions: () =>
        ipcRenderer.invoke('skill-manager:refresh-agent-versions'),
      extractArchive: (archivePath: string) =>
        ipcRenderer.invoke('skill-manager:extract-archive', archivePath),
      cloneGitHubRepo: (url: string, branch?: string, subPath?: string) =>
        ipcRenderer.invoke(SCHEMA_MANAGER_CHANNELS.CLONE_GITHUB_REPO, url, branch, subPath),
    },
  }
}
