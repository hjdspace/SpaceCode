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
import { TOOL_COMPONENT_MAP } from '@/components/chat/tools'

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
})