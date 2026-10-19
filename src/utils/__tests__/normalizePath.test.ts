// @vitest-environment node
/**
 * normalizeAbsolutePath 的归一化边界。为什么要归一化：见模块头注释 —— 历史
 * JSONL 里的坏路径（如 `D:\\AI\SpaceCode`）会让侧边栏分组重复、"打开文件夹"失败。
 */
import { describe, it, expect } from 'vitest'
import { normalizeAbsolutePath } from '@/utils/normalizePath'

describe('normalizeAbsolutePath', () => {
  it('空输入与纯空白原样/去空白返回', () => {
    expect(normalizeAbsolutePath('')).toBe('')
    expect(normalizeAbsolutePath('   ')).toBe('')
  })

  it('POSIX 绝对路径：保持正斜杠，折叠重复分隔符，去尾部分隔符', () => {
    expect(normalizeAbsolutePath('/work//a/b/')).toBe('/work/a/b')
    expect(normalizeAbsolutePath('/work/a/b')).toBe('/work/a/b')
  })

  it('POSIX 根路径折叠后不会变成空串', () => {
    expect(normalizeAbsolutePath('/')).toBe('/')
    expect(normalizeAbsolutePath('////')).toBe('/')
  })

  it('Windows 盘符路径：统一为反斜杠', () => {
    expect(normalizeAbsolutePath('D:/AI/SpaceCode')).toBe('D:\\AI\\SpaceCode')
    expect(normalizeAbsolutePath('D:\\AI\\SpaceCode')).toBe('D:\\AI\\SpaceCode')
  })

  it('折叠历史坏路径里的重复分隔符（模块头注释的原始案例）', () => {
    expect(normalizeAbsolutePath('D:\\\\AI\\SpaceCode')).toBe('D:\\AI\\SpaceCode')
    expect(normalizeAbsolutePath('C:\\\\a\\\\\\b')).toBe('C:\\a\\b')
  })

  it('保留盘符根的最小形式 D:\\，但去掉更深路径的尾部分隔符', () => {
    expect(normalizeAbsolutePath('D:/')).toBe('D:\\')
    expect(normalizeAbsolutePath('D:\\')).toBe('D:\\')
    expect(normalizeAbsolutePath('D:\\foo\\')).toBe('D:\\foo')
  })

  it('UNC：仅反斜杠形式 \\server 走 UNC 分支保留前导双反斜杠', () => {
    expect(normalizeAbsolutePath('\\\\server\\\\share')).toBe('\\\\server\\share')
  })

  it('正斜杠开头的 //host 被当作 POSIX 路径折叠（不进 UNC 分支）', () => {
    expect(normalizeAbsolutePath('//server/share/dir')).toBe('/server/share/dir')
  })

  it('首尾空白先裁剪再归一化', () => {
    expect(normalizeAbsolutePath('  D:/AI/SpaceCode  ')).toBe('D:\\AI\\SpaceCode')
  })
})
