// @vitest-environment node
/**
 * 票 08 第 4、6 条：Pi 1.3.0 的技能扫描器是否跟随符号链接、技能是否出现在可用技能列表，
 * 以及自定义 system prompt 下技能清单是否仍然可见。
 *
 * 判据直接取 pi 自己的 `loadSkills` / `formatSkillsForPrompt` / `buildSystemPromptSections`，
 * 不手抄一套目录规则：上游升级把 symlink 扫描改坏时，这里先红，再决定该 Target 是否退 copy。
 * 技能源是随包发布的真实 `genui-card`，顺带验证它的 frontmatter 过得了 pi 的校验。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { fileURLToPath } from 'url'
import {
  loadSkills,
  formatSkillsForPrompt,
  getAgentDir,
  DefaultResourceLoader,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
// 未从包根导出：这是 pi 组装 system prompt 的同一份实现，用来钉住「自定义 prompt 不影响 skills 段」
import { buildSystemPromptSections } from '../../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js'

import { GENUI_SKILL_ID } from '../bundledSkills'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const bundledSkillDir = path.join(repoRoot, 'resources', 'builtin-skills', GENUI_SKILL_ID)

let tmpDir: string
let projectDir: string
let agentDir: string
let previousAgentDir: string | undefined
let previousHome: string | undefined

/** 按 `link` 安装：Windows 无 symlink 权限时用 junction（Node 与 pi 都把它当 symlink 分支）。 */
function linkDir(target: string, linkPath: string): void {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true })
  try {
    fs.symlinkSync(target, linkPath, 'dir')
  } catch (e) {
    if (process.platform !== 'win32') throw e
    fs.symlinkSync(target, linkPath, 'junction')
  }
}

function loadPiSkills() {
  // agentDir 走 pi 自己的 getAgentDir()：它读 PI_CODING_AGENT_DIR
  const agentDirFromPi = getAgentDir()
  expect(agentDirFromPi).toBe(agentDir)
  return loadSkills({ cwd: projectDir, agentDir: agentDirFromPi, skillPaths: [], includeDefaults: true })
}

/** 真实会话的发现层：package-manager 扫 agentDir/skills，再交给 loadSkills。 */
async function loadViaResourceLoader() {
  // 临时 cwd 在用户 home 之下，祖先 .agents/skills 会被 project-trust 扫描到；
  // 关掉信任只留 agentDir 这一路，避免测试受真实用户目录影响。
  const settingsManager = SettingsManager.create(projectDir, agentDir)
  settingsManager.setProjectTrusted(false)
  const loader = new DefaultResourceLoader({
    cwd: projectDir,
    agentDir,
    settingsManager,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  })
  await loader.reload()
  return loader.getSkills()
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skill-visible-'))
  projectDir = path.join(tmpDir, 'project')
  agentDir = path.join(tmpDir, 'home', '.pi', 'agent')
  fs.mkdirSync(projectDir, { recursive: true })
  fs.mkdirSync(path.join(agentDir, 'skills'), { recursive: true })
  previousAgentDir = process.env.PI_CODING_AGENT_DIR
  previousHome = process.env.HOME
  process.env.PI_CODING_AGENT_DIR = agentDir
  // package-manager 还会扫 $HOME/.agents/skills；指到临时 home，避免真实用户目录混进清单
  process.env.HOME = path.join(tmpDir, 'home')
})

afterEach(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('Pi 1.3.0 的技能扫描器', () => {
  it('跟随链接安装：技能进入清单，正文可按清单里的路径读取', () => {
    const linkPath = path.join(agentDir, 'skills', GENUI_SKILL_ID)
    linkDir(bundledSkillDir, linkPath)

    const { skills, diagnostics } = loadPiSkills()

    expect(diagnostics.filter((d) => d.type === 'warning')).toEqual([])
    const skill = skills.find((s) => s.name === GENUI_SKILL_ID)
    expect(skill).toBeDefined()
    // 扫描结果保留链接路径本身，正文通过它可读
    expect(skill!.filePath).toBe(path.join(linkPath, 'SKILL.md'))
    expect(fs.readFileSync(skill!.filePath, 'utf-8')).toContain('schemaJson')

    const listing = formatSkillsForPrompt(skills)
    expect(listing).toContain(`<name>${GENUI_SKILL_ID}</name>`)
    expect(listing).toContain(`<location>${skill!.filePath}</location>`)
  })

  it('copy 安装同样进入清单（link 不可用时的退路）', () => {
    const copyPath = path.join(agentDir, 'skills', GENUI_SKILL_ID)
    fs.cpSync(bundledSkillDir, copyPath, { recursive: true })

    const { skills } = loadPiSkills()

    const skill = skills.find((s) => s.name === GENUI_SKILL_ID)
    expect(skill).toBeDefined()
    expect(skill!.filePath).toBe(path.join(copyPath, 'SKILL.md'))
    expect(fs.readFileSync(skill!.filePath, 'utf-8')).toContain('schemaJson')
  })

  it('真实会话的资源加载器（package-manager 扫描）也跟随链接', async () => {
    linkDir(bundledSkillDir, path.join(agentDir, 'skills', GENUI_SKILL_ID))

    const { skills, diagnostics } = await loadViaResourceLoader()

    expect(diagnostics.filter((d) => d.type === 'warning')).toEqual([])
    const skill = skills.find((s) => s.name === GENUI_SKILL_ID)
    expect(skill).toBeDefined()
    expect(fs.readFileSync(skill!.filePath, 'utf-8')).toContain('schemaJson')
  })

  it('自定义 system prompt（含 append）下技能段仍然追加', () => {
    linkDir(bundledSkillDir, path.join(agentDir, 'skills', GENUI_SKILL_ID))
    const { skills } = loadPiSkills()

    const sections = buildSystemPromptSections({
      customPrompt: '你是 SpaceCode 的助手',
      appendSystemPrompt: '人设补充',
      cwd: projectDir,
      skills,
    })

    expect(sections.preamble).toBe('你是 SpaceCode 的助手')
    expect(sections.skills).toContain(`<name>${GENUI_SKILL_ID}</name>`)
    expect(sections.skills).toContain('<location>')
    expect(sections.addendum).toContain('人设补充')
  })
})
