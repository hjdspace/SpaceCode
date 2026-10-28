// @vitest-environment node
/**
 * GitHub 鉴权错误分类：无效 token / 无仓库权限 / 网络必须能被区分，
 * 因为向导要给出不同的修复动作（换 token、改 Repository access、重试）。
 */
import { describe, it, expect, vi } from 'vitest'
import { checkGhAuth, verifyGithubToken, type GithubFetch } from '../github'

function response(status: number, body: unknown) {
  return { status, json: async () => body }
}

describe('verifyGithubToken', () => {
  it('returns login/private/repo on success', async () => {
    const fetchImpl = vi.fn<GithubFetch>()
      .mockResolvedValueOnce(response(200, { login: 'hjdspace' }))
      .mockResolvedValueOnce(response(200, { full_name: 'hjdspace/SpaceCode', private: true }))
    const result = await verifyGithubToken('ghp_x', 'hjdspace/SpaceCode', fetchImpl)
    expect(result).toMatchObject({ ok: true, reason: 'ok', login: 'hjdspace', private: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toContain('/user')
  })

  it('classifies 401 as invalid-token and stops before repo lookup', async () => {
    const fetchImpl = vi.fn<GithubFetch>().mockResolvedValueOnce(response(401, { message: 'Bad credentials' }))
    const result = await verifyGithubToken('bad', 'hjdspace/SpaceCode', fetchImpl)
    expect(result).toMatchObject({ ok: false, reason: 'invalid-token' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('classifies 404 on the repo as repo-permission', async () => {
    const fetchImpl = vi.fn<GithubFetch>()
      .mockResolvedValueOnce(response(200, { login: 'hjdspace' }))
      .mockResolvedValueOnce(response(404, { message: 'Not Found' }))
    const result = await verifyGithubToken('ghp_x', 'hjdspace/private', fetchImpl)
    expect(result).toMatchObject({ ok: false, reason: 'repo-permission' })
  })

  it('classifies thrown requests as network', async () => {
    const fetchImpl = vi.fn<GithubFetch>().mockRejectedValueOnce(new Error('ENOTFOUND'))
    const result = await verifyGithubToken('ghp_x', 'hjdspace/SpaceCode', fetchImpl)
    expect(result).toMatchObject({ ok: false, reason: 'network' })
  })

  it('rejects empty tokens without touching the network', async () => {
    const fetchImpl = vi.fn<GithubFetch>()
    const result = await verifyGithubToken('  ', 'hjdspace/SpaceCode', fetchImpl)
    expect(result).toMatchObject({ ok: false, reason: 'invalid-token' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('checkGhAuth', () => {
  it('reports ok when gh exits zero', async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: 'Logged in to github.com as hjdspace' }))
    expect(await checkGhAuth(run)).toMatchObject({ ok: true, reason: 'ok' })
    expect(run).toHaveBeenCalledWith(['auth', 'status'])
  })

  it('reports gh-not-logged-in for a non-zero exit', async () => {
    const run = vi.fn(async () => ({ code: 1, stdout: 'not logged in' }))
    expect(await checkGhAuth(run)).toMatchObject({ ok: false, reason: 'gh-not-logged-in' })
  })

  it('treats a missing gh binary as not logged in', async () => {
    const run = vi.fn(async () => ({ code: 'ENOENT' as unknown as number, stdout: '' }))
    expect(await checkGhAuth(run)).toMatchObject({ ok: false, reason: 'gh-not-logged-in' })
  })
})
