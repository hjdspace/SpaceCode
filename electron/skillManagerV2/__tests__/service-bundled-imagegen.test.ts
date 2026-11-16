// @vitest-environment node
/**
 * 生图技能的免安装分发（#108）：读仓库真实的内置资源根，断言启动后中心库与
 * 两个引擎的技能目录里都有它。缝是 SkillManagerService.bootstrap()，
 * 与 service-bundled-skills.test.ts 同口径 —— 那份用 fixture 钉语义，这份钉随包的那份正文。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { fileURLToPath } from 'url'

import { SkillManagerService } from '../service'
import { setHomeOverride } from '../fsutil'
import { bundledSkillsRoot } from '../bundledSkills'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SKILL_ID = 'imagegen'

let tmpDir: string
let homeDir: string
let centerPath: string
let dbPath: string
let service: SkillManagerService | null

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-bundled-imagegen-'))
  homeDir = path.join(tmpDir, 'home')
  centerPath = path.join(tmpDir, 'center')
  dbPath = path.join(tmpDir, 'skill-manager', 'test.db')
  fs.mkdirSync(homeDir, { recursive: true })
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.PI_CODING_AGENT_DIR
  setHomeOverride(homeDir)
  service = null
})

afterEach(() => {
  service?.close()
  service = null
  setHomeOverride(null)
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.PI_CODING_AGENT_DIR
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function boot(): SkillManagerService {
  const next = SkillManagerService.bootstrap(
    dbPath,
    centerPath,
    bundledSkillsRoot({ appPath: path.join(repoRoot, 'dist-electron') }),
  )
  service = next
  return next
}

describe('生图技能随包分发', () => {
  it('首次启动就进中心库并标记 bundled 来源', () => {
    const svc = boot()
    const found = svc.listCenterSkills().find(skill => skill.id === SKILL_ID)
    expect(found?.sourceType).toBe('bundled')
    expect(fs.readFileSync(path.join(centerPath, SKILL_ID, 'SKILL.md'), 'utf-8')).toContain('generate_image')
  })

  it('Claude Code 与 Pi 的技能目录里各有一份，用户什么都不用装', () => {
    const svc = boot()
    const detail = svc.getSkillDetail(SKILL_ID)
    expect(detail?.targets.map(target => target.agentId).sort()).toEqual(['claude-code', 'pi'])
    for (const target of [
      path.join(homeDir, '.claude', 'skills', SKILL_ID, 'SKILL.md'),
      path.join(homeDir, '.pi', 'agent', 'skills', SKILL_ID, 'SKILL.md'),
    ]) {
      expect(fs.readFileSync(target, 'utf-8')).toContain('mcp__spacecode-imagegen__generate_image')
    }
  })

  it('参考文档跟着正文一起铺过去', () => {
    boot()
    expect(fs.existsSync(path.join(centerPath, SKILL_ID, 'references', 'prompting.md'))).toBe(true)
    expect(fs.existsSync(path.join(homeDir, '.claude', 'skills', SKILL_ID, 'references', 'sample-prompts.md'))).toBe(true)
  })
})