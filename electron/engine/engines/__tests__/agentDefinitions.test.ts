// @vitest-environment node
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * issue #46：两个引擎的 agent 名单必须来自各自真实能用的定义文件，而不是硬编码的一条。
 * 扫描口径在这里收口，ClaudeCodeEngine 与 PiEngine 各自只决定「扫哪些目录」。
 *
 * homeDir / piAgentDir 走参数注入而不是就地读环境变量：函数内 require(os) 会绕过
 * vi.mock，而把模块级读取挪进参数后，测试可以真起临时目录来验行为。
 */

import {
  discoverAgentDefinitions,
  findAgentDefinition,
  type AgentDiscoveryOptions,
} from '../agentDefinitions'

const PERSONA = 'You are a security auditor. Report findings with file paths.'

let root: string
let cwd: string
let homeDir: string
let piAgentDir: string

function writeAgent(dir: string, file: string, frontmatter: string, body: string): string {
  fs.mkdirSync(dir, { recursive: true })
  const full = path.join(dir, file)
  fs.writeFileSync(full, frontmatter ? `---\n${frontmatter}\n---\n\n${body}` : body, 'utf8')
  return full
}

beforeEach(() => {
  // realpath：Windows 的 tmpdir 常是 8.3 短名，路径比对会整体错位
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-defs-')))
  cwd = path.join(root, 'project')
  homeDir = path.join(root, 'home')
  piAgentDir = path.join(homeDir, '.pi', 'agent')
  fs.mkdirSync(cwd, { recursive: true })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('discoverAgentDefinitions', () => {
  it('reads project and user .claude agents for the claude kind', () => {
    writeAgent(path.join(cwd, '.claude', 'agents'), 'reviewer.md', 'name: reviewer\ndescription: Diff reviewer', PERSONA)
    writeAgent(path.join(homeDir, '.claude', 'agents'), 'writer.md', 'name: writer', 'Rewrite prose.')

    const found = discoverAgentDefinitions({ kinds: ['claude'], cwd, homeDir })

    expect(found.map(a => a.agentType)).toEqual(['reviewer', 'writer'])
    expect(found[0].source).toBe('project')
    expect(found[0].description).toBe('Diff reviewer')
    expect(found[1].source).toBe('user')
  })

  it('adds pi native dirs for the pi kind', () => {
    writeAgent(path.join(cwd, '.pi', 'agents'), 'scout.md', 'name: scout\ndescription: Read-only scout', 'Scout the repo.')
    writeAgent(path.join(piAgentDir, 'agents'), 'global-pi.md', 'name: global-pi', 'Global pi persona.')

    const found = discoverAgentDefinitions({ kinds: ['pi'], cwd, homeDir, piAgentDir })

    expect(found.map(a => a.agentType)).toEqual(['scout', 'global-pi'])
    expect(found.map(a => a.source)).toEqual(['project', 'user'])
  })

  it('drops a pi-native name before the same name from .claude at the same scope', () => {
    const piFile = writeAgent(path.join(cwd, '.pi', 'agents'), 'reviewer.md', 'name: reviewer', 'Pi wins.')
    writeAgent(path.join(cwd, '.claude', 'agents'), 'reviewer.md', 'name: reviewer', 'Claude copy.')

    const found = discoverAgentDefinitions({ kinds: ['claude', 'pi'], cwd, homeDir, piAgentDir })

    expect(found).toHaveLength(1)
    expect(found[0].file).toBe(piFile)
  })

  it('keeps a project name ahead of a user name even across kinds', () => {
    writeAgent(path.join(homeDir, '.pi', 'agent', 'agents'), 'reviewer.md', 'name: reviewer', 'User pi copy.')
    writeAgent(path.join(cwd, '.claude', 'agents'), 'reviewer.md', 'name: reviewer', 'Project claude copy.')

    const found = discoverAgentDefinitions({ kinds: ['claude', 'pi'], cwd, homeDir, piAgentDir })

    expect(found).toHaveLength(1)
    expect(found[0].source).toBe('project')
    expect(found[0].body).toBe('Project claude copy.')
  })

  it('falls back to the filename when frontmatter has no name', () => {
    writeAgent(path.join(cwd, '.claude', 'agents'), 'auditor.md', 'description: From filename', 'Body.')

    // Pi 侧两种方言都扫，命名规则跟着 pi 的扩展：`name` 缺省就用文件名
    const found = discoverAgentDefinitions({ kinds: ['claude', 'pi'], cwd, homeDir, piAgentDir })

    expect(found.map(a => a.agentType)).toEqual(['auditor'])
  })

  it('keeps requiring a frontmatter name on the claude side', () => {
    writeAgent(path.join(cwd, '.claude', 'agents'), 'auditor.md', 'description: No name key', 'Body.')
    writeAgent(path.join(cwd, '.claude', 'agents'), 'named.md', 'name: named', 'Body.')

    const found = discoverAgentDefinitions({ kinds: ['claude'], cwd, homeDir })

    // Claude 历来只认 frontmatter 的 name：列进去就等于把一个 `--agent` 不认的名字交给用户点
    expect(found.map(a => a.agentType)).toEqual(['named'])
  })

  it('carries model and color through for the selector', () => {
    writeAgent(path.join(cwd, '.claude', 'agents'), 'planner.md', 'name: planner\nmodel: haiku\ncolor: purple', 'Body.')

    const found = discoverAgentDefinitions({ kinds: ['claude'], cwd, homeDir })

    expect(found[0].model).toBe('haiku')
    expect(found[0].color).toBe('purple')
  })

  it('strips frontmatter so the persona body is what gets injected', () => {
    writeAgent(path.join(cwd, '.claude', 'agents'), 'reviewer.md', 'name: reviewer\ndescription: d', PERSONA)

    const found = discoverAgentDefinitions({ kinds: ['claude'], cwd, homeDir })

    expect(found[0].body).toBe(PERSONA)
    expect(found[0].body).not.toContain('frontmatter')
  })

  it('uses the whole file as the persona when there is no frontmatter', () => {
    fs.mkdirSync(path.join(cwd, '.pi', 'agents'), { recursive: true })
    fs.writeFileSync(path.join(cwd, '.pi', 'agents', 'plain.md'), 'Just a persona, no frontmatter at all.', 'utf8')

    const found = discoverAgentDefinitions({ kinds: ['pi'], cwd, homeDir, piAgentDir })

    expect(found[0].agentType).toBe('plain')
    expect(found[0].body).toBe('Just a persona, no frontmatter at all.')
  })

  it('skips a pi-native definition disabled in frontmatter', () => {
    writeAgent(path.join(cwd, '.pi', 'agents'), 'off.md', 'name: off\ndescription: off\nenabled: false', PERSONA)
    writeAgent(path.join(cwd, '.pi', 'agents'), 'on.md', 'name: on', 'On.')

    const found = discoverAgentDefinitions({ kinds: ['pi'], cwd, homeDir, piAgentDir })

    expect(found.map(a => a.agentType)).toEqual(['on'])
  })

  it('treats unquoted YAML false variants as disabled and a quoted string as enabled', () => {
    writeAgent(path.join(cwd, '.pi', 'agents'), 'lower.md', 'name: lower\nenabled: False', 'Body.')
    writeAgent(path.join(cwd, '.pi', 'agents'), 'upper.md', 'name: upper\nenabled: FALSE', 'Body.')
    writeAgent(path.join(cwd, '.pi', 'agents'), 'quoted.md', 'name: quoted\nenabled: "false"', 'Body.')

    const found = discoverAgentDefinitions({ kinds: ['pi'], cwd, homeDir, piAgentDir })

    // "false" 在 YAML 里是字符串，pi 侧 fm.enabled !== false 同样视为启用
    expect(found.map(a => a.agentType)).toEqual(['quoted'])
  })

  it('keeps a disabled pi name from being taken over by lower-priority definitions', () => {
    writeAgent(path.join(cwd, '.pi', 'agents'), 'reviewer.md', 'name: reviewer\nenabled: false', 'Disabled project copy.')
    writeAgent(path.join(cwd, '.claude', 'agents'), 'reviewer.md', 'name: reviewer', 'Claude copy.')
    writeAgent(path.join(piAgentDir, 'agents'), 'reviewer.md', 'name: reviewer', 'Enabled user copy.')

    const found = discoverAgentDefinitions({ kinds: ['claude', 'pi'], cwd, homeDir, piAgentDir })

    // 扩展按优先级覆盖后拒绝派发 reviewer；宿主要展示同一个结论，不能换成别的同名文件
    expect(found).toEqual([])
  })

  it('does not apply the pi enabled flag to .claude definitions', () => {
    writeAgent(path.join(cwd, '.claude', 'agents'), 'reviewer.md', 'name: reviewer\nenabled: false', PERSONA)

    const claude = discoverAgentDefinitions({ kinds: ['claude'], cwd, homeDir })
    const pi = discoverAgentDefinitions({ kinds: ['claude', 'pi'], cwd, homeDir, piAgentDir })

    expect(claude.map(a => a.agentType)).toEqual(['reviewer'])
    expect(pi.map(a => a.agentType)).toEqual(['reviewer'])
  })

  it('skips a pi name containing a colon, like the extension', () => {
    writeAgent(path.join(cwd, '.pi', 'agents'), 'scoped.md', 'name: plugin:reviewer', 'Body.')
    writeAgent(path.join(cwd, '.pi', 'agents'), 'plain.md', 'name: plain', 'Body.')
    writeAgent(path.join(cwd, '.claude', 'agents'), 'scoped.md', 'name: claude:reviewer', 'Body.')

    const pi = discoverAgentDefinitions({ kinds: ['pi'], cwd, homeDir, piAgentDir })
    const claude = discoverAgentDefinitions({ kinds: ['claude'], cwd, homeDir })

    expect(pi.map(a => a.agentType)).toEqual(['plain'])
    expect(claude.map(a => a.agentType)).toEqual(['claude:reviewer'])
  })

  it('reads BOM-prefixed frontmatter the same way the pi extension does', () => {
    const dir = path.join(cwd, '.pi', 'agents')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'bom-off.md'),
      `\uFEFF---\nname: bom-off\ndescription: off\nenabled: false\n---\n\n${PERSONA}`,
      'utf8',
    )
    fs.writeFileSync(
      path.join(dir, 'bom-on.md'),
      `\uFEFF---\nname: bom-on\ndescription: on\n---\n\n${PERSONA}`,
      'utf8',
    )

    const found = discoverAgentDefinitions({ kinds: ['pi'], cwd, homeDir, piAgentDir })

    expect(found.map(a => a.agentType)).toEqual(['bom-on'])
    expect(found[0].description).toBe('on')
    expect(found[0].body).toBe(PERSONA)
  })

  it('skips unreadable and non-markdown entries instead of failing the scan', () => {
    const dir = path.join(cwd, '.claude', 'agents')
    writeAgent(dir, 'good.md', 'name: good', 'Body.')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not an agent', 'utf8')
    fs.mkdirSync(path.join(dir, 'subdir.md'), { recursive: true })

    const found = discoverAgentDefinitions({ kinds: ['claude'], cwd, homeDir })

    expect(found.map(a => a.agentType)).toEqual(['good'])
  })

  it('returns nothing when no directory exists', () => {
    const opts: AgentDiscoveryOptions = { kinds: ['claude', 'pi'], cwd, homeDir, piAgentDir }
    expect(discoverAgentDefinitions(opts)).toEqual([])
  })

  it('ignores a missing cwd and still reports user agents', () => {
    writeAgent(path.join(homeDir, '.claude', 'agents'), 'writer.md', 'name: writer', 'Body.')

    const found = discoverAgentDefinitions({ kinds: ['claude'], cwd: path.join(root, 'nope'), homeDir })

    expect(found.map(a => a.agentType)).toEqual(['writer'])
  })
})

describe('findAgentDefinition', () => {
  beforeEach(() => {
    writeAgent(path.join(cwd, '.claude', 'agents'), 'reviewer.md', 'name: reviewer', PERSONA)
    writeAgent(path.join(cwd, '.pi', 'agents'), 'scout.md', 'name: scout', 'Scout the repo.')
  })

  it('resolves a name from either scanned kind', () => {
    const opts: AgentDiscoveryOptions = { kinds: ['claude', 'pi'], cwd, homeDir, piAgentDir }

    expect(findAgentDefinition('reviewer', opts)?.body).toBe(PERSONA)
    expect(findAgentDefinition('scout', opts)?.body).toBe('Scout the repo.')
  })

  it('returns null for a name nothing defines', () => {
    const opts: AgentDiscoveryOptions = { kinds: ['claude', 'pi'], cwd, homeDir, piAgentDir }

    expect(findAgentDefinition('nope', opts)).toBeNull()
    expect(findAgentDefinition('', opts)).toBeNull()
  })

  it('returns null for a pi definition disabled in frontmatter', () => {
    writeAgent(path.join(cwd, '.pi', 'agents'), 'off.md', 'name: off\nenabled: false', 'Off.')

    const opts: AgentDiscoveryOptions = { kinds: ['pi'], cwd, homeDir, piAgentDir }

    expect(findAgentDefinition('off', opts)).toBeNull()
  })

  it('does not invent a definition for an extension built-in', () => {
    const opts: AgentDiscoveryOptions = { kinds: ['claude', 'pi'], cwd, homeDir, piAgentDir }

    // 这三个只活在 @tintinweb/pi-subagents 的代码里，没有可注入的 md 正文
    expect(findAgentDefinition('general-purpose', opts)).toBeNull()
    expect(findAgentDefinition('Explore', opts)).toBeNull()
    expect(findAgentDefinition('Plan', opts)).toBeNull()
  })
})
