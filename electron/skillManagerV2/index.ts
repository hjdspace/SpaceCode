/**
 * Skill Manager V2 — IPC Handler Registration
 *
 * Registers all `skill-manager:*` IPC channels.
 * Reference: AgentBro `src-tauri/src/skills/v2/commands.rs`
 */

import { ipcMain, shell } from 'electron'
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
}

/** Close the skill manager service (for cleanup). */
export function closeSkillManagerService(): void {
  if (service) {
    service.close()
    service = null
  }
}
