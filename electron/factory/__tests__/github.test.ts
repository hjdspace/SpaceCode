// @vitest-environment node
/**
 * GitHub 鉴权错误分类：无效 token / 无仓库权限 / 网络必须能被区分，
 * 因为向导要给出不同的修复动作（换 token、改 Repository access、重试）。
 */
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import type { ChildProcess } from 'child_process'
import { checkGhAuth, listGithubRepos, startGhWebLogin, verifyGithubToken, type GithubFetch } from '../github'

function response(status: number, body: unknown) {
  return { status, json: async () => body }
}

describe('verifyGithubToken', () => {
  it('returns login/private/repo on success', async () => {
    const fetchImpl = vi.fn<GithubFetch>()
      .mockResolvedValueOnce(response(200, { login: 'hjdspace' }))
      .mockResolvedValueOnce(response(200, { full_name: 'hjdspace/SpaceCode', private: true }))
    const result = await verifyGithubToken('ghp_x', 'hjdspace/SpaceCode', { fetch: fetchImpl })
    expect(result).toMatchObject({ ok: true, reason: 'ok', login: 'hjdspace', private: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toContain('/user')
  })

  it('classifies 401 as invalid-token and stops before repo lookup', async () => {
    const fetchImpl = vi.fn<GithubFetch>().mockResolvedValueOnce(response(401, { message: 'Bad credentials' }))
    const result = await verifyGithubToken('bad', 'hjdspace/SpaceCode', { fetch: fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'invalid-token' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('verifies a token without a repository so the repo list can drive selection', async () => {
    const fetchImpl = vi.fn<GithubFetch>().mockResolvedValueOnce(response(200, { login: 'hjdspace' }))
    await expect(verifyGithubToken('ghp_x', '', { fetch: fetchImpl })).resolves.toMatchObject({
      ok: true,
      reason: 'ok',
      login: 'hjdspace',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('classifies 404 on the repo as repo-permission', async () => {
    const fetchImpl = vi.fn<GithubFetch>()
      .mockResolvedValueOnce(response(200, { login: 'hjdspace' }))
      .mockResolvedValueOnce(response(404, { message: 'Not Found' }))
    const result = await verifyGithubToken('ghp_x', 'hjdspace/private', { fetch: fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'repo-permission', status: 404 })
  })

  it('keeps the HTTP status so the wizard can explain 401/403/404', async () => {
    const fetchImpl = vi.fn<GithubFetch>().mockResolvedValueOnce(response(401, { message: 'Bad credentials' }))
    await expect(verifyGithubToken('bad', 'hjdspace/SpaceCode', { fetch: fetchImpl })).resolves.toMatchObject({
      ok: false,
      reason: 'invalid-token',
      status: 401,
    })
  })

  it('counts open issues even when no claim label is given', async () => {
    const fetchImpl = vi.fn<GithubFetch>()
      .mockResolvedValueOnce(response(200, { login: 'hjdspace' }))
      .mockResolvedValueOnce(response(200, { full_name: 'hjdspace/SpaceCode', private: true }))
      .mockResolvedValueOnce(response(200, { total_count: 12 }))
    const result = await verifyGithubToken('ghp_x', 'hjdspace/SpaceCode', { counts: true, fetch: fetchImpl })
    expect(result).toMatchObject({ ok: true, issueCount: 12 })
    expect(result.labelCount).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('as well as the label hit count when a label is given', async () => {
    const fetchImpl = vi.fn<GithubFetch>()
      .mockResolvedValueOnce(response(200, { login: 'hjdspace' }))
      .mockResolvedValueOnce(response(200, { full_name: 'hjdspace/SpaceCode', private: true }))
      .mockResolvedValueOnce(response(200, { total_count: 12 }))
      .mockResolvedValueOnce(response(200, { total_count: 3 }))
    const result = await verifyGithubToken('ghp_x', 'hjdspace/SpaceCode', {
      counts: true,
      label: 'ready-for-agent',
      fetch: fetchImpl,
    })
    expect(result).toMatchObject({ ok: true, issueCount: 12, labelCount: 3 })
    expect(decodeURIComponent(fetchImpl.mock.calls[2][0])).toContain(
      'search/issues?q=repo:hjdspace/SpaceCode is:issue is:open',
    )
    expect(decodeURIComponent(fetchImpl.mock.calls[3][0])).toContain('label:ready-for-agent')
  })

  it('stays green when the count lookup is rate-limited', async () => {
    const fetchImpl = vi.fn<GithubFetch>()
      .mockResolvedValueOnce(response(200, { login: 'hjdspace' }))
      .mockResolvedValueOnce(response(200, { full_name: 'hjdspace/SpaceCode', private: false }))
      .mockResolvedValueOnce(response(403, { message: 'API rate limit exceeded' }))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
    const result = await verifyGithubToken('ghp_x', 'hjdspace/SpaceCode', {
      counts: true,
      label: 'ready-for-agent',
      fetch: fetchImpl,
    })
    expect(result).toMatchObject({ ok: true, reason: 'ok', repo: 'hjdspace/SpaceCode' })
    expect(result.issueCount).toBeUndefined()
    expect(result.labelCount).toBeUndefined()
  })

  it('classifies thrown requests as network', async () => {
    const fetchImpl = vi.fn<GithubFetch>().mockRejectedValueOnce(new Error('ENOTFOUND'))
    const result = await verifyGithubToken('ghp_x', 'hjdspace/SpaceCode', { fetch: fetchImpl })
    expect(result).toMatchObject({ ok: false, reason: 'network' })
  })

  it('rejects empty tokens without touching the network', async () => {
    const fetchImpl = vi.fn<GithubFetch>()
    const result = await verifyGithubToken('  ', 'hjdspace/SpaceCode', { fetch: fetchImpl })
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

interface FakeGhChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: (chunk: string) => void; written: string[] }
  kill: () => void
}

function fakeGhChild(): FakeGhChild {
  const child = new EventEmitter() as FakeGhChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  const written: string[] = []
  child.stdin = {
    written,
    write: (chunk: string) => {
      written.push(chunk)
    },
  }
  child.kill = vi.fn()
  return child
}

describe('listGithubRepos', () => {
  it('lists repos through the gh CLI with the jq projection', async () => {
    const run = vi.fn(async (_args: string[]) => ({
      code: 0,
      stdout: JSON.stringify([
        { repo: 'hjdspace/SpaceCode', name: 'SpaceCode', private: true, description: 'desktop' },
        { repo: 'acme/other', name: 'other', private: false },
      ]),
    }))
    await expect(listGithubRepos('gh', null, { run })).resolves.toEqual({
      ok: true,
      repos: [
        { repo: 'hjdspace/SpaceCode', name: 'SpaceCode', private: true, description: 'desktop' },
        { repo: 'acme/other', name: 'other', private: false },
      ],
    })
    expect(run.mock.calls[0][0].join(' ')).toContain('user/repos')
  })

  it('reports a not-logged-in gh as such', async () => {
    const run = vi.fn(async () => ({
      code: 1,
      stdout: 'To get started with GitHub CLI, please run: gh auth login',
    }))
    await expect(listGithubRepos('gh', null, { run })).resolves.toEqual({ ok: false, reason: 'not-logged-in' })
  })

  it('lists repos over REST and keeps full_name', async () => {
    const fetchImpl = vi.fn(async () =>
      response(200, [{ full_name: 'hjdspace/SpaceCode', name: 'SpaceCode', private: false }]),
    )
    await expect(listGithubRepos('token', 'ghp_x', { fetch: fetchImpl as unknown as GithubFetch })).resolves.toEqual({
      ok: true,
      repos: [{ repo: 'hjdspace/SpaceCode', name: 'SpaceCode', private: false }],
    })
  })

  it('classifies a rejected token and stays offline without a token', async () => {
    const fetchImpl = vi.fn(async () => response(401, { message: 'Bad credentials' }))
    await expect(listGithubRepos('token', 'ghp_x', { fetch: fetchImpl as unknown as GithubFetch })).resolves.toEqual({
      ok: false,
      reason: 'invalid-token',
    })
    await expect(listGithubRepos('token', '')).resolves.toEqual({ ok: false, reason: 'invalid-token' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('startGhWebLogin', () => {
  it('returns the one-time code gh prints for the browser flow', async () => {
    const child = fakeGhChild()
    const spawnImpl = vi.fn(() => child as unknown as ChildProcess)
    const pending = startGhWebLogin(spawnImpl)

    expect(spawnImpl).toHaveBeenCalledWith([
      'auth',
      'login',
      '--hostname',
      'github.com',
      '--git-protocol',
      'https',
      '--web',
    ])
    child.stderr.emit('data', '! First copy your one-time code: ABCD-1234\n')

    await expect(pending).resolves.toMatchObject({
      ok: true,
      reason: 'ok',
      code: 'ABCD-1234',
      url: 'https://github.com/login/device',
    })
  })

  it('parses the code from the non-TTY output of gh 2.x', async () => {
    const child = fakeGhChild()
    const pending = startGhWebLogin(() => child as unknown as ChildProcess)
    child.stderr.emit('data', '\n')
    child.stderr.emit(
      'data',
      '! One-time code (22BD-F4A3) copied to clipboard\n' +
        'Open this URL to continue in your web browser: https://github.com/login/device\n',
    )

    await expect(pending).resolves.toMatchObject({
      ok: true,
      reason: 'ok',
      code: '22BD-F4A3',
      url: 'https://github.com/login/device',
    })
  })

  it('answers the interactive Enter prompt so gh can open the browser', async () => {
    const child = fakeGhChild()
    const pending = startGhWebLogin(() => child as unknown as ChildProcess)
    child.stderr.emit('data', 'Press Enter to open github.com in your browser...')
    expect(child.stdin.written).toEqual(['\n'])
    child.stderr.emit('data', '! First copy your one-time code: WXYZ-9876\n')
    await pending
  })

  it('reports a short-lived gh process as a failure with its output', async () => {
    const child = fakeGhChild()
    const pending = startGhWebLogin(() => child as unknown as ChildProcess)
    child.stderr.emit('data', 'could not prompt: not a terminal')
    child.emit('exit', 1)

    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'unknown' })
    const result = await pending
    expect(result.detail).toContain('not a terminal')
  })
})
