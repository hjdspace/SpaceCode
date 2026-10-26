/**
 * Skill Manager V2 — 内置（bundled）技能
 *
 * 技能正文随构建生成（`scripts/genui-skill-build.mts`），与渲染端版本同源；这里只负责把它
 * seed 进中心库并铺到 Agent。口径见 `docs/adr/0016-genui-skill-single-source-two-targets.md`
 * 与 `docs/prd/genui-cards.md` §6。
 *
 * 本模块不 import 构建脚本：那份模块带着 `genPrompt` 与 240KB 物料元数据，进主进程 bundle
 * 毫无道理。两份 `GENUI_SKILL_ID` / `BUNDLED_SKILLS_RESOURCE_DIR` 的一致性由
 * `tests/genui-skill-artifact.test.ts` 钉住。
 */

import * as fs from 'fs'
import * as path from 'path'

import type { Db } from './db'

/** 生成式 UI 技能 id —— 同时是资源目录名、中心库目录名与 frontmatter 的 `name`。 */
export const GENUI_SKILL_ID = 'genui-card'

/** 随应用发布的内置技能资源目录：打包后 `<resources>/builtin-skills`。 */
export const BUNDLED_SKILLS_RESOURCE_DIR = 'builtin-skills'

/**
 * 一份技能装到哪些 Agent。
 * 正文只有一份：两个引擎读同一份 SKILL.md，差异只在安装目录（ADR 0016）。
 */
export type BundledSkillSpec = {
  skillId: string
  targetAgentIds: string[]
}

export const BUNDLED_SKILLS: readonly BundledSkillSpec[] = [
  { skillId: GENUI_SKILL_ID, targetAgentIds: ['claude-code', 'pi'] },
]

/**
 * 内置技能资源根：打包形态取 `process.resourcesPath/builtin-skills`，开发期从应用路径回推
 * 仓库的 `resources/builtin-skills`。判据是「目录在不在」而不是 `app.isPackaged`：
 * 开发期 `process.resourcesPath` 指向 Electron 自己的 dist，那里没有这份资源，自然落到开发分支。
 *
 * 开发期的 `app.getAppPath()` 有两种形态：vite dev 下是仓库根，测试/旧启动方式下可能是
 * `dist-electron`。两种都要能回推到同一份 `resources/builtin-skills`，否则 seed 会静默跳过。
 *
 * 两个入参由调用方给出（`process.resourcesPath` 与 `app.getAppPath()`）而不是在本模块 import
 * `electron`：中心库这条依赖链上没有 Electron，加上就会把主进程测试全数拖进 mock；
 * 而「按 cwd 猜仓库根」会让跑在仓库里的测试顺带 seed 到真技能，hermetic 就没了。
 */
export function bundledSkillsRoot(options: { resourcesPath?: string; appPath?: string }): string {
  const packaged = options.resourcesPath
    ? path.join(options.resourcesPath, BUNDLED_SKILLS_RESOURCE_DIR)
    : ''
  if (packaged && fs.existsSync(packaged)) return packaged

  const devCandidates = options.appPath
    ? [
        // vite dev：appPath 就是仓库根
        path.join(options.appPath, 'resources', BUNDLED_SKILLS_RESOURCE_DIR),
        // 测试/旧启动方式：appPath 是 <repo>/dist-electron
        path.resolve(options.appPath, '..', 'resources', BUNDLED_SKILLS_RESOURCE_DIR),
      ]
    : []
  const dev = devCandidates.find((candidate) => fs.existsSync(candidate))
  if (dev) return dev

  // 都不存在时返回更符合当前形态的那个，让上层按缺失跳过（不猜、不静默换目录）
  return packaged || devCandidates[0] || ''
}

/** 每个内置技能记一条：seed 过的内置版本 + 已经铺过的 Agent。 */
export type BundledSeedRecord = {
  version: string
  targets: string[]
}

export type BundledSeedState = Record<string, BundledSeedRecord>

/** 中心库里被用户删掉的技能不该在下次启动复活，所以 seed 记录必须比 skills 表活得久。 */
const SEED_STATE_KEY = 'bundled_skills'

export function readBundledSeedState(db: Db): BundledSeedState {
  const row = db.conn.prepare('SELECT value FROM settings WHERE key = ?').get(SEED_STATE_KEY) as
    | { value: string }
    | undefined
  if (!row) return {}
  try {
    return JSON.parse(row.value) as BundledSeedState
  } catch {
    return {}
  }
}

export function writeBundledSeedState(db: Db, state: BundledSeedState): void {
  db.conn
    .prepare(
      `INSERT INTO settings(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(SEED_STATE_KEY, JSON.stringify(state))
}

/** 内置技能在中心库里的来源标记：与安装路径无关，跨机器可比。 */
export function bundledSourceUri(skillId: string): string {
  return `${BUNDLED_SKILLS_RESOURCE_DIR}/${skillId}`
}
