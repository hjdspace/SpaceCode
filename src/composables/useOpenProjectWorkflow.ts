import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useSettingsStore } from '@/stores/settings'
import { api } from '@/services/electronAPI'
import { recordRecentProjectRoot } from '@/utils/recentProjectRoots'
import { useDialog } from '@/composables/useDialog'

function dispatchSessionCreated() {
  window.dispatchEvent(new CustomEvent('session-created'))
}

/** openDefaultProject 的 in-flight 去重：连发消息时避免并发创建多个默认项目会话 */
let defaultProjectInFlight: Promise<boolean> | null = null

export type OpenProjectByPathOptions = {
  /** When true (e.g. app menu Open Folder), always start a new session like the legacy menu handler. */
  forceNewSession?: boolean
}

/**
 * Unified flow: pick folder → set app project root → register project → new session + tab.
 */
export function useOpenProjectWorkflow() {
  const { t } = useI18n()
  const appStore = useAppStore()
  const sessionStore = useChatSessionStore()
  const settingsStore = useSettingsStore()
  const { showAlert } = useDialog()

  function syncProjectRootToSettings(path: string) {
    settingsStore.projectRoot = path
    settingsStore.saveSettings()
  }

  async function openProjectFromPicker(): Promise<void> {
    try {
      const result = await api.selectFolder()
      if (result?.canceled || !result.filePaths?.length) return

      const folderPath = result.filePaths[0]
      appStore.setProjectRoot(folderPath)
      recordRecentProjectRoot(folderPath)
      sessionStore.addProject(folderPath)
      syncProjectRootToSettings(folderPath)
      const session = sessionStore.createSession(t('common.newChat'), folderPath)
      dispatchSessionCreated()
    } catch (error) {
      console.error('[useOpenProjectWorkflow] openProjectFromPicker failed:', error)
      await showAlert('Failed to select folder. Please try again.')
    }
  }

  /**
   * Open a known project path (e.g. recent project pill): sync stores, reuse latest session or create one.
   */
  function openProjectByPath(path: string, options?: OpenProjectByPathOptions): void {
    if (!path) return

    try {
      appStore.setProjectRoot(path)
      recordRecentProjectRoot(path)
      sessionStore.addProject(path)
      sessionStore.switchProject(path)
      syncProjectRootToSettings(path)

      if (options?.forceNewSession) {
        const session = sessionStore.createSession(t('common.newChat'), path)
        dispatchSessionCreated()
        return
      }

      const inProject = sessionStore.sessions.filter(
        (s) => (s.workingDirectory || '') === path
      )
      if (inProject.length > 0) {
        const latest = [...inProject].sort(
          (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
        )[0]
        sessionStore.selectSession(latest.id)
      } else {
        const session = sessionStore.createSession(t('common.newChat'), path)
        dispatchSessionCreated()
      }
    } catch (error) {
      console.error('[useOpenProjectWorkflow] openProjectByPath failed:', error)
    }
  }

  /**
   * Open the default workspace (文档/SpaceCode) without a picker:
   * used when the user sends a message before selecting any project folder.
   * Returns false when the default workspace is unavailable (caller should abort the send).
   */
  function openDefaultProject(): Promise<boolean> {
    if (defaultProjectInFlight) return defaultProjectInFlight

    defaultProjectInFlight = (async () => {
      try {
        const dir = await api.ensureDefaultWorkspace()
        if (!dir) {
          await showAlert(t('welcomeNoProject.defaultWorkspaceFailed'))
          return false
        }

        appStore.setProjectRoot(dir)
        recordRecentProjectRoot(dir)
        sessionStore.addProject(dir)
        sessionStore.switchProject(dir)
        syncProjectRootToSettings(dir)
        sessionStore.createSession(t('common.newChat'), dir)
        dispatchSessionCreated()
        return true
      } catch (error) {
        console.error('[useOpenProjectWorkflow] openDefaultProject failed:', error)
        await showAlert(t('welcomeNoProject.defaultWorkspaceFailed'))
        return false
      } finally {
        defaultProjectInFlight = null
      }
    })()

    return defaultProjectInFlight
  }

  return {
    openProjectFromPicker,
    openProjectByPath,
    openDefaultProject,
  }
}
