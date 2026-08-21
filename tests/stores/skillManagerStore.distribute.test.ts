import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { DistributionPreview } from '@/types/skillManagerV2'

const apiMocks = vi.hoisted(() => ({
  skillManagerV2: {
    previewDistribute: vi.fn(),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))

import { useSkillManagerStore } from '@/stores/skillManagerStore'

const preview: DistributionPreview = {
  changes: [
    {
      skillId: 'skill-1',
      skillName: 'ask-matt',
      agentId: 'codex',
      agentName: 'Codex',
      action: 'create',
      mode: 'link',
      reason: null,
    },
  ],
  blockers: [],
}

describe('skillManagerStore distribution IPC payloads', () => {
  it('passes plain ID arrays when previewing a distribution', async () => {
    setActivePinia(createPinia())
    apiMocks.skillManagerV2.previewDistribute.mockResolvedValue(preview)

    const store = useSkillManagerStore()
    const skillIds = reactive(['skill-1'])
    const targetAgentIds = reactive(['codex'])

    await store.previewDistribute(skillIds, targetAgentIds, 'link')

    expect(apiMocks.skillManagerV2.previewDistribute).toHaveBeenCalledWith(
      ['skill-1'],
      ['codex'],
      'link',
    )
  })
})
