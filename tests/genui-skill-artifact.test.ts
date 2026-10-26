// @vitest-environment node
/**
 * 生成式 UI 技能正文（票 07 第 1、2、3、7 条）。
 *
 * 两条钉住：
 * - **同源**：产物是「手写契约 + OpenTiny genPrompt 现场生成正文」拼出来的整篇文本，
 *   与当前依赖、当前渲染端常量重新生成结果逐字一致。物料或协议版本升级而技能没重新生成时，
 *   这里必须失败（口径见 `docs/prd/genui-cards.md` §6「漂移由测试钉住」）。
 * - **契约**：frontmatter 取 Claude 与 Pi 的交集，正文写明只输出 schemaJson 围栏、
 *   四个动作白名单、禁止网络/命令/文件改动，以及 SpaceCode 不接受 `Page` 根节点。
 *
 * 这里读的是仓库里提交的产物，不是临时目录 —— seed 与打包用的就是这一份。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { miniMaterialsMeta } from '@opentiny/genui-sdk-materials-vue-opentiny-vue/meta'
import { GENUI_SANDBOX_PROTOCOL_VERSION, GENUI_CARD_ACTIONS } from '@/shared/genuiSandbox'
import { GENUI_MATERIAL_WHITELIST } from '@/shared/genuiMaterials'
import {
  GENUI_SKILL_ID,
  BUNDLED_SKILLS_RESOURCE_DIR,
  GENUI_SKILL_ARTIFACT_REL_PATH,
  buildGenuiSkillMarkdown,
} from '../scripts/genui-skill-build.mts'
import {
  GENUI_SKILL_ID as ELECTRON_GENUI_SKILL_ID,
  BUNDLED_SKILLS_RESOURCE_DIR as ELECTRON_BUNDLED_SKILLS_RESOURCE_DIR,
  bundledSkillsRoot,
} from '@electron/skillManagerV2/bundledSkills'
import { parseFrontmatterText } from '@electron/skillManagerV2/fsutil'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifactPath = join(repoRoot, GENUI_SKILL_ARTIFACT_REL_PATH)
/** git 在 Windows 上会把 LF 检出成 CRLF；比对只看内容，不看行尾。 */
const artifact = readFileSync(artifactPath, 'utf-8').replace(/\r\n/g, '\n')

/** 产物头部那段机器可读的来源标记（依赖版本、协议版本、白名单、动作）。 */
function sourceMarker(text: string, key: string): string | undefined {
  return new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm').exec(text)?.[1]?.trim()
}

function installedVersion(pkg: string): string {
  return JSON.parse(readFileSync(join(repoRoot, 'node_modules', pkg, 'package.json'), 'utf-8')).version as string
}

describe('技能正文与渲染端同源', () => {
  it('重新生成的正文与提交的产物逐字一致', () => {
    expect(artifact).toBe(buildGenuiSkillMarkdown())
  })

  it('声明的 OpenTiny 依赖版本就是渲染端装的版本', () => {
    expect(sourceMarker(artifact, 'genui-sdk-core')).toBe(installedVersion('@opentiny/genui-sdk-core'))
    expect(sourceMarker(artifact, 'genui-sdk-materials')).toBe(
      installedVersion('@opentiny/genui-sdk-materials-vue-opentiny-vue'),
    )
  })

  it('声明的卡片协议版本与渲染端一致', () => {
    expect(sourceMarker(artifact, 'card-protocol-version')).toBe(String(GENUI_SANDBOX_PROTOCOL_VERSION))
  })

  it('声明的根组件白名单与渲染端物料白名单同序同项', () => {
    const listed = sourceMarker(artifact, 'root-components')?.split(',').map((s) => s.trim())
    expect(listed).toEqual([...GENUI_MATERIAL_WHITELIST])
  })

  it('声明的动作名单与宿主桥的四个动作一致', () => {
    const listed = sourceMarker(artifact, 'allowed-actions')?.split(',').map((s) => s.trim())
    expect(listed).toEqual([...GENUI_CARD_ACTIONS])
  })

  it('官方 mini 物料的 whiteList 变化时正文必然跟着变', () => {
    // 生成正文里的「可用组件」一行直接取官方元数据；这份测试把「元数据 → 正文」这条路钉住，
    // 而不是只盯手抄的名单。
    expect(miniMaterialsMeta.whiteList).toEqual([...GENUI_MATERIAL_WHITELIST])
    expect(artifact).toContain(miniMaterialsMeta.whiteList.map((n) => `\`${n}\``).join(', '))
  })
})

describe('frontmatter 取 Claude 与 Pi 的交集', () => {
  // 中心库的展示与技能清单都来自 fsutil 那份解析结果，测试不复刻实现（ADR 0011）
  const fm = parseFrontmatterText(artifact)

  it('name 是小写连字符且不超过 64', () => {
    expect(fm.get('name')).toBe(GENUI_SKILL_ID)
    expect(GENUI_SKILL_ID).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(GENUI_SKILL_ID.length).toBeLessThanOrEqual(64)
  })

  it('description 必填且不超过 1024', () => {
    const description = fm.get('description') ?? ''
    expect(description.length).toBeGreaterThan(0)
    expect(description.length).toBeLessThanOrEqual(1024)
  })

  it('description 是单行且不含会被 frontmatter 解析吃掉的引号包裹', () => {
    const description = fm.get('description') ?? ''
    expect(description).not.toMatch(/\n/)
    expect(description.startsWith('"')).toBe(false)
    expect(description.endsWith('"')).toBe(false)
  })
})

describe('主进程 seed 与生成器同源', () => {
  it('技能 id 与内置资源目录名两侧一致', () => {
    // 主进程不 import 构建脚本（那份带着 genPrompt 与物料元数据），所以这两个常量各有一份
    expect(ELECTRON_GENUI_SKILL_ID).toBe(GENUI_SKILL_ID)
    expect(ELECTRON_BUNDLED_SKILLS_RESOURCE_DIR).toBe(BUNDLED_SKILLS_RESOURCE_DIR)
  })

  it('开发期的资源根解析到这份产物所在目录', () => {
    // 开发期主进程产物在 <repo>/dist-electron，appPath 的上一层就是仓库根
    const devAppPath = join(repoRoot, 'dist-electron')
    expect(join(bundledSkillsRoot({ appPath: devAppPath }), GENUI_SKILL_ID, 'SKILL.md')).toBe(artifactPath)
  })
})

describe('正文写明的输出契约', () => {
  it('只输出 schemaJson 围栏，围栏外不写解释性散文', () => {
    expect(artifact).toContain('```schemaJson')
    expect(artifact).toContain('围栏之外')
    expect(artifact).toContain('解释性散文')
  })

  it('逐个说明四个动作的调用方式与参数', () => {
    for (const action of GENUI_CARD_ACTIONS) {
      expect(artifact).toContain(`callAction('${action}'`)
    }
    expect(artifact).toContain('callAction')
  })

  it('压掉官方示例里那两个 SpaceCode 不存在的动作名', () => {
    // 官方 Action 定义示例写的是 continueChat / saveState；不点名否认，模型会照抄过去。
    expect(artifact).toContain('continueChat')
    expect(artifact).toContain('在 SpaceCode 中不存在，调用会被宿主丢弃')
  })

  it('禁止网络、执行命令与修改文件', () => {
    expect(artifact).toContain('不得请求网络')
    expect(artifact).toContain('不得执行命令')
    expect(artifact).toContain('修改文件')
  })

  it('SpaceCode 不接受 Page 根节点，且这条压过官方描述', () => {
    expect(artifact).toContain('SpaceCode 不接受 `Page` 作为根节点')
    // 官方 JSON Schema 的字段描述与整例仍然在正文里，契约必须显式覆盖它而不是装作没有
    expect(artifact).toContain('通常为 Page')
    expect(artifact).toContain('整例')
  })

  it('点名官方示例里不能照抄进 SpaceCode 的东西', () => {
    // 示例的影响力大于散文禁令：不点名，模型就照着 Img 与远程地址写
    expect(artifact).toContain('`Img`')
    expect(artifact).toContain('远程图片')
  })

  it('正文以重申收尾，四条硬规则排在官方手册之后', () => {
    const tail = artifact.slice(artifact.lastIndexOf('## 重申'))
    expect(artifact.trimEnd().endsWith('不要试图改动代码。')).toBe(true)
    expect(tail).toContain('```schemaJson')
    expect(tail).toContain('不要用 `Page`')
    for (const action of GENUI_CARD_ACTIONS) expect(tail).toContain(`\`${action}\``)
  })

  it('声明技能对应的卡片协议版本，版本判定交给宿主', () => {
    expect(artifact).toContain(`SpaceCode 卡片协议 v${GENUI_SANDBOX_PROTOCOL_VERSION}`)
    expect(artifact).toContain('版本判定由宿主完成')
    // 不再邀模型自己带 protocolVersion：节点 schema 是封闭的
    expect(artifact).toContain('不要自己加 `protocolVersion`')
  })

  it('正文由 genPrompt 生成：官方物料与 this 上下文说明都在', () => {
    expect(artifact).toContain('## 可用组件')
    expect(artifact).toContain('## this 上下文声明')
    expect(artifact).toContain('## Action 定义')
  })
})
