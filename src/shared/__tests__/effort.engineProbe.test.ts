// @vitest-environment node
/**
 * 把 effort.ts 里硬编码的两套引擎词汇表钉在**真实二进制**上。
 *
 * 这两个集合是抄来的，抄来的东西会随引擎升级腐烂 —— 而腐烂的代价不对称：内部引擎对不认的
 * `--effort` 值抛 InvalidArgumentError 直接 exit 1，用户看到的是"引擎进程异常"，不会有人
 * 联想到一张档位表。所以这里不测代码自洽，测代码跟引擎是否还说同一句话。
 *
 * 探针刻意用 `--version` 收尾：参数校验发生在任何 API 调用之前，因此零凭据消耗，也不会真的
 * 起一个会话。产物缺席（没跑过 engine:build:desktop / 没装 CLI）就跳过对应那一格，不编造结论。
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUNDLED_ENGINE_EFFORT_LEVELS, INSTALLED_ENGINE_EFFORT_LEVELS } from '../effort.ts'

const bunWin = fileURLToPath(new URL('../../../engine/bin/bun.exe', import.meta.url))
const bunUnix = fileURLToPath(new URL('../../../engine/bin/bun', import.meta.url))
const bundledCli = fileURLToPath(new URL('../../../engine/dist-desktop/cli.js', import.meta.url))
const BUN = existsSync(bunWin) ? bunWin : bunUnix

/** commander 抛错与 CLI 警告是两种句式，都认；解析不出来返回 null 让调用方跳过或报警。 */
function parseAcceptedLevels(output: string): string[] | null {
  const match = output.match(/(?:It must be one of|Valid values):\s*([a-z,\s]+?)\.?\s*(?:\n|$)/i)
  if (!match) return null
  return match[1].split(',').map((v) => v.trim()).filter(Boolean)
}

/** 拿一个非法档位去撞引擎，把它自己承认的词表读回来。 */
function probeAcceptedLevels(cmd: string[], timeoutMs = 60_000): string[] | null {
  const r = spawnSync(cmd[0], [...cmd.slice(1), '--effort', 'definitely-not-a-level', '--version'], {
    encoding: 'utf-8',
    timeout: timeoutMs,
  })
  if (r.error) return null
  return parseAcceptedLevels(`${r.stdout ?? ''}\n${r.stderr ?? ''}`)
}

/**
 * 安装版 CLI 的候选路径。`where`/`which` 的第一条往往是 npm 生成的 /bin/sh 包装脚本，
 * Windows 上 spawnSync 跑不动它，`.cmd` 又只是转发器 —— 与其猜后缀，不如逐个问二进制
 * 本身：谁真能答出词表，谁就是探针对象。答不出来就跳过，不拿一个跑不起来的东西当"通过"。
 */
function installedCliCandidates(): string[] {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const r = spawnSync(finder, ['claude'], { encoding: 'utf-8', timeout: 20_000 })
  const lines = r.status === 0 ? String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : []
  return [...new Set([...lines, ...lines.flatMap(nativeTargetsOfShim)])]
}

/**
 * npm 的 `.cmd` 启动器把真正的 exe 写在正文里（`"%dp0%\node_modules\...\bin\claude.exe" %*`），
 * 不在同目录下 —— 所以照 electron/session 里 resolveCmdShimTarget 的同一手法把它读出来，
 * 而不是猜一个包路径。
 */
function nativeTargetsOfShim(shimPath: string): string[] {
  if (!/\.cmd$/i.test(shimPath) || !existsSync(shimPath)) return []
  const body = readFileSync(shimPath, 'utf8')
  return [...body.matchAll(/%~?dp0%?\\([^"]+?\.exe)/gi)]
    .map((m) => resolve(dirname(shimPath), m[1].replace(/^\\+/, '')))
    .filter((p) => existsSync(p))
}

const HAS_BUNDLE = existsSync(BUN) && existsSync(bundledCli)

/** 第一个真能答出词表的候选；全答不出返回 null，对应那一格跳过。 */
function probeInstalledCli(): { path: string; levels: string[] } | null {
  for (const candidate of installedCliCandidates()) {
    const levels = probeAcceptedLevels([candidate])
    if (levels) return { path: candidate, levels }
  }
  return null
}

const INSTALLED = probeInstalledCli()

describe('引擎 --effort 词汇表对账', () => {
  it.skipIf(!HAS_BUNDLE)('内部引擎 bundle 实际接受的就是 BUNDLED_ENGINE_EFFORT_LEVELS', () => {
    const accepted = probeAcceptedLevels([BUN, 'run', bundledCli])
    // guards the guard: 句式改了这里就是 null，而不是静默地"没有差异"
    expect(accepted, '无法从引擎输出解析词表，报错文案可能改了').not.toBeNull()
    expect(accepted).toEqual([...BUNDLED_ENGINE_EFFORT_LEVELS])
  })

  it.skipIf(!INSTALLED)('安装版 CLI 实际接受的就是 INSTALLED_ENGINE_EFFORT_LEVELS', () => {
    // INSTALLED 为 null 意味着没有任何候选答得出词表 —— 那时这一格是 skipped 而不是通过，
    // 别把它当成"已核对过"。
    expect(INSTALLED!.levels).toEqual([...INSTALLED_ENGINE_EFFORT_LEVELS])
  })

  it('两维不是一维：xhigh 只在安装版词表里，这条差异就是那次崩溃的全部成因', () => {
    expect(BUNDLED_ENGINE_EFFORT_LEVELS).not.toContain('xhigh')
    expect(INSTALLED_ENGINE_EFFORT_LEVELS).toContain('xhigh')
  })
})
