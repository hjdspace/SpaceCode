/**
 * Voice Input IPC handlers — model management (ticket 01) and the streaming
 * recording session (ticket 02).
 *
 * Both singletons live here because they share one lifecycle: the session
 * service probes the model manager before every start, and the model manager
 * refuses removal while a session is active.
 */
import { app, ipcMain } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { channelNames, eventChannels } from '@/shared/channelMap'
import {
  VOICE_SAMPLE_RATE,
  voiceNamespace,
  type VoiceModelStatus,
  type VoicePartialPayload,
  type VoiceSessionStatePayload,
} from '@/shared/channels/voice'
import { getGuiSettingsPath } from '../ipc/settingsIpc'
import { getMainWindow } from '../windows/mainWindow'
import { SpeechModelManager } from './speechModelManager'
import { VoiceSessionService, type VoiceModelInspection } from './voiceSessionService'
import { createSherpaWorkerEngineFactory } from './sherpaWorkerEngine'

const VOICE_CHANNELS = channelNames(voiceNamespace.channels, 'voice:')
const VOICE_EVENTS = eventChannels(voiceNamespace.events, 'voice:')

let manager: SpeechModelManager | null = null
let sessionService: VoiceSessionService | null = null
let recordingProbe: () => boolean = () => false

/** Kept as a seam: the manager reads this probe on every remove(). */
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
      forward(VOICE_EVENTS.onModelProgress, progress)
    })
  }
  return manager
}

export function getVoiceSessionService(): VoiceSessionService {
  if (!sessionService) {
    const modelManager = getVoiceModelManager()
    const service = new VoiceSessionService({
      probe: {
        inspect: async () =>
          toInspection(await modelManager.getStatus(), modelManager.getPaths().modelDir),
      },
      engineFactory: createSherpaWorkerEngineFactory(),
    })
    service.on('partial', (payload: VoicePartialPayload) => forward(VOICE_EVENTS.onPartial, payload))
    service.on('state', (payload: VoiceSessionStatePayload) =>
      forward(VOICE_EVENTS.onSessionState, payload),
    )
    sessionService = service
    setVoiceRecordingProbe(() => service.isRecording())
  }
  return sessionService
}

function toInspection(status: VoiceModelStatus, modelDir: string): VoiceModelInspection {
  if (status.state === 'installed') return { state: 'installed', modelDir }
  if (status.state === 'corrupted') return { state: 'corrupted', modelDir }
  // downloading / verifying / extracting also mean "no usable model yet".
  return { state: 'missing', modelDir }
}

function forward(channel: string, payload: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function readSessionId(request: unknown): string | null {
  if (!request || typeof request !== 'object') return null
  const sessionId = (request as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
}

export function registerVoiceIPCHandlers(): void {
  const modelManager = getVoiceModelManager()
  const sessions = getVoiceSessionService()

  ipcMain.handle(VOICE_CHANNELS.getModelStatus, () => modelManager.getStatus())
  ipcMain.handle(VOICE_CHANNELS.getInstallInfo, () => modelManager.getInstallInfo())
  ipcMain.handle(VOICE_CHANNELS.installModel, () => modelManager.install())
  ipcMain.handle(VOICE_CHANNELS.cancelInstall, () => modelManager.cancelInstall())
  ipcMain.handle(VOICE_CHANNELS.removeModel, () => modelManager.remove())

  ipcMain.handle(VOICE_CHANNELS.startSession, (_event, request: unknown) => {
    const sessionId = readSessionId(request)
    if (!sessionId) {
      return { ok: false, sampleRate: VOICE_SAMPLE_RATE, error: 'Invalid session request' }
    }
    return sessions.startSession(sessionId)
  })

  ipcMain.on(VOICE_CHANNELS.sendAudio, (_event, request: unknown) => {
    const sessionId = readSessionId(request)
    if (!sessionId) return
    const pcm = (request as { pcm?: unknown }).pcm
    if (!(pcm instanceof ArrayBuffer) && !ArrayBuffer.isView(pcm)) return
    sessions.sendAudio(sessionId, pcm)
  })

  ipcMain.handle(VOICE_CHANNELS.stopSession, (_event, request: unknown) => {
    const sessionId = readSessionId(request)
    if (!sessionId) return { success: true, text: '' }
    return sessions.stopSession(sessionId)
  })

  ipcMain.handle(VOICE_CHANNELS.cancelSession, (_event, request: unknown) => {
    const sessionId = readSessionId(request)
    if (!sessionId) return { success: true }
    return sessions.cancelSession(sessionId)
  })
}
