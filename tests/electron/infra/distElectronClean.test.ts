// @vitest-environment node
/**
 * `dist-electron/` 是 dev 与 prod 共用的输出目录：正在运行的 dev 实例会在每次导航时
 * 从磁盘读 preload.js。所以"验证型构建"（`npm run build`，AGENTS.md 要求每次改动都跑）
 * 绝不能先抹掉这个目录 —— 曾经就是这样让 dev 窗口静默失去 contextBridge。清空只允许
 * 发生在打包链里，且必须在 `build:all` 之前（否则删掉的是刚产出的新文件）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const scripts = packageJson.scripts as Record<string, string>
const localBuildScript = readFileSync(join(root, 'scripts', 'electron-build-local.cjs'), 'utf8')

// 真正自己跑构建的打包链；electron:build*:local 只是转发包装
const packagingScripts = Object.keys(scripts).filter(
  (name) => name.startsWith('electron:build') && scripts[name].includes('npm run build:all'),
)

describe('dist-electron clean scope', () => {
  it('does not wipe dist-electron as a side effect of the verification build', () => {
    assert.equal(scripts.prebuild, undefined)
    assert.doesNotMatch(scripts.build, /clean-dist-electron/)
    assert.match(scripts['clean:electron'], /scripts\/clean-dist-electron\.cjs/)
  })

  it('cleans the packaging output before rebuilding it, in every packaging chain', () => {
    assert.deepEqual(packagingScripts.sort(), [
      'electron:build',
      'electron:build:linux',
      'electron:build:mac',
      'electron:build:win',
    ])
    for (const name of packagingScripts) {
      assert.match(scripts[name], /npm run clean:electron && npm run build:all/, `${name} must clean before build`)
      assert.doesNotMatch(
        scripts[name],
        /npm run build:all && npm run clean:electron/,
        `${name} must not clean after the build wrote its output`,
      )
    }
  })

  it('routes the local packaging wrapper through those chains so it keeps the clean', () => {
    assert.match(localBuildScript, /electron:build:\$\{target\}|`electron:build:\$\{target\}`/)
  })
})
