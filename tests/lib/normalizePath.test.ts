import { describe, it, expect } from 'vitest'
import { normalizeAbsolutePath } from '@/utils/normalizePath'

describe('normalizeAbsolutePath — Windows 绝对路径归一化', () => {
  it('折叠盘符后的重复反斜杠（D:\\\\AI\\SpaceCode → D:\\AI\\SpaceCode）', () => {
    expect(normalizeAbsolutePath('D:\\\\AI\\SpaceCode')).toBe('D:\\AI\\SpaceCode')
  })

  it('正斜杠统一为反斜杠', () => {
    expect(normalizeAbsolutePath('D:/AI/SpaceCode')).toBe('D:\\AI\\SpaceCode')
    expect(normalizeAbsolutePath('D:\\AI/SpaceCode')).toBe('D:\\AI\\SpaceCode')
  })

  it('去除尾部冗余分隔符', () => {
    expect(normalizeAbsolutePath('D:\\AI\\SpaceCode\\')).toBe('D:\\AI\\SpaceCode')
    expect(normalizeAbsolutePath('D:\\AI\\SpaceCode\\\\')).toBe('D:\\AI\\SpaceCode')
  })

  it('保留盘符根（D:\\）', () => {
    expect(normalizeAbsolutePath('D:\\')).toBe('D:\\')
  })

  it('保留 UNC 前导双反斜杠', () => {
    expect(normalizeAbsolutePath('\\\\server\\share')).toBe('\\\\server\\share')
    expect(normalizeAbsolutePath('\\\\server\\share\\folder\\')).toBe('\\\\server\\share\\folder')
  })

  it('空字符串原样返回', () => {
    expect(normalizeAbsolutePath('')).toBe('')
  })

  it('首尾空白被去除', () => {
    expect(normalizeAbsolutePath('  D:\\AI\\SpaceCode  ')).toBe('D:\\AI\\SpaceCode')
  })

  it('POSIX 绝对路径保持正斜杠', () => {
    expect(normalizeAbsolutePath('/work/project')).toBe('/work/project')
    expect(normalizeAbsolutePath('//work//project/')).toBe('/work/project')
  })

  it('POSIX 根路径保持为 /', () => {
    expect(normalizeAbsolutePath('/')).toBe('/')
  })
})
