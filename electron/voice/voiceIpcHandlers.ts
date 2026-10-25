/**
 * Voice Input IPC handlers — model management only in ticket 01.
 *
 * The manager is a singleton because the download job outlives a settings
 * panel mount. Progress is forwarded to the renderer on every chunk.
 */
import { app, ipcMain } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { channelNames, eventChannels } from '@/shared/channelMap'
import { voiceNamespace } from '@/shared/channels/voice'
import { getGuiSettingsPath } from '../ipc/settingsIpc'
import { getMainWindow } from '../windows/mainWindow'
import { SpeechModelManager } from './speechModelManager'

const VOICE_CHANNELS = channelNames(voiceNamespace.channels, 'voice:')
const VOICE_EVENTS = eventChannels(voiceNamespace.events, 'voice:')

let manager: SpeechModelManager | null = null
let recordingProbe: () => boolean = () => false

/** Ticket 02 wires the live recording session into model removal. */
export function setVoiceRecordingProbe(probe: () => boolean): void {
  recordingProbe = probe
}

function readCustomDownloadUrl(): string | null {
  try {
    const raw = readFileSync(getGuiSettingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as { voiceInputCustomUrl?: unknown }
    return typeof parsed.voiceInputCustomUrl === 'string' ? parsed.voiceInputCustomUrl : null
  } catch {
    return null
  }
}

export function getVoiceModelManager(): SpeechModelManager {
  if (!manager) {
    manager = new SpeechModelManager({
      rootDir: join(app.getPath('userData'), 'voice'),
      getCustomUrl: readCustomDownloadUrl,
      isRecording: () => recordingProbe(),
    })
    manager.on('progress', (progress) => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(VOICE_EVENTS.onModelProgress, progress)
      }
    })
  }
  return manager
}

export function registerVoiceIPCHandlers(): void {
  const modelManager = getVoiceModelManager()

  ipcMain.handle(VOICE_CHANNELS.getModelStatus, () => modelManager.getStatus())
  ipcMain.handle(VOICE_CHANNELS.getInstallInfo, () => modelManager.getInstallInfo())
  ipcMain.handle(VOICE_CHANNELS.installModel, () => modelManager.install())
  ipcMain.handle(VOICE_CHANNELS.cancelInstall, () => modelManager.cancelInstall())
  ipcMain.handle(VOICE_CHANNELS.removeModel, () => modelManager.remove())
}
