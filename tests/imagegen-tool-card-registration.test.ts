// @vitest-environment node
/**
 * 生图卡片的注册名契约（#110）。
 *
 * 工具组件表是**精确名匹配、无前缀归一化**：按裸名 `generate_image` 注册永远命中不了，
 * 卡片会静默退化成通用工具卡。这里直接拿主进程工具面的常量拼全名去比对，
 * 工具改名或新增工具而卡片没跟上时，本测试必须红。
 */
import { describe, it, expect } from 'vitest'
import { IMAGEGEN_MCP_SERVER_KEY, IMAGEGEN_TOOL_NAMES } from '@electron/imagegen/imageGenTools'
import { TOOL_COMPONENT_MAP, PROMOTED_TOOL_NAMES } from '@/components/chat/tools'

describe('生图工具卡片注册', () => {
  it('每个生图工具都按完整 MCP 工具名注册了卡片', () => {
    const missing = IMAGEGEN_TOOL_NAMES
      .map(name => `mcp__${IMAGEGEN_MCP_SERVER_KEY}__${name}`)
      .filter(fullName => !(fullName in TOOL_COMPONENT_MAP))
    expect(missing).toEqual([])
  })

  it('裸名不是注册键 —— 精确匹配下裸名注册等于没注册', () => {
    for (const name of IMAGEGEN_TOOL_NAMES) {
      expect(TOOL_COMPONENT_MAP[name]).toBeUndefined()
    }
  })

  /**
   * 生图卡片是回合的交付物：工具组收口即自动折叠（sticky），卡片折进去
   * 等于生成的图从主界面消失，只剩一条路径文本。每个生图工具都必须
   * 在「永不折叠」名单里，改名/新增工具漏跟上时本测试必须红。
   */
  it('每个生图工具都在永不折叠名单里 —— 图片不能被工具组吞掉', () => {
    const missing = IMAGEGEN_TOOL_NAMES
      .map(name => `mcp__${IMAGEGEN_MCP_SERVER_KEY}__${name}`)
      .filter(fullName => !PROMOTED_TOOL_NAMES.has(fullName))
    expect(missing).toEqual([])
  })
})