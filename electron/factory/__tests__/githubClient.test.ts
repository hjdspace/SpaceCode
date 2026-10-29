// @vitest-environment node
/**
 * GitHub 传输层：REST 与 gh 两条路径必须把失败分类成渲染层能给出修复动作的原因，
 * 并且列表请求有分页与响应大小上限。测试注入假 HTTP / 假 gh，不触网。
 */
import { describe, it, expect, vi } from 'vitest'
import { createGhApi, createRestApi, type GithubFetch } from '../githubClient'

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    status,
    text: async () => text,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  }
}

describe('createRestApi', () => {
  it('lists open issues, skips pull requests and truncates oversized bodies', async () => {
    const fetchImpl = vi.fn<GithubFetch>().mockResolvedValueOnce(
      response(200, [
        { number: 1, title: 'one', body: 'x'.repeat(50), labels: [{ name: 'ready-for-agent' }], state: 'open' },
        { number: 2, title: 'pr', body: '', labels: [], state: 'open', pull_request: { url: 'x' } },
        { number: 3, title: 'three', body: 'b', labels: ['ready-for-agent'], state: 'open' },
      ]),
    )
    const api = createRestApi({ repo: 'hjdspace/SpaceCode', token: 'ghp_x', fetchImpl, maxBodyChars: 10 })
    const result = await api.listIssues({ label: 'ready-for-agent', limit: 10 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.map((issue) => issue.number)).toEqual([1, 3])
    expect(result.value[0].body).toBe('x'.repeat(10))
    expect(result.value[0].labels).toEqual(['ready-for-agent'])
    expect(fetchImpl.mock.calls[0][0]).toContain('/repos/hjdspace/SpaceCode/issues?')
    expect(fetchImpl.mock.calls[0][0]).toContain('labels=ready-for-agent')
  })

  it('paginates until the requested limit is reached', async () => {
    const fetchImpl = vi
      .fn<GithubFetch>()
      .mockResolvedValueOnce(response(200, [
        { number: 1, title: 'a', body: '', labels: [], state: 'open' },
        { number: 2, title: 'b', body: '', labels: [], state: 'open' },
      ]))
      .mockResolvedValueOnce(response(200, [{ number: 3, title: 'c', body: '', labels: [], state: 'open' }]))
    const api = createRestApi({ repo: 'o/r', token: 't', fetchImpl, perPage: 2 })
    const result = await api.listIssues({ limit: 3 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toHaveLength(3)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1][0]).toContain('page=2')
  })

  it.each([
    [401, { message: 'Bad credentials' }, 'invalid-token'],
    [403, { message: 'API rate limit exceeded' }, 'rate-limit'],
    [403, { message: 'Resource not accessible' }, 'repo-permission'],
    [404, { message: 'Not Found' }, 'repo-not-found'],
  ])('classifies HTTP %s', async (status, body, reason) => {
    const fetchImpl = vi.fn<GithubFetch>().mockResolvedValueOnce(response(status, body))
    const api = createRestApi({ repo: 'o/r', token: 't', fetchImpl })
    const result = await api.listIssues({ limit: 1 })
    expect(result).toMatchObject({ ok: false, reason })
  })

  it('classifies aborted requests as timeout and thrown requests as network', async () => {
    const timeoutFetch = vi.fn<GithubFetch>().mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    )
    expect(await createRestApi({ repo: 'o/r', token: 't', fetchImpl: timeoutFetch }).listIssues({ limit: 1 }))
      .toMatchObject({ ok: false, reason: 'timeout' })

    const networkFetch = vi.fn<GithubFetch>().mockRejectedValueOnce(new Error('ENOTFOUND'))
    expect(await createRestApi({ repo: 'o/r', token: 't', fetchImpl: networkFetch }).listIssues({ limit: 1 }))
      .toMatchObject({ ok: false, reason: 'network' })
  })

  it('refuses responses above the byte cap', async () => {
    const fetchImpl = vi.fn<GithubFetch>().mockResolvedValueOnce(response(200, 'x'.repeat(50)))
    const api = createRestApi({ repo: 'o/r', token: 't', fetchImpl, maxResponseBytes: 20 })
    expect(await api.listIssues({ limit: 1 })).toMatchObject({ ok: false, reason: 'response-too-large' })
  })

  it('posts comments and closes issues with the configured repo', async () => {
    const fetchImpl = vi.fn<GithubFetch>()
      .mockResolvedValueOnce(response(201, { id: 99 }))
      .mockResolvedValueOnce(response(200, { state: 'closed' }))
    const api = createRestApi({ repo: 'o/r', token: 't', fetchImpl })
    expect(await api.createComment(7, 'hello')).toMatchObject({ ok: true })
    expect(await api.closeIssue(7)).toMatchObject({ ok: true, value: { closed: true } })
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(fetchImpl.mock.calls[0][0]).toContain('/issues/7/comments')
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'PATCH' })
  })
})

describe('createGhApi', () => {
  it('lists issues via gh JSON and keeps label filtering in the args', async () => {
    const run = vi.fn(async (_args: string[]) => ({
      code: 0,
      stdout: JSON.stringify([
        {
          number: 12,
          title: 't',
          body: 'b',
          state: 'OPEN',
          url: 'u',
          labels: [{ name: 'ready-for-agent' }],
          comments: [{ body: '<!-- spacecode-factory:claim run=r1 task=issue-12 -->' }],
        },
      ]),
    }))
    const api = createGhApi({ repo: 'o/r', run })
    const result = await api.listIssues({ label: 'ready-for-agent', limit: 5 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value[0]).toMatchObject({ number: 12, labels: ['ready-for-agent'], state: 'open' })
    expect(result.value[0].comments).toHaveLength(1)
    expect(run.mock.calls[0][0]).toEqual(
      expect.arrayContaining(['issue', 'list', '--repo', 'o/r', '--label', 'ready-for-agent']),
    )
  })

  it('classifies gh auth failures and missing binaries', async () => {
    const notLogged = createGhApi({
      repo: 'o/r',
      run: vi.fn(async () => ({ code: 1, stdout: 'To get started with GitHub CLI, please run: gh auth login' })),
    })
    expect(await notLogged.listIssues({ limit: 1 })).toMatchObject({ ok: false, reason: 'not-logged-in' })

    const missing = createGhApi({ repo: 'o/r', run: vi.fn(async () => ({ code: 'ENOENT' as unknown as number, stdout: '' })) })
    expect(await missing.listIssues({ limit: 1 })).toMatchObject({ ok: false, reason: 'unsupported' })

    const forbidden = createGhApi({
      repo: 'o/r',
      run: vi.fn(async () => ({ code: 1, stdout: 'gh: Resource not accessible (HTTP 403)' })),
    })
    expect(await forbidden.listIssues({ limit: 1 })).toMatchObject({ ok: false, reason: 'repo-permission' })

    const rate = createGhApi({
      repo: 'o/r',
      run: vi.fn(async () => ({ code: 1, stdout: 'gh: API rate limit exceeded (HTTP 403)' })),
    })
    expect(await rate.listIssues({ limit: 1 })).toMatchObject({ ok: false, reason: 'rate-limit' })
  })

  it('uses execFile-style args for comments and closes without a shell', async () => {
    const run = vi.fn(async (_args: string[]) => ({ code: 0, stdout: '' }))
    const api = createGhApi({ repo: 'o/r', run })
    expect(await api.createComment(7, 'body $(rm -rf /)')).toMatchObject({ ok: true })
    expect(run.mock.calls[0][0]).toEqual(['issue', 'comment', '7', '--repo', 'o/r', '--body', 'body $(rm -rf /)'])
    expect(await api.closeIssue(7)).toMatchObject({ ok: true })
    expect(run.mock.calls[1][0]).toEqual(['issue', 'close', '7', '--repo', 'o/r'])
  })
})
