// @vitest-environment node
/**
 * 内置技能资源根与 seed 名单（票 07 第 4、5 条的落地前提）。
 *
 * `bundledSkillsRoot()` 是纯解析：给什么路径参数就答什么，不 import Electron、也不按 cwd 猜仓库根。
 * 这里钉住三条：打包形态优先、开发期从应用路径回推、两者都缺时不静默换目录。
 */
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

import {
  BUNDLED_SKILLS,
  BUNDLED_SKILLS_RESOURCE_DIR,
  GENUI_SKILL_ID,
  bundledSkillsRoot,
  bundledSourceUri,
} from '../bundledSkills'
import { isSkillDir } from '../fsutil'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function makeResources(): { root: string, cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'bundled-skills-root-'))
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

describe('bundledSkillsRoot', () => {
  it('打包形态优先用 resourcesPath 下那份', () => {
    const { root, cleanup } = makeResources()
    try {
      const dir = join(root, BUNDLED_SKILLS_RESOURCE_DIR)
      mkdirSync(dir, { recursive: true })
      expect(bundledSkillsRoot({ resourcesPath: root, appPath: join(root, 'resources') })).toBe(dir)
    } finally {
      cleanup()
    }
  })

  it('开发期从应用路径回推仓库的 resources 目录', () => {
    const devAppPath = join(repoRoot, 'dist-electron')
    expect(bundledSkillsRoot({ appPath: devAppPath })).toBe(
      join(repoRoot, 'resources', BUNDLED_SKILLS_RESOURCE_DIR)
    )
  })

  it('两处都没有时返回当前形态对应的那个空路径，不去猜别的地方', () => {
    const { root, cleanup } = makeResources()
    try {
      const missing = join(root, 'nope', BUNDLED_SKILLS_RESOURCE_DIR)
      expect(bundledSkillsRoot({ resourcesPath: join(root, 'nope') })).toBe(missing)
      expect(existsSync(bundledSkillsRoot({}))).toBe(false)
    } finally {
      cleanup()
    }
  })
})

describe('内置技能名单', () => {
  it('每个条目在仓库的内置资源根里都是一份有效技能', () => {
    const root = bundledSkillsRoot({ appPath: join(repoRoot, 'dist-electron') })
    for (const spec of BUNDLED_SKILLS) {
      expect(isSkillDir(join(root, spec.skillId))).toBe(true)
    }
  })

  it('生成式 UI 技能在名单里，且只铺给 Claude Code（Pi 是票 08）', () => {
    const spec = BUNDLED_SKILLS.find((s) => s.skillId === GENUI_SKILL_ID)
    expect(spec?.targetAgentIds).toEqual(['claude-code'])
  })

  it('来源标记与安装路径无关', () => {
    expect(bundledSourceUri(GENUI_SKILL_ID)).toBe(`${BUNDLED_SKILLS_RESOURCE_DIR}/${GENUI_SKILL_ID}`)
  })
})
