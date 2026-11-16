/**
 * Todo renderer API — generated from the shared todo channel map.
 *
 * 主进程不可用时（浏览器里跑单测、H5 壳）返回「空表 + not-found」而不是抛错，
 * 待办面板照常渲染空态，不会把整个界面拖崩。
 */
import { todoNamespace } from '@/shared/channels/todo'
import type {
  TodoEventApi,
  TodoMutation,
  TodoRemoveResult,
  TodoRendererApi,
  TodoSyncActionResult,
  TodoSyncState,
} from '@/shared/channels/todo'
import { createEventApi, createRendererApi } from '@/shared/rendererApi'
import type { AnyElectronAPI } from '@/shared/rendererApi'
import { electronAPI } from './_context'

function unavailableSyncState(): TodoSyncState {
  return {
    supported: false,
    permission: 'unsupported',
    config: { enabled: false, listId: null },
    lists: [],
    conflicts: [],
    syncing: false,
    lastError: 'unsupported-platform',
  }
}

function unavailableSyncResult(): TodoSyncActionResult {
  return { ok: false, error: 'unsupported-platform', state: unavailableSyncState() }
}

function unavailableMutation(): TodoMutation {
  return { ok: false, reason: 'not-found' }
}

const invokeApi = createRendererApi(
  todoNamespace.channels,
  'todo',
  electronAPI as unknown as AnyElectronAPI,
  {
    list: () => [],
    get: () => null,
    create: unavailableMutation,
    update: unavailableMutation,
    remove: (): TodoRemoveResult => ({ ok: false, reason: 'not-found' }),
    restore: unavailableMutation,
    bulkStatus: () => [],
    bulkRemove: () => [],
    reorder: () => [],
    touchSession: () => null,
    listGroups: () => [],
    createGroup: () => ({ ok: false as const, reason: 'invalid-name' as const }),
    renameGroup: () => ({ ok: false as const, reason: 'not-found' as const }),
    removeGroup: () => ({ ok: false }),
    listActiveReminders: () => [],
    acknowledgeReminder: () => ({ ok: false }),
    snoozeReminder: () => ({ ok: false }),
    getSyncState: unavailableSyncState,
    requestSyncAccess: unavailableSyncResult,
    setSyncConfig: unavailableSyncResult,
    syncNow: unavailableSyncResult,
    resolveSyncConflict: unavailableSyncResult,
  },
)

const eventApi = createEventApi(todoNamespace.events, 'todo', electronAPI as unknown as AnyElectronAPI)

export const todo: TodoRendererApi & TodoEventApi = {
  ...invokeApi,
  ...eventApi,
}