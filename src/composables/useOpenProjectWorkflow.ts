import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
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
  const chatStore = useChatStore()
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
      chatStore.addProject(folderPath)
      syncProjectRootToSettings(folderPath)
      const session = chatStore.createSession(t('common.newChat'), folderPath)
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
      chatStore.addProject(path)
      chatStore.switchProject(path)
      syncProjectRootToSettings(path)

      if (options?.forceNewSession) {
        const session = chatStore.createSession(t('common.newChat'), path)
        appStore.openSessionTab(session.id, session.title)
        dispatchSessionCreated()
        return
      }

      const inProject = chatStore.sessions.filter(
        (s) => (s.workingDirectory || '') === path
      )
      if (inProject.length > 0) {
        const latest = [...inProject].sort(
          (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
        )[0]
        chatStore.selectSession(latest.id)
        appStore.switchToSessionTab(latest.id)
      } else {
        const session = chatStore.createSession(t('common.newChat'), path)
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
