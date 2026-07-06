import { describe, it, expect, beforeEach, vi } from 'vitest'

let progressCallback: ((progress: { downloaded: number; total: number; percent: number }) => void) | null = null

vi.mock('@/services/electronAPI', () => ({
  api: {
    rtk: {
      onDownloadProgress: vi.fn((callback) => {
        progressCallback = callback
        return () => { progressCallback = null }
      }),
    },
  },
}))

describe('useRtkDownloadState', () => {
  beforeEach(async () => {
    vi.resetModules()
    progressCallback = null
    vi.clearAllMocks()
  })

  async function useRtkDownloadState() {
    const { useRtkDownloadState } = await import('../useRtkDownloadState')
    return useRtkDownloadState()
  }

  it('进度事件触发时 downloading 为 true，完成时（percent = 100）置为 false', async () => {
    const { downloading, downloadPercent } = await useRtkDownloadState()

    expect(downloading.value).toBe(false)
    expect(downloadPercent.value).toBe(0)

    progressCallback!({ downloaded: 100, total: 1000, percent: 10 })
    expect(downloading.value).toBe(true)
    expect(downloadPercent.value).toBe(10)

    progressCallback!({ downloaded: 1000, total: 1000, percent: 100 })
    expect(downloading.value).toBe(false)
    expect(downloadPercent.value).toBe(100)
  })
})
