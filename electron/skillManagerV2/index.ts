/**
 * Skill Manager V2 — IPC Handler Registration
 *
 * Registers all `skill-manager:*` IPC channels.
 * Reference: AgentBro `src-tauri/src/skills/v2/commands.rs`
 */

import { ipcMain, shell } from 'electron'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SkillManagerService } from './service'
import { SCHEMA_MANAGER_CHANNELS } from './channels'
import type {
  SkillManagerOverview,
  SkillManagerSettings,
  SkillSummary,
  SkillDetail,
  DeleteCenterSkillPreview,
  AddCenterSkillInput,
  AddCenterSkillPreview,
  AddCenterSkillDecision,
  AddCenterSkillResult,
  InstallMode,
  DistributionPreview,
  DistributionResult,
  AdoptOption,
  AdoptPreview,
  AdoptBatchItem,
  AdoptBatchResult,
  AgentInventoryScanResult,
  UnmanagedItemDto,
  SkillPackSummary,
  SkillPackDetail,
  UpsertPackInput,
  DeletePackPreview,
  RemovePackFromAgentPreview,
  RemovePackFromAgentResult,
  CopySyncPreview,
  CopySyncResult,
  CopySyncAction,
  CopyTargetDiffPreview,
  DiagnosisIssue,
  AgentSummary,
  AgentDetail,
} from '@/types/skillManagerV2'

let service: SkillManagerService | null = null

/** Lazy-initialize the service on first call. */
function getService(): SkillManagerService {
  if (!service) {
    service = SkillManagerService.bootstrap()
  }
  return service
}

/** Register all skill-manager IPC handlers. */
export function registerSkillManagerV2IPCHandlers(): void {
  // ── Overview & Settings ──────────────────────────────────────────

  ipcMain.handle(SCHEMA_MANAGER_CHANNELS.BOOTSTRAP, () => {
    getService()
    return { success: true }
  })

  ipcMain.handle(SCHEMA_MANAGER_CHANNELS.INIT, () => {
    const svc = getService()
    return svc.refresh()
  })

  ipcMain.handle(SCHEMA_MANAGER_CHANNELS.OVERVIEW, (): SkillManagerOverview => {
    return getService().getOverview()
  })

  ipcMain.handle(SCHEMA_MANAGER_CHANNELS.REFRESH, (): SkillManagerOverview => {
    return getService().refresh()
  })

  ipcMain.handle(SCHEMA_MANAGER_CHANNELS.SETTINGS, (): SkillManagerSettings => {
    return getService().getSettings()
  })

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.UPDATE_SETTINGS,
    (_event, patch: Partial<SkillManagerSettings>): SkillManagerSettings => {
      return getService().updateSettings(patch)
    }
  )

  // ── Skill Library (Slice 2) ─────────────────────────────────────

  ipcMain.handle(SCHEMA_MANAGER_CHANNELS.LIST_CENTER_SKILLS, (): SkillSummary[] => {
    return getService().listCenterSkills()
  })

  ipcMain.handle(SCHEMA_MANAGER_CHANNELS.GET_SKILL_DETAIL, (_event, skillId: string): SkillDetail | null => {
    return getService().getSkillDetail(skillId)
  })

  ipcMain.handle(SCHEMA_MANAGER_CHANNELS.PREVIEW_DELETE_CENTER_SKILL, (_event, skillId: string): DeleteCenterSkillPreview | null => {
    return getService().previewDeleteCenterSkill(skillId)
  })

  ipcMain.handle(SCHEMA_MANAGER_CHANNELS.EXECUTE_DELETE_CENTER_SKILL, (_event, skillId: string): void => {
    getService().executeDeleteCenterSkill(skillId)
  })

  // ── Open path ────────────────────────────────────────────────────

  ipcMain.handle(SCHEMA_MANAGER_CHANNELS.OPEN_PATH, (_event, targetPath: string) => {
    return shell.openPath(targetPath)
  })

  // ── Add Center Skill (Slice 3) ─────────────────────────────────

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.PREVIEW_ADD_CENTER_SKILL,
    (_event, input: AddCenterSkillInput): AddCenterSkillPreview => {
      return getService().previewAddCenterSkill(input)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.EXECUTE_ADD_CENTER_SKILL,
    (_event, input: AddCenterSkillInput, decisions: AddCenterSkillDecision[]): AddCenterSkillResult => {
      return getService().executeAddCenterSkill(input, decisions)
    }
  )

  // ── Distribute (Slice 4) ──────────────────────────────────────────

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.PREVIEW_DISTRIBUTE,
    (_event, skillIds: string[], targetAgentIds: string[], requestedMode: InstallMode): DistributionPreview => {
      return getService().previewDistribute(skillIds, targetAgentIds, requestedMode)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.EXECUTE_DISTRIBUTE,
    (_event, preview: DistributionPreview): DistributionResult => {
      return getService().executeDistribute(preview)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.DELETE_TARGET,
    (_event, targetId: string): void => {
      getService().deleteTarget(targetId)
    }
  )

  // ── Agent Scan & Adopt (Slice 5) ─────────────────────────────────

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.SCAN_AGENT_INVENTORY,
    (_event, agentId: string): AgentInventoryScanResult => {
      return getService().scanAgentInventory(agentId)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.LIST_UNMANAGED,
    (): UnmanagedItemDto[] => {
      return getService().listUnmanaged()
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.PREVIEW_ADOPT,
    (_event, agentId: string, unmanagedId: string): AdoptPreview => {
      return getService().previewAdopt(agentId, unmanagedId)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.EXECUTE_ADOPT,
    (_event, agentId: string, unmanagedId: string, option: AdoptOption, renamedId?: string): void => {
      getService().executeAdopt(agentId, unmanagedId, option, renamedId)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.EXECUTE_ADOPT_BATCH,
    (_event, items: AdoptBatchItem[]): AdoptBatchResult => {
      return getService().executeAdoptBatch(items)
    }
  )

  // ── Skill Packs ───────────────────────────────────────────────────

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.LIST_PACKS,
    (): SkillPackSummary[] => {
      return getService().listPacks()
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.GET_PACK_DETAIL,
    (_event, packId: string): SkillPackDetail | null => {
      return getService().getPackDetail(packId)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.UPSERT_PACK,
    (_event, input: UpsertPackInput): SkillPackDetail => {
      return getService().upsertPack(input)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.PREVIEW_DELETE_PACK,
    (_event, packId: string): DeletePackPreview => {
      return getService().previewDeletePack(packId)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.DELETE_PACK,
    (_event, packId: string): void => {
      getService().deletePack(packId)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.PREVIEW_APPLY_PACK,
    (_event, packId: string, targetAgentIds: string[], requestedMode: InstallMode): DistributionPreview => {
      return getService().previewApplyPack(packId, targetAgentIds, requestedMode)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.EXECUTE_APPLY_PACK,
    (_event, packId: string, targetAgentIds: string[], requestedMode: InstallMode): DistributionResult => {
      return getService().executeApplyPack(packId, targetAgentIds, requestedMode)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.PREVIEW_REMOVE_PACK_FROM_AGENT,
    (_event, packId: string, agentId: string): RemovePackFromAgentPreview => {
      return getService().previewRemovePackFromAgent(packId, agentId)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.EXECUTE_REMOVE_PACK_FROM_AGENT,
    (_event, packId: string, agentId: string): RemovePackFromAgentResult => {
      return getService().removePackFromAgent(packId, agentId)
    }
  )

  // ── Copy Sync ─────────────────────────────────────────────────────

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.PREVIEW_SYNC_COPY,
    (_event, targetId: string): CopySyncPreview => {
      return getService().previewSyncCopy(targetId)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.EXECUTE_SYNC_COPY,
    (_event, targetId: string, action: CopySyncAction): CopySyncResult => {
      return getService().executeSyncCopy(targetId, action)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.PREVIEW_COPY_DIFF,
    (_event, targetId: string): CopyTargetDiffPreview => {
      return getService().previewCopyTargetDiff(targetId)
    }
  )

  // ── Diagnosis ─────────────────────────────────────────────────────

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.RUN_DIAGNOSIS,
    (_event): DiagnosisIssue[] => {
      return getService().runDiagnosis()
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.LIST_DIAGNOSIS_ISSUES,
    (_event): DiagnosisIssue[] => {
      return getService().listDiagnosisIssues()
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.EXECUTE_SAFE_FIXES,
    (_event): { fixedCount: number; details: string[] } => {
      return getService().executeSafeFixes()
    }
  )

  // ── Snapshot Export ───────────────────────────────────────────────

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.EXPORT_SNAPSHOT,
    (_event): Record<string, unknown> => {
      return getService().exportSnapshot() as unknown as Record<string, unknown>
    }
  )

  // ── Agent Management ──────────────────────────────────────────────

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.LIST_AGENTS,
    (): AgentSummary[] => {
      return getService().listAgents()
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.GET_AGENT_DETAIL,
    (_event, agentId: string) => {
      return getService().getAgentDetail(agentId)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.SCAN_AGENT_DETAIL,
    (_event, agentId: string) => {
      return getService().scanAgentDetail(agentId)
    }
  )

  ipcMain.handle(
    SCHEMA_MANAGER_CHANNELS.EXTRACT_ARCHIVE,
    (_event, archivePath: string): { success: boolean; localPath?: string; error?: string } => {
      try {
        if (!archivePath || path.extname(archivePath).toLowerCase() !== '.zip') {
          return { success: false, error: 'Only .zip archives are supported.' }
        }
        if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
          return { success: false, error: `Archive not found: ${archivePath}` }
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-zip-'))
        const extractedPath = path.join(tmpDir, 'extracted')
        fs.mkdirSync(extractedPath, { recursive: true })

        if (process.platform === 'win32') {
          execFileSync('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '& { param($archive, $dest) Expand-Archive -LiteralPath $archive -DestinationPath $dest -Force }',
            archivePath,
            extractedPath,
          ], { timeout: 60000, stdio: 'pipe' })
        } else {
          execFileSync('unzip', ['-q', archivePath, '-d', extractedPath], {
            timeout: 60000,
            stdio: 'pipe',
          })
        }

        const entries = fs.readdirSync(extractedPath, { withFileTypes: true })
          .filter((entry) => entry.name !== '__MACOSX')
        const localPath = entries.length === 1 && entries[0].isDirectory()
          ? path.join(extractedPath, entries[0].name)
          : extractedPath

        return { success: true, localPath }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  // ── GitHub Clone ───────────────────────────────────────────────────

  ipcMain.handle(
    'skill-manager:clone-github-repo',
    async (_event, url: string, branch?: string, subPath?: string): Promise<{ success: boolean; localPath?: string; error?: string }> => {
      try {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-gh-'))
        const args = ['clone', '--depth', '1']
        if (branch) args.push('--branch', branch)
        args.push('--', url, 'repo')
        execFileSync('git', args, {
          cwd: tmpDir,
          timeout: 60000,
          stdio: 'pipe',
        })
        const repoPath = path.join(tmpDir, 'repo')
        const finalPath = subPath ? path.join(repoPath, subPath) : repoPath

        if (!fs.existsSync(finalPath)) {
          return { success: false, error: `Path not found: ${subPath}` }
        }

        return { success: true, localPath: finalPath }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}

/** Close the skill manager service (for cleanup). */
export function closeSkillManagerService(): void {
  if (service) {
    service.close()
    service = null
  }
}
