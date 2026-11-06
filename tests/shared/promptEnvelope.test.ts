import { describe, expect, it } from 'vitest'
import {
  parseEngineUserPrompt,
  wrapSuperAgentHostContext,
} from '@/shared/promptEnvelope'

describe('parseEngineUserPrompt', () => {
  it('剥掉 @"路径" 引用与末尾 Attachments 块，路径按出现顺序返回', () => {
    const raw = '@"C:\\Temp\\SpaceCode\\pasted\\pasted-1.txt" @"C:\\docs\\a.md" 这个是什么场景\n\nAttachments: [File: pasted-1.txt], [File: a.md]'
    const parsed = parseEngineUserPrompt(raw)

    expect(parsed.text).toBe('这个是什么场景')
    expect(parsed.fileRefs).toEqual([
      'C:\\Temp\\SpaceCode\\pasted\\pasted-1.txt',
      'C:\\docs\\a.md',
    ])
  })

  it('只有引用没有正文时返回空文本，但保留引用', () => {
    const parsed = parseEngineUserPrompt('@"C:\\Temp\\pasted-1.txt"\n\nAttachments: [File: pasted-1.txt]')

    expect(parsed.text).toBe('')
    expect(parsed.fileRefs).toEqual(['C:\\Temp\\pasted-1.txt'])
  })

  it('Images 块同样剥离，且不误删正文里的 Attachments 字样', () => {
    const parsed = parseEngineUserPrompt('说说 Attachments: 这个词\n\nImages: [Image: shot.png]')

    expect(parsed.text).toBe('说说 Attachments: 这个词')
    expect(parsed.fileRefs).toEqual([])
  })

  it('重复引用只保留一次', () => {
    const parsed = parseEngineUserPrompt('@"C:\\a.txt" @"C:\\a.txt" hi\n\nAttachments: [File: a.txt]')

    expect(parsed.fileRefs).toEqual(['C:\\a.txt'])
    expect(parsed.text).toBe('hi')
  })

  it('没有信封痕迹的普通文本原样返回', () => {
    const parsed = parseEngineUserPrompt('  普通问题 @file:"x"  ')

    expect(parsed.text).toBe('普通问题 @file:"x"')
    expect(parsed.fileRefs).toEqual([])
  })

  it('剥掉成对信封里的宿主注入段，只留人打的那句', () => {
    const raw = [
      '重新执行',
      '',
      wrapSuperAgentHostContext(['# Super Agent Router', '你是 SpaceCode 里这个项目的 Super Agent Router。', '[工单快照]\n槽位：0/1 执行中']),
    ].join('\n')

    expect(parseEngineUserPrompt(raw).text).toBe('重新执行')
  })

  it('整条消息就是注入段时剥成空串 —— 中继轮实时也没推气泡', () => {
    const raw = wrapSuperAgentHostContext(['[工单事件]\nticket=ticket-1 report=ready\nWorker 结论：做完了'])

    expect(parseEngineUserPrompt(raw).text).toBe('')
  })

  it('信封与附件说明同时存在时两者都剥掉', () => {
    const raw = [
      '@"C:\\Temp\\shot.png" 这个界面不对',
      '',
      'Images: [Image: shot.png]',
      '',
      wrapSuperAgentHostContext(['# Super Agent Router']),
    ].join('\n')
    const parsed = parseEngineUserPrompt(raw)

    expect(parsed.text).toBe('这个界面不对')
    expect(parsed.fileRefs).toEqual(['C:\\Temp\\shot.png'])
  })

  it('加信封之前写入的旧正文按角色说明标题截断', () => {
    const raw = '你好\n\n# Super Agent Router\n\n你是 SpaceCode 里这个项目的 Super Agent Router。'

    expect(parseEngineUserPrompt(raw).text).toBe('你好')
  })

  it('旧正文里只有工单快照时同样从空行分隔处截断', () => {
    const raw = '你好\n\n[工单快照]\n槽位：0/1 执行中 · 0 排队\n当前没有活跃工单。'

    expect(parseEngineUserPrompt(raw).text).toBe('你好')
  })

  it('旧的中继与补正轮次整条消失，不留一条假的用户消息', () => {
    expect(parseEngineUserPrompt('[工单事件]\nticket=ticket-1 report=ready').text).toBe('')
    expect(parseEngineUserPrompt('[宿主协议校正]\n上一条回复缺少 route 围栏').text).toBe('')
  })

  it('人在正文里自己写出锚点不算注入：非空行分隔与行中都不断开', () => {
    expect(parseEngineUserPrompt('帮我改成这样：[工单快照]\n槽位：1/1').text)
      .toBe('帮我改成这样：[工单快照]\n槽位：1/1')
    expect(parseEngineUserPrompt('我要写一段文字，第一行就是 # Super Agent Router 的标题').text)
      .toBe('我要写一段文字，第一行就是 # Super Agent Router 的标题')
  })

  it('wrapSuperAgentHostContext 忽略空块，全空时返回空串', () => {
    expect(wrapSuperAgentHostContext(['契约', '', '  ', '快照'])).toContain('契约\n\n快照')
    expect(wrapSuperAgentHostContext(['', null, undefined])).toBe('')
  })
})
