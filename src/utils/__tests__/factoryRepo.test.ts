// @vitest-environment node
/**
 * origin 解析：向导自动回填与手填校验必须共用同一份 owner/repo 规则。
 */
import { describe, it, expect } from 'vitest'
import { isValidRepoSlug, parseRepoFromRemote } from '../factoryRepo'

describe('parseRepoFromRemote', () => {
  it.each([
    ['https://github.com/hjdspace/SpaceCode.git', 'hjdspace/SpaceCode'],
    ['https://github.com/hjdspace/SpaceCode', 'hjdspace/SpaceCode'],
    ['https://user@github.com/hjdspace/SpaceCode.git', 'hjdspace/SpaceCode'],
    ['git@github.com:hjdspace/SpaceCode.git', 'hjdspace/SpaceCode'],
    ['git@github.com:hjdspace/SpaceCode', 'hjdspace/SpaceCode'],
    ['ssh://git@github.com/hjdspace/SpaceCode.git', 'hjdspace/SpaceCode'],
    ['ssh://git@github.com:22/hjdspace/SpaceCode.git', 'hjdspace/SpaceCode'],
    ['git://github.com/hjdspace/SpaceCode.git', 'hjdspace/SpaceCode'],
    ['https://gitlab.com/group/sub/repo.git', 'sub/repo'],
  ])('parses %s', (remote, expected) => {
    expect(parseRepoFromRemote(remote)).toBe(expected)
  })

  it('returns undefined for blank, malformed or single-segment remotes', () => {
    expect(parseRepoFromRemote('')).toBeUndefined()
    expect(parseRepoFromRemote(undefined)).toBeUndefined()
    expect(parseRepoFromRemote('   ')).toBeUndefined()
    expect(parseRepoFromRemote('SpaceCode')).toBeUndefined()
    expect(parseRepoFromRemote('https://github.com/')).toBeUndefined()
  })
})

describe('isValidRepoSlug', () => {
  it('accepts owner/repo and rejects unsafe values', () => {
    expect(isValidRepoSlug('hjdspace/SpaceCode')).toBe(true)
    expect(isValidRepoSlug('owner/repo-name_1')).toBe(true)
    expect(isValidRepoSlug('owner')).toBe(false)
    expect(isValidRepoSlug('owner/')).toBe(false)
    expect(isValidRepoSlug('owner/repo/extra')).toBe(false)
    expect(isValidRepoSlug('owner/../repo')).toBe(false)
    expect(isValidRepoSlug(' owner/repo')).toBe(false)
  })
})
