import { describe, it, expect } from 'vitest'
import type { ToolCall } from '@/types'
import {
  IMAGEGEN_TOOL_FULL_NAMES,
  isImageGenToolName,
  unwrapExtraToolCall,
} from '../unwrapExtraTool'

function extraTool(input: Record<string, unknown>, output?: string, status: ToolCall['status'] = 'completed'): ToolCall {
  return { id: 'x1', name: 'ExecuteExtraTool', input, output, status }
}

const innerJson = JSON.stringify({ model: 'agnes-image-2.5-flash', images: [{ path: 'D:/out/puppy.png', size: '1024x1024' }] })
const wrappedOutput = JSON.stringify({ result: [{ type: 'text', text: innerJson }], tool_name: 'mcp__spacecode-imagegen__generate_image' })

describe('unwrapExtraToolCall', () => {
  it('把包裹的生图调用还原成真工具名、参数与内层结果', () => {
    const tool = extraTool(
      { tool_name: 'mcp__spacecode-imagegen__generate_image', params: { nameHint: 'puppy', prompt: 'a puppy' } },
      wrappedOutput,
    )
    const out = unwrapExtraToolCall(tool)
    expect(out.name).toBe('mcp__spacecode-imagegen__generate_image')
    expect(out.input).toEqual({ nameHint: 'puppy', prompt: 'a puppy' })
    expect(out.output).toBe(innerJson)
    // 身份与状态保持不变，卡片 key 才稳定
    expect(out.id).toBe('x1')
    expect(out.status).toBe('completed')
  })

  it('改图：参数里的 imagePaths 透传给卡片做参考图计数', () => {
    const tool = extraTool({
      tool_name: 'mcp__spacecode-imagegen__edit_image',
      params: { prompt: 'make it blue', imagePaths: ['D:/out/a.png', 'D:/out/b.png'] },
    })
    const out = unwrapExtraToolCall(tool)
    expect(out.name.endsWith('__edit_image')).toBe(true)
    expect(out.input.imagePaths).toEqual(['D:/out/a.png', 'D:/out/b.png'])
  })

  it('批量工具名同样还原', () => {
    const out = unwrapExtraToolCall(extraTool({ tool_name: 'mcp__spacecode-imagegen__generate_batch', params: {} }))
    expect(out.name).toBe('mcp__spacecode-imagegen__generate_batch')
  })

  it('缺少 params 时入参兜底为空对象，不抛错', () => {
    const out = unwrapExtraToolCall(extraTool({ tool_name: 'mcp__spacecode-imagegen__generate_image' }))
    expect(out.input).toEqual({})
  })

  it('整次失败的纯文本输出原样保留，交给卡片按错误处理', () => {
    const out = unwrapExtraToolCall(extraTool({ tool_name: 'mcp__spacecode-imagegen__generate_image' }, 'content_policy: blocked', 'error'))
    expect(out.output).toBe('content_policy: blocked')
    expect(out.status).toBe('error')
  })

  it('包裹里的错误文本也能剥出来', () => {
    const out = unwrapExtraToolCall(extraTool(
      { tool_name: 'mcp__spacecode-imagegen__generate_image' },
      JSON.stringify({ result: [{ type: 'text', text: 'rate_limit: slow down' }], tool_name: 'mcp__spacecode-imagegen__generate_image' }),
      'error',
    ))
    expect(out.output).toBe('rate_limit: slow down')
  })

  it('非生图的 ExecuteExtraTool 原样返回（同一引用）', () => {
    const tool = extraTool({ tool_name: 'mcp__other-server__foo', params: { a: 1 } }, wrappedOutput)
    expect(unwrapExtraToolCall(tool)).toBe(tool)
  })

  it('其它工具原样返回（同一引用）', () => {
    const tool: ToolCall = { id: 'b1', name: 'Bash', input: { command: 'ls' }, status: 'completed' }
    expect(unwrapExtraToolCall(tool)).toBe(tool)
  })

  it('在途（无 output）也能还原工具名与参数', () => {
    const out = unwrapExtraToolCall(extraTool({ tool_name: 'mcp__spacecode-imagegen__generate_image', params: { prompt: 'x' } }, undefined, 'running'))
    expect(out.name).toBe('mcp__spacecode-imagegen__generate_image')
    expect(out.output).toBeUndefined()
  })
})

describe('isImageGenToolName / IMAGEGEN_TOOL_FULL_NAMES', () => {
  it('名单覆盖三个生图工具', () => {
    expect([...IMAGEGEN_TOOL_FULL_NAMES]).toEqual([
      'mcp__spacecode-imagegen__generate_image',
      'mcp__spacecode-imagegen__edit_image',
      'mcp__spacecode-imagegen__generate_batch',
    ])
  })

  it('只认完整名，裸名与其它前缀不命中', () => {
    expect(isImageGenToolName('mcp__spacecode-imagegen__generate_image')).toBe(true)
    expect(isImageGenToolName('generate_image')).toBe(false)
    expect(isImageGenToolName('mcp__other__generate_image')).toBe(false)
    expect(isImageGenToolName(undefined)).toBe(false)
    expect(isImageGenToolName(123)).toBe(false)
  })
})