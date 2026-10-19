// @vitest-environment node
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/**
 * scripts/gen-bundle-excludes.cjs 是 build.files 的守卫：它把「运行时必需依赖」和
 * 「打包白名单/裁剪规则」写死在自己的常量里，再拿 package.json 的 dependencies 与
 * build.files 逐项对比，两边的漂移只打在 stdout/stderr 上（退出码始终 0）。
 *
 * 这个对比曾经是单向失效的 —— 升级 pi 时只改了 package.json，脚本还留着旧 scope，
 * 于是它一边报「缺依赖」一边把旧 scope 的规则当成正确答案；跑一次 --fix 就会把
 * build.files 覆盖成不再匹配任何文件的死规则，打包产物里的 bundled pi 直接消失，
 * 而这条路径没有任何类型检查或单测能拦住。本测试把脚本 CLI 的全部输出钉成
 * 「两边一致」：✅ 必须在，报错文案必须不在。
 */

const REPO_ROOT = path.resolve(__dirname, '../..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'gen-bundle-excludes.cjs')

/** 成功路径下 stdout 与 stderr 拼成一份 —— 报错文案走 warn/error，只看 stdout 会漏。 */
function runValidator(): string {
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' })
  expect(result.status, '守卫脚本以非 0 退出').toBe(0)
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

describe('打包依赖守卫脚本与 package.json 同步', () => {
  it('报告 dependencies 与 build.files 都没有漂移', () => {
    const out = runValidator()
    expect(out).toContain('✅ dependencies 只含运行时必需包')
    expect(out).toContain('✅ build.files 规则正确')
    expect(out).not.toContain('dependencies 缺少运行时必需包')
    expect(out).not.toContain('build.files 缺少必要规则')
    expect(out).not.toContain('build.files 有多余规则')
  })
})
