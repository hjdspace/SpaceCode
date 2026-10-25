// @vitest-environment node
/**
 * 内置（bundled）技能 seed（票 07 第 4、5、6、9 条）。
 *
 * 缝是 `SkillManagerService.bootstrap()` —— 临时中心库 + 可覆盖的 home + 指到 fixture 的
 * 内置技能资源根（口径见 `docs/prd/genui-cards.md`「技能分发（现有缝）」）。
 * 只断言外部可观察行为：中心库里多了哪个技能、来源标成什么、Agent 目录下多了哪个文件、
 * Target/Claim/hash 对不对；不读私有方法。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

import { SkillManagerService } from '../service'
import { setHomeOverride, hashDirContents } from '../fsutil'
import { GENUI_SKILL_ID, BUNDLED_SKILLS_RESOURCE_DIR } from '../bundledSkills'

let tmpDir: string
let homeDir: string
let centerPath: string
let dbPath: string
let bundledRoot: string
let service: SkillManagerService | null

const SKILL_ID = GENUI_SKILL_ID

/** 内置技能正文的版本就是它的资源目录内容 hash；升级 = 目录内容变化。 */
function bundledVersion(dir: string): string {
  return hashDirContents(dir)
}

function sourceDir(): string {
  return path.join(bundledRoot, SKILL_ID)
}

/** 写一份内置技能资源，内容可带标记，便于制造「版本变化」。 */
function writeBundledSkill(marker: string): string {
  const dir = sourceDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${SKILL_ID}\ndescription: 生成卡片 ${marker}\n---\n# body ${marker}\n`,
    'utf-8'
  )
  return dir
}

function centerSkillDir(): string {
  return path.join(centerPath, SKILL_ID)
}

function defaultClaudeTarget(): string {
  return path.join(homeDir, '.claude', 'skills', SKILL_ID)
}

function seedSkill(): { id: string; sourceType: string | null } | undefined {
  return service!.listCenterSkills().find((s) => s.id === SKILL_ID)
}

function detail() {
  return service!.getSkillDetail(SKILL_ID)
}

/** 启动一次（同一 tmp 目录里再启动就是「下次启动」）。 */
function boot(): SkillManagerService {
  const next = SkillManagerService.bootstrap(dbPath, centerPath, bundledRoot)
  service = next
  return next
}

/** 下次启动：关掉当前实例再重新 bootstrap。 */
function reboot(): SkillManagerService {
  service?.close()
  service = null
  return boot()
}

function readSkillFile(dir: string): string {
  return fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8')
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-bundled-seed-'))
  homeDir = path.join(tmpDir, 'home')
  centerPath = path.join(tmpDir, 'center')
  dbPath = path.join(tmpDir, 'skill-manager', 'test.db')
  bundledRoot = path.join(tmpDir, BUNDLED_SKILLS_RESOURCE_DIR)
  fs.mkdirSync(homeDir, { recursive: true })
  delete process.env.CLAUDE_CONFIG_DIR
  setHomeOverride(homeDir)
  writeBundledSkill('v1')
  service = null
})

afterEach(() => {
  service?.close()
  service = null
  setHomeOverride(null)
  delete process.env.CLAUDE_CONFIG_DIR
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('首次启动 seed', () => {
  it('内置技能进了中心库并标记 bundled 来源', () => {
    boot()

    expect(seedSkill()?.sourceType).toBe('bundled')
    expect(readSkillFile(centerSkillDir())).toContain('# body v1')
  })

  it('登记内置版本号：source_ref 就是资源目录的内容 hash', () => {
    boot()

    expect(detail()?.source?.sourceType).toBe('bundled')
    expect(detail()?.source?.sourceRef).toBe(bundledVersion(sourceDir()))
  })

  it('中心库那份是独立副本，不是指向应用资源的软链', () => {
    boot()

    expect(fs.lstatSync(centerSkillDir()).isSymbolicLink()).toBe(false)
  })

  it('为 Claude Code 创建 Target，安装内容与中心库一致', () => {
    boot()

    expect(detail()?.targets.map((t) => t.agentId)).toEqual(['claude-code'])
    expect(readSkillFile(defaultClaudeTarget())).toContain('# body v1')
  })

  it('Target 带 direct Claim，source_hash 取中心库当前 hash', () => {
    boot()

    const found = detail()
    const target = found?.targets[0]
    expect(target).toBeDefined()
    // 默认 link，Windows 无权限时按既有策略退 copy；两种都算铺上
    expect(['link', 'copy']).toContain(target?.actualMode)
    expect(target?.sourceHash).toBe(found?.currentHash)
    expect(found?.claims.filter((c) => c.targetId === target?.id && c.claimType === 'direct')).toHaveLength(1)
  })

  it('内置资源缺失时启动照常可用，不抛出', () => {
    service = SkillManagerService.bootstrap(dbPath, centerPath, path.join(tmpDir, 'no-such-resources'))

    expect(seedSkill()).toBeUndefined()
    expect(service.listAgents().length).toBeGreaterThan(0)
  })

  it('Agent 目录下已有同名未管理技能时不覆盖它', () => {
    fs.mkdirSync(defaultClaudeTarget(), { recursive: true })
    fs.writeFileSync(path.join(defaultClaudeTarget(), 'SKILL.md'), '---\nname: mine\n---\nuser own skill\n', 'utf-8')
    boot()

    expect(readSkillFile(defaultClaudeTarget())).toContain('user own skill')
    expect(detail()?.targets).toHaveLength(0)
  })
})

describe('重复启动与升级', () => {
  it('幂等：不重写中心库，也不重复建 Target', () => {
    boot()
    // 用户改过中心库正文，说明下次启动没有把它盖回去
    fs.writeFileSync(path.join(centerSkillDir(), 'SKILL.md'), '---\nname: edited\n---\nedited\n', 'utf-8')

    reboot()

    expect(readSkillFile(centerSkillDir())).toContain('edited')
    expect(detail()?.targets).toHaveLength(1)
    expect(detail()?.claims).toHaveLength(1)
  })

  it('内置版本变化时中心库正文被更新', () => {
    boot()
    writeBundledSkill('v2')

    reboot()

    expect(readSkillFile(centerSkillDir())).toContain('# body v2')
    expect(detail()?.source?.sourceRef).toBe(bundledVersion(sourceDir()))
  })

  it('用户删掉后不会被下次启动复活', () => {
    boot()
    service!.executeDeleteCenterSkill(SKILL_ID)

    reboot()

    expect(seedSkill()).toBeUndefined()
    expect(fs.existsSync(centerSkillDir())).toBe(false)
  })

  it('删中心库技能时一并撤销 Agent 侧的安装', () => {
    boot()
    expect(fs.existsSync(defaultClaudeTarget())).toBe(true)

    service!.executeDeleteCenterSkill(SKILL_ID)

    // 留下的副本会让下次 seed 误判成「未管理的同名技能」，升级时技能就再也回不来
    expect(fs.existsSync(defaultClaudeTarget())).toBe(false)
  })

  it('用户删掉后，内置版本升级让它重新出现并重新铺到 Claude', () => {
    boot()
    service!.executeDeleteCenterSkill(SKILL_ID)
    writeBundledSkill('v2')

    reboot()

    expect(seedSkill()?.sourceType).toBe('bundled')
    expect(detail()?.targets.map((t) => t.agentId)).toEqual(['claude-code'])
    expect(readSkillFile(defaultClaudeTarget())).toContain('# body v2')
  })

  it('只卸载 Agent 侧安装不会被下次启动重新铺上', () => {
    boot()
    service!.deleteTarget(detail()!.targets[0].id)

    reboot()

    expect(detail()?.targets).toHaveLength(0)
  })

  it('seed 记录损坏时认不出中心库那份是谁的，宁可不动它', () => {
    boot()
    fs.writeFileSync(path.join(centerSkillDir(), 'SKILL.md'), '---\nname: edited\n---\nedited\n', 'utf-8')
    service!.getDb().conn.prepare("UPDATE settings SET value = '{损坏的 JSON' WHERE key = 'bundled_skills'").run()

    reboot()

    expect(readSkillFile(centerSkillDir())).toContain('edited')
    expect(seedSkill()?.sourceType).toBe('bundled')
  })
})

describe('Claude 技能目录的环境变量覆盖', () => {
  it('CLAUDE_CONFIG_DIR 决定 seed 落到哪个 skills 目录', () => {
    const custom = path.join(tmpDir, 'claude-cfg')
    process.env.CLAUDE_CONFIG_DIR = custom

    boot()

    expect(detail()?.targets[0]?.targetPath).toBe(path.join(custom, 'skills', SKILL_ID))
    expect(fs.existsSync(path.join(custom, 'skills', SKILL_ID, 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(defaultClaudeTarget())).toBe(false)
  })

  it('CLAUDE_CONFIG_DIR 支持 ~ 前缀', () => {
    process.env.CLAUDE_CONFIG_DIR = '~/claude-tilde'

    boot()

    expect(detail()?.targets[0]?.targetPath).toBe(path.join(homeDir, 'claude-tilde', 'skills', SKILL_ID))
  })

  it('已有的 agents 表行随注册表刷新，不留在旧默认路径', () => {
    boot()
    const custom = path.join(tmpDir, 'claude-later')
    process.env.CLAUDE_CONFIG_DIR = custom

    expect(reboot().listAgents().find((a) => a.id === 'claude-code')?.skillsDir).toBe(
      path.join(custom, 'skills')
    )
  })
})
