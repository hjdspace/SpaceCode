// @vitest-environment node
/**
 * 生图技能正文与工具面的一致性（#108）。
 *
 * 技能写错一个工具名，Agent 就会去调一个不存在的工具，而这种错在运行时只表现为
 * 「模型说它调了但没出图」—— 必须由测试钉住。这里读的是仓库里提交的那份资源，
 * seed 与打包用的就是它。
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { IMAGEGEN_MAX_BATCH, IMAGEGEN_MAX_INPUT_IMAGES, IMAGEGEN_MAX_VARIANTS, IMAGEGEN_MCP_SERVER_KEY, IMAGEGEN_TOOL_NAMES } from '@electron/imagegen/imageGenTools'
import { parseFrontmatterText } from '@electron/skillManagerV2/fsutil'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillDir = join(repoRoot, 'resources', 'builtin-skills', 'imagegen')
const referenceDir = join(skillDir, 'references')
/** git 在 Windows 上会把 LF 检出成 CRLF；比对只看内容，不看行尾。 */
const read = (path: string): string => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n')
const body = read(join(skillDir, 'SKILL.md'))
const referenceNames = readdirSync(referenceDir).filter(name => name.endsWith('.md')).sort()
/** 参考文档跟正文一起铺给两个引擎，里面写错工具名同样会让 Agent 去调一个不存在的工具。 */
const shipped = [body, ...referenceNames.map(name => read(join(referenceDir, name)))].join('\n')
const prefix = `mcp__${IMAGEGEN_MCP_SERVER_KEY}__`

describe('imagegen 技能正文', () => {
  it('frontmatter 的 name 与资源目录名一致', () => {
    expect(parseFrontmatterText(body).get('name')).toBe('imagegen')
  })

  it('每个工具的全名都出现在正文里', () => {
    for (const name of IMAGEGEN_TOOL_NAMES) {
      expect(body).toContain(`${prefix}${name}`)
    }
  })

  it('正文与参考文档引用的工具名集合与工具定义完全一致，没有编造的工具', () => {
    const mentioned = new Set([...shipped.matchAll(/mcp__spacecode-imagegen__([a-z_]+)/g)].map(match => match[1]))
    expect([...mentioned].sort()).toEqual([...IMAGEGEN_TOOL_NAMES].sort())
  })

  it('改图失败不得替换为重新生成，且交代源文件不被覆盖', () => {
    expect(body).toContain('改图失败不得替换为重新生成')
    expect(body).toContain('源文件永远不会被覆盖')
  })

  it('技能正文写的参考图上限与工具面一致', () => {
    expect(body).toContain(`1–${IMAGEGEN_MAX_INPUT_IMAGES} 张`)
  })

  /** 上限写错等于让 Agent 发一个必被拒的请求，或者以为能一次要 20 张。 */
  it('变体与批量上限、不截断与输入顺序都写进正文', () => {
    expect(body).toContain(`1–${IMAGEGEN_MAX_VARIANTS} 张`)
    expect(body).toContain(`1–${IMAGEGEN_MAX_BATCH} 条`)
    expect(body).toContain('不截断')
    expect(body).toContain('输入顺序')
  })

  it('交代取消与失败分开报、已落盘的图保留，且中止不保证供应商停止计费', () => {
    expect(body).toContain('已取消与失败是两回事')
    expect(body).toContain('已落盘的图保留')
    expect(body).toContain('全部被取消时工具返回取消结果')
    expect(body).toContain('不能保证供应商停止计费')
    expect(body).toContain('不要承诺「取消就不花钱」')
  })

  it('不残留外部 CLI 的目录变量、脚本名、他家模型名、抠色指令与环境变量式凭证', () => {
    for (const forbidden of ['$CODEX_HOME', 'image_gen.py', 'gpt-image-1.5', 'remove_chroma_key', 'OPENAI_API_KEY']) {
      expect(shipped).not.toContain(forbidden)
    }
    expect(shipped).not.toMatch(/\b[A-Z][A-Z0-9]*_(API_KEY|TOKEN|SECRET)\b/)
    expect(shipped).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
  })

  it('交代计费、拒绝即终局、取消不阻止计费，且不声称自己看过图', () => {
    expect(body).toContain('计费')
    expect(body).toContain('不要自动重试')
    expect(body).toContain('取消')
    expect(body).toContain('看不到')
  })

  it('禁止把结果路径再贴成 Markdown 图片 —— 卡片已渲染，重复贴每张显示两次', () => {
    expect(body).toContain('Markdown 图片')
    expect(body).toContain('显示两次')
  })

  it('两份参考文档都在，且都进了漂移扫描', () => {
    expect(referenceNames).toEqual(['prompting.md', 'sample-prompts.md'])
    expect(existsSync(join(referenceDir, 'prompting.md'))).toBe(true)
    expect(existsSync(join(referenceDir, 'sample-prompts.md'))).toBe(true)
  })
})