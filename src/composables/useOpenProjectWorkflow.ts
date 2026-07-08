import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { api } from '@/services/electronAPI'
import { recordRecentProjectRoot } from '@/utils/recentProjectRoots'
import { useDialog } from '@/composables/useDialog'

function dispatchSessionCreated() {
  window.dispatchEvent(new CustomEvent('session-created'))
}

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
      appStore.openSessionTab(session.id, session.title)
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
        appStore.openSessionTab(session.id, session.title)
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
        appStore.switchToSessionTab(latest.id)
      } else {
        const session = sessionStore.createSession(t('common.newChat'), path)
        appStore.openSessionTab(session.id, session.title)
        dispatchSessionCreated()
      }
    } catch (error) {
      console.error('[useOpenProjectWorkflow] openProjectByPath failed:', error)
    }
  }

  return {
    openProjectFromPicker,
    openProjectByPath,
  }
}
