/**
 * Voice Input renderer API — generated from the shared voice channel map.
 */
import { voiceNamespace } from '@/shared/channels/voice'
import type {
  VoiceCancelResult,
  VoiceEventApi,
  VoiceInstallResult,
  VoiceModelInstallInfo,
  VoiceModelStatus,
  VoiceRemoveResult,
  VoiceRendererApi,
} from '@/shared/channels/voice'
import { createEventApi, createRendererApi } from '@/shared/rendererApi'
import type { AnyElectronAPI } from '@/shared/rendererApi'
import { electronAPI } from './_context'

function missingStatus(): VoiceModelStatus {
  return {
    state: 'missing',
    version: null,
    installedBytes: 0,
    diskUsageBytes: 0,
    partialBytes: 0,
    archiveBytes: 0,
    archiveReady: false,
    installedTotalBytes: 0,
    installedAt: null,
  }
}

const invokeApi = createRendererApi(
  voiceNamespace.channels,
  'voice',
  electronAPI as unknown as AnyElectronAPI,
  {
    getModelStatus: missingStatus,
    getInstallInfo: (): VoiceModelInstallInfo => ({
      version: '',
      archiveBytes: 0,
      installedBytes: 0,
      archiveName: '',
      sources: [],
    }),
    installModel: (): VoiceInstallResult => ({
      success: false,
      error: 'Voice API not available',
      errorCode: 'file-system',
      status: missingStatus(),
    }),
    cancelInstall: (): VoiceCancelResult => ({ success: false, error: 'Voice API not available' }),
    removeModel: (): VoiceRemoveResult => ({
      success: false,
      error: 'Voice API not available',
      errorCode: 'file-system',
      status: missingStatus(),
    }),
  },
)

const eventApi = createEventApi(voiceNamespace.events, 'voice', electronAPI as unknown as AnyElectronAPI)

export const voice: VoiceRendererApi & VoiceEventApi = {
  ...invokeApi,
  ...eventApi,
}
