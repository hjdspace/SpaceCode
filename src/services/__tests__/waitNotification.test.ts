import { describe, expect, it, vi } from 'vitest'
import type { PermissionRequest } from '@/services/permissionService'

const { showNotification } = vi.hoisted(() => ({ showNotification: vi.fn() }))

vi.mock('@/services/electronAPI', () => ({ api: { showNotification } }))
vi.mock('@/i18n', () => ({
  i18n: {
    global: {
      t: (key: string) => key,
      te: () => false,
    },
  },
}))

import { notifyWaitingForUser } from '../waitNotification'

describe('waiting notifications', () => {
  it('carries the session id so clicking the toast can reveal that conversation', () => {
    const request = { toolName: 'Bash', input: {}, description: 'Run tests' } as PermissionRequest

    notifyWaitingForUser('sess-1', request, {
      enabled: () => true,
      sessionTitle: () => 'Factory task',
    })

    expect(showNotification).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1' }))
  })
})
