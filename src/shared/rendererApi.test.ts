/**
 * Tests for createRendererApi — the table-driven renderer API generator.
 *
 * Key regression: createRendererApi must return a plain object (not a Proxy)
 * so that consumers can spread it ({ ...invokeApi, onStatusChanged }).
 * A Proxy with an empty target would lose all methods when spread,
 * causing "api.git.getStatus is not a function" at runtime.
 *
 * See: git.ts line 50 — `export const git: GitApi = { ...invokeApi, onStatusChanged }`
 */
import { describe, it, expect } from 'vitest'
import { defineChannels } from './channelMap'
import { createRendererApi } from './rendererApi'
import type { ChannelNamespace } from './channelMap'

// ── Test fixture: minimal channel map mirroring gitChannels ──────────────

const testChannels = defineChannels({
  isRepo: { req: [] as unknown as [cwd: string], res: null as unknown as boolean },
  getStatus: { req: [] as unknown as [cwd: string], res: null as unknown as { isRepo: boolean } | null },
  getBranches: { req: [] as unknown as [cwd: string], res: null as unknown as string[] },
  getLog: { req: [] as unknown as [cwd: string, count?: number], res: null as unknown as string[] },
})

type TestChannelMap = typeof testChannels
type TestRendererApi = import('./channelMap').DeriveRendererApi<TestChannelMap>

// ── Tests ─────────────────────────────────────────────────────────────────

describe('createRendererApi', () => {
  describe('spread compatibility (regression: Proxy loses methods)', () => {
    it('returned object has own properties enumerable by Object.keys', () => {
      const api = createRendererApi(testChannels, 'git', null, {
        isRepo: () => false,
        getStatus: () => null,
        getBranches: () => [],
        getLog: () => [],
      })
      const keys = Object.keys(api)
      expect(keys).toContain('isRepo')
      expect(keys).toContain('getStatus')
      expect(keys).toContain('getBranches')
      expect(keys).toContain('getLog')
    })

    it('methods survive object spread ({ ...api, extra })', () => {
      const api = createRendererApi(testChannels, 'git', null, {
        isRepo: () => false,
        getStatus: () => null,
        getBranches: () => [],
        getLog: () => [],
      })
      const merged = { ...api, onStatusChanged: () => () => {} }
      expect(typeof merged.isRepo).toBe('function')
      expect(typeof merged.getStatus).toBe('function')
      expect(typeof merged.getBranches).toBe('function')
      expect(typeof merged.getLog).toBe('function')
      expect(typeof merged.onStatusChanged).toBe('function')
    })

    it('spread result methods are callable', async () => {
      const api = createRendererApi(testChannels, 'git', null, {
        isRepo: () => false,
        getStatus: () => null,
        getBranches: () => [] as string[],
        getLog: () => [] as string[],
      })
      const merged = { ...api, onStatusChanged: () => () => {} }
      // These would throw "is not a function" if spread lost the methods
      await expect(merged.isRepo('/test')).resolves.toBe(false)
      await expect(merged.getStatus('/test')).resolves.toBeNull()
      await expect(merged.getBranches('/test')).resolves.toEqual([])
      await expect(merged.getLog('/test')).resolves.toEqual([])
    })
  })

  describe('forwarding to electronAPI', () => {
    it('delegates to electronAPI[namespace][method]', async () => {
      const mockElectronAPI = {
        git: {
          isRepo: (cwd: string) => Promise.resolve(cwd === '/repo'),
          getStatus: (cwd: string) => Promise.resolve({ isRepo: true, cwd }),
          getBranches: (cwd: string) => Promise.resolve(['main', 'dev']),
          getLog: (cwd: string, count?: number) =>
            Promise.resolve([`${cwd}:${count ?? 50}`]),
        },
      }
      const api = createRendererApi(
        testChannels,
        'git',
        mockElectronAPI as unknown as Record<string, Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined> | undefined>,
        {
          isRepo: () => false,
          getStatus: () => null,
          getBranches: () => [],
          getLog: () => [],
        },
      )
      await expect(api.isRepo('/repo')).resolves.toBe(true)
      await expect(api.isRepo('/other')).resolves.toBe(false)
      await expect(api.getStatus('/repo')).resolves.toEqual({ isRepo: true, cwd: '/repo' })
      await expect(api.getBranches('/repo')).resolves.toEqual(['main', 'dev'])
      await expect(api.getLog('/repo', 10)).resolves.toEqual(['/repo:10'])
    })

    it('passes all arguments through', async () => {
      let lastArgs: unknown[] = []
      const mockElectronAPI = {
        git: {
          isRepo: (...args: unknown[]) => { lastArgs = args; return Promise.resolve(true) },
          getStatus: (...args: unknown[]) => { lastArgs = args; return Promise.resolve(null) },
          getBranches: (...args: unknown[]) => { lastArgs = args; return Promise.resolve([]) },
          getLog: (...args: unknown[]) => { lastArgs = args; return Promise.resolve([]) },
        },
      }
      const api = createRendererApi(
        testChannels,
        'git',
        mockElectronAPI as unknown as Record<string, Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined> | undefined>,
        {
          isRepo: () => false,
          getStatus: () => null,
          getBranches: () => [],
          getLog: () => [],
        },
      )
      await api.isRepo('/cwd')
      expect(lastArgs).toEqual(['/cwd'])
      await api.getLog('/cwd', 25)
      expect(lastArgs).toEqual(['/cwd', 25])
    })
  })

  describe('fallback defaults when electronAPI is null', () => {
    const api = createRendererApi(testChannels, 'git', null, {
      isRepo: () => false,
      getStatus: () => null,
      getBranches: () => [],
      getLog: () => [],
    })

    it('returns default for isRepo', async () => {
      await expect(api.isRepo('/test')).resolves.toBe(false)
    })
    it('returns default for getStatus', async () => {
      await expect(api.getStatus('/test')).resolves.toBeNull()
    })
    it('returns default for getBranches', async () => {
      await expect(api.getBranches('/test')).resolves.toEqual([])
    })
    it('returns default for getLog', async () => {
      await expect(api.getLog('/test')).resolves.toEqual([])
    })
  })

  describe('fallback when namespace exists but method is undefined', () => {
    it('falls back to default when method is missing on namespace', async () => {
      const mockElectronAPI = {
        git: {
          // isRepo is present, others are missing
          isRepo: () => Promise.resolve(true),
        },
      }
      const api = createRendererApi(
        testChannels,
        'git',
        mockElectronAPI as unknown as Record<string, Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined> | undefined>,
        {
          isRepo: () => false,
          getStatus: () => null,
          getBranches: () => [],
          getLog: () => [],
        },
      )
      await expect(api.isRepo('/test')).resolves.toBe(true)
      await expect(api.getStatus('/test')).resolves.toBeNull()
      await expect(api.getBranches('/test')).resolves.toEqual([])
    })
  })
})
