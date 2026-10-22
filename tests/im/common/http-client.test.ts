import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'
import { tmpdir } from 'os'
import { HttpClient, HttpError } from '@electron/im/adapters/common/http-client'
import type { ProjectInfo } from '@electron/im/adapters/common/http-client'

const BASE_URL = 'https://im.example.com'

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }
}

function errorResponse(status: number, bodyText: string) {
  return { ok: false, status, text: async () => bodyText }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function lastCall(): [string, Record<string, unknown>?] {
  const calls = fetchMock.mock.calls
  return calls[calls.length - 1] as [string, Record<string, unknown>?]
}

describe('HttpClient', () => {
  describe('matchProject', () => {
    // A platform-correct absolute path — the matcher compares strings, never
    // the filesystem, so nothing here needs to exist.
    const root = path.resolve(tmpdir(), 'im-http-client-root')
    const projects: ProjectInfo[] = [
      { name: 'Alpha', path: '/work/alpha' },
      { name: 'beta', path: '/work/beta', realPath: '/home/me/beta' },
      { name: 'Gamma', path: '/work/gamma' },
    ]

    it('returns null for an empty or blank query', () => {
      const client = new HttpClient({ baseUrl: BASE_URL })

      expect(client.matchProject('', projects)).toBeNull()
      expect(client.matchProject('   ', projects)).toBeNull()
    })

    it('denies every absolute path when no allowed roots are configured', () => {
      const client = new HttpClient({ baseUrl: BASE_URL })

      expect(client.matchProject(path.join(root, 'repo'), [])).toBeNull()
    })

    it('accepts an absolute path inside an allowed root', () => {
      const client = new HttpClient({ baseUrl: BASE_URL, allowedProjectRoots: [root] })
      const inside = path.join(root, 'repo')

      expect(client.matchProject(inside, projects)).toEqual({ name: 'repo', path: inside })
    })

    it('accepts the allowed root itself', () => {
      const client = new HttpClient({ baseUrl: BASE_URL, allowedProjectRoots: [root] })

      expect(client.matchProject(root, projects)).toEqual({
        name: path.basename(root),
        path: root,
      })
    })

    it('rejects a sibling directory that merely shares the root string prefix', () => {
      const client = new HttpClient({ baseUrl: BASE_URL, allowedProjectRoots: [root] })

      expect(client.matchProject(root + '-sibling', projects)).toBeNull()
    })

    it('rejects an absolute path outside every allowed root', () => {
      const client = new HttpClient({ baseUrl: BASE_URL, allowedProjectRoots: [root] })

      expect(client.matchProject(path.resolve(tmpdir(), 'elsewhere'), projects)).toBeNull()
    })

    it('resolves a 1-based index into the project list', () => {
      const client = new HttpClient({ baseUrl: BASE_URL })

      expect(client.matchProject('1', projects)).toEqual(projects[0])
      expect(client.matchProject(' 3 ', projects)).toEqual(projects[2])
    })

    it('ignores zero, negative and out-of-range indexes and falls through to name matching', () => {
      const client = new HttpClient({ baseUrl: BASE_URL })

      expect(client.matchProject('0', projects)).toBeNull()
      expect(client.matchProject('-1', projects)).toBeNull()
      expect(client.matchProject('9', projects)).toBeNull()
    })

    it('matches a project name case-insensitively and by exact name first', () => {
      const client = new HttpClient({ baseUrl: BASE_URL })

      expect(client.matchProject('BETA', projects)).toEqual(projects[1])
      expect(client.matchProject('gamma', projects)).toEqual(projects[2])
    })

    it('returns the single fuzzy match across name, realPath and path', () => {
      const client = new HttpClient({ baseUrl: BASE_URL })

      expect(client.matchProject('bet', projects)).toEqual(projects[1])
      expect(client.matchProject('me/beta', projects)).toEqual(projects[1])
      expect(client.matchProject('work/gamma', projects)).toEqual(projects[2])
    })

    it("reports 'ambiguous' when several projects fuzzy-match", () => {
      const client = new HttpClient({ baseUrl: BASE_URL })

      expect(client.matchProject('a', projects)).toBe('ambiguous')
    })

    it('returns null when nothing matches', () => {
      const client = new HttpClient({ baseUrl: BASE_URL })

      expect(client.matchProject('zzz', projects)).toBeNull()
    })
  })

  describe('request plumbing', () => {
    it('strips a trailing slash from the baseUrl when building URLs', async () => {
      fetchMock.mockResolvedValue(okResponse([]))
      await new HttpClient({ baseUrl: `${BASE_URL}/` }).listProviders()

      expect(lastCall()[0]).toBe(`${BASE_URL}/api/providers`)
    })

    it('posts a JSON body for createSession and returns sessionId + token', async () => {
      fetchMock.mockResolvedValue(okResponse({ sessionId: 's-1', token: 't-1' }))
      const result = await new HttpClient({ baseUrl: BASE_URL }).createSession('/work/repo')

      expect(result).toEqual({ sessionId: 's-1', token: 't-1' })
      const [url, init] = lastCall()
      expect(url).toBe(`${BASE_URL}/api/sessions`)
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(init?.body).toBe(JSON.stringify({ workDir: '/work/repo' }))
    })

    it('sends no body for GET requests', async () => {
      fetchMock.mockResolvedValue(okResponse([]))
      await new HttpClient({ baseUrl: BASE_URL }).listProviders()

      const [, init] = lastCall()
      expect(init?.method).toBe('GET')
      expect(init?.body).toBeUndefined()
    })

    it('parses a JSON response body', async () => {
      fetchMock.mockResolvedValue(okResponse({ branch: 'main' }))
      const git = await new HttpClient({ baseUrl: BASE_URL }).getGitInfo('s-1')

      expect(git).toEqual({ branch: 'main' })
      expect(lastCall()[0]).toBe(`${BASE_URL}/api/sessions/s-1/git-info`)
    })

    it('resolves to undefined for an empty (204-style) response body', async () => {
      fetchMock.mockResolvedValue(okResponse(undefined))
      const client = new HttpClient({ baseUrl: BASE_URL })

      await expect(client.activateProvider('p1')).resolves.toBeUndefined()
      const [url, init] = lastCall()
      expect(url).toBe(`${BASE_URL}/api/providers/p1/activate`)
      expect(init?.method).toBe('POST')
    })

    it('throws an HttpError carrying status and body for non-2xx responses', async () => {
      fetchMock.mockResolvedValue(errorResponse(502, 'bad gateway'))

      const err = await new HttpClient({ baseUrl: BASE_URL }).listProviders().then(
        () => null,
        (e: unknown) => e,
      )

      expect(err).toBeInstanceOf(HttpError)
      expect((err as HttpError).status).toBe(502)
      expect((err as HttpError).body).toBe('bad gateway')
      expect((err as Error).message).toBe('HTTP 502: bad gateway')
      expect((err as Error).name).toBe('HttpError')
    })

    it('falls back to an empty body when reading the error body itself fails', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => {
          throw new Error('stream gone')
        },
      })

      const err = await new HttpClient({ baseUrl: BASE_URL }).listProviders().then(
        () => null,
        (e: unknown) => e,
      )

      expect(err).toBeInstanceOf(HttpError)
      expect((err as HttpError).status).toBe(503)
      expect((err as HttpError).body).toBe('')
    })
  })

  describe('listSessions', () => {
    it('uses default pagination when no arguments are given', async () => {
      fetchMock.mockResolvedValue(okResponse([]))
      await new HttpClient({ baseUrl: BASE_URL }).listSessions()

      expect(lastCall()[0]).toBe(`${BASE_URL}/api/sessions?limit=20&offset=0`)
    })

    it('forwards explicit limit and offset', async () => {
      fetchMock.mockResolvedValue(okResponse([]))
      await new HttpClient({ baseUrl: BASE_URL }).listSessions(5, 10)

      expect(lastCall()[0]).toBe(`${BASE_URL}/api/sessions?limit=5&offset=10`)
    })
  })

  describe('listSkills', () => {
    it('URL-encodes the cwd query parameter', async () => {
      fetchMock.mockResolvedValue(okResponse([]))
      await new HttpClient({ baseUrl: BASE_URL }).listSkills('/work/my repo')

      expect(lastCall()[0]).toBe(
        `${BASE_URL}/api/skills?cwd=${encodeURIComponent('/work/my repo')}`,
      )
    })
  })

  describe('read-only passthroughs', () => {
    it('lists recent projects', async () => {
      fetchMock.mockResolvedValue(okResponse([{ name: 'p', path: '/p' }]))
      const projects = await new HttpClient({ baseUrl: BASE_URL }).listRecentProjects()

      expect(projects).toEqual([{ name: 'p', path: '/p' }])
      expect(lastCall()[0]).toBe(`${BASE_URL}/api/sessions/recent-projects`)
    })

    it('lists models', async () => {
      fetchMock.mockResolvedValue(okResponse([{ id: 'm1', name: 'Model 1', provider: 'p' }]))
      const models = await new HttpClient({ baseUrl: BASE_URL }).listModels()

      expect(models).toEqual([{ id: 'm1', name: 'Model 1', provider: 'p' }])
      expect(lastCall()[0]).toBe(`${BASE_URL}/api/models`)
    })

    it('sets the current model via PUT', async () => {
      fetchMock.mockResolvedValue(okResponse(undefined))
      await new HttpClient({ baseUrl: BASE_URL }).setModel('m1')

      const [url, init] = lastCall()
      expect(url).toBe(`${BASE_URL}/api/models/current`)
      expect(init?.method).toBe('PUT')
      expect(init?.body).toBe(JSON.stringify({ modelId: 'm1' }))
    })

    it('fetches task counts for a session', async () => {
      fetchMock.mockResolvedValue(okResponse({ todo: 2, done: 1 }))
      const counts = await new HttpClient({ baseUrl: BASE_URL }).getTaskCounts('s-1')

      expect(counts).toEqual({ todo: 2, done: 1 })
      expect(lastCall()[0]).toBe(`${BASE_URL}/api/tasks/lists/s-1`)
    })
  })

  describe('sessionExists', () => {
    it('returns true when the session endpoint answers', async () => {
      fetchMock.mockResolvedValue(okResponse({ sessionId: 's-1' }))

      expect(await new HttpClient({ baseUrl: BASE_URL }).sessionExists('s-1')).toBe(true)
    })

    it('maps a 404 to false instead of throwing', async () => {
      fetchMock.mockResolvedValue(errorResponse(404, 'nope'))

      expect(await new HttpClient({ baseUrl: BASE_URL }).sessionExists('s-1')).toBe(false)
    })

    it('rethrows non-404 HttpErrors', async () => {
      fetchMock.mockResolvedValue(errorResponse(500, 'boom'))

      await expect(new HttpClient({ baseUrl: BASE_URL }).sessionExists('s-1')).rejects.toThrow(
        'HTTP 500: boom',
      )
    })

    it('rethrows network failures untouched', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(new HttpClient({ baseUrl: BASE_URL }).sessionExists('s-1')).rejects.toThrow(
        'ECONNREFUSED',
      )
    })
  })

  describe('timeout', () => {
    it('aborts a hanging request once timeoutMs elapses', async () => {
      vi.useFakeTimers()
      try {
        fetchMock.mockImplementation(
          (_url: unknown, init?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
            }),
        )
        const client = new HttpClient({ baseUrl: BASE_URL, timeoutMs: 1000 })
        const pending = client.listProviders()
        const assertion = expect(pending).rejects.toThrow('aborted')

        await vi.advanceTimersByTimeAsync(1000)
        expect(vi.getTimerCount()).toBe(0)
        await assertion
      } finally {
        vi.useRealTimers()
      }
    })

    it('defaults to a 30s timeout when timeoutMs is omitted', async () => {
      vi.useFakeTimers()
      try {
        fetchMock.mockImplementation(
          (_url: unknown, init?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
            }),
        )
        const client = new HttpClient({ baseUrl: BASE_URL })
        const pending = client.listProviders()
        const assertion = expect(pending).rejects.toThrow('aborted')

        await vi.advanceTimersByTimeAsync(29_999)
        expect(vi.getTimerCount()).toBe(1)
        await vi.advanceTimersByTimeAsync(1)
        await assertion
      } finally {
        vi.useRealTimers()
      }
    })

    it('clears the timer once the response settles, so no late abort can fire', async () => {
      vi.useFakeTimers()
      try {
        fetchMock.mockResolvedValue(okResponse([]))
        const client = new HttpClient({ baseUrl: BASE_URL, timeoutMs: 1000 })

        await client.listProviders()
        expect(vi.getTimerCount()).toBe(0)
        await vi.advanceTimersByTimeAsync(5000)
        expect(fetchMock).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
