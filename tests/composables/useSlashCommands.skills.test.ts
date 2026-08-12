import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMock = vi.hoisted(() => ({
  getSkills: vi.fn(),
  getBundledSkills: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    skills: apiMock,
  },
}))

import { useSlashCommands } from '@/composables/useSlashCommands'

describe('useSlashCommands skill loading', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    apiMock.getSkills.mockReset().mockResolvedValue({ skills: [] })
    apiMock.getBundledSkills.mockReset().mockResolvedValue({ skills: [] })
  })

  it('refreshes skills with the current working directory whenever the menu opens', async () => {
    const slashCommands = useSlashCommands({ workingDirectory: () => 'D:\\project' })

    await slashCommands.triggerSlashMenu('')
    slashCommands.closeSlashCommandMenu()
    await slashCommands.triggerSlashMenu('newly-installed')

    expect(apiMock.getSkills).toHaveBeenCalledTimes(2)
    expect(apiMock.getSkills).toHaveBeenNthCalledWith(1, 'D:\\project')
    expect(apiMock.getSkills).toHaveBeenNthCalledWith(2, 'D:\\project')
  })
})
