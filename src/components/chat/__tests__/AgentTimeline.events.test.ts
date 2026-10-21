import { describe, it, expect, beforeEach } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import AgentTimeline from '../AgentTimeline.vue'
import { extensionDialogService, type ExtensionDialog } from '@/services/extensionDialogService'
import type { Message } from '@/types'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
// 组件安装 pinia 插件时会把它设为活动实例。ExtensionDialogCard 的 setup 要读 turn store。
const rootPinia = createPinia()
config.global.plugins = [i18n, rootPinia]

const STUBS = ['MarkdownRenderer', 'ReasoningCard', 'TurnSummaryBar', 'ThinkingState', 'ErrorCard']

function mountTimeline(messages: Message[], mode?: 'design', dialogs?: ExtensionDialog[]) {
  return mount(AgentTimeline, {
    props: { messages, loading: false, dialogs, ...(mode ? { mode } : {}) },
    global: { stubs: STUBS },
  })
}

function textContents(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAllComponents({ name: 'MarkdownRenderer' }).map(c => c.props('content'))
}

describe('AgentTimeline timelineEvents 归一化', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('把兼容层按帧切碎的相邻 text 事件合并成一个 Markdown 文档', () => {
    // 复现网关每个 content 分片都回传 reasoning_content:"" 时的形状：
    // 一段答复被切成 3 个 text 块，块之间夹着 2 个空 thinking 块。
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '"做一个考勤表" 有几种可能的理解',
      timestamp: Date.now(),
      reasoning: { content: 'The user says 做一个考勤表', startTime: 1000, endTime: 2000 },
      timelineEvents: [
        { id: 'r0', type: 'reasoning', timestamp: 1, status: 'completed', content: 'The user says 做一个考勤表' },
        { id: 't1', type: 'text', timestamp: 2, status: 'completed', content: '"做一个' },
        { id: 'r1', type: 'reasoning', timestamp: 3, status: 'completed', content: '' },
        { id: 't2', type: 'text', timestamp: 4, status: 'completed', content: '考勤表"' },
        { id: 'r2', type: 'reasoning', timestamp: 5, status: 'completed', content: '' },
        { id: 't3', type: 'text', timestamp: 6, status: 'completed', content: ' 有几种可能的理解' },
      ],
    }

    const wrapper = mountTimeline([msg])

    expect(textContents(wrapper)).toEqual(['"做一个考勤表" 有几种可能的理解'])
    // 空白 reasoning 占位块不再渲染成夹在答复中间的折叠卡片
    expect(wrapper.findAllComponents({ name: 'ReasoningCard' })).toHaveLength(1)
  })

  it('保留运行中的空 reasoning 事件（思考中动画的首帧）', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      timelineEvents: [
        { id: 'r0', type: 'reasoning', timestamp: 1, status: 'running', content: '' },
      ],
    }

    expect(mountTimeline([msg]).findAllComponents({ name: 'ReasoningCard' })).toHaveLength(1)
  })

  it('工具调用前后的 text 块不跨工具合并', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [{ id: 'tool-1', name: 'UnknownTool', input: { file_path: 'a.ts' }, status: 'completed', startTime: 1, endTime: 2 }],
      timelineEvents: [
        { id: 't1', type: 'text', timestamp: 1, status: 'completed', content: '先看一眼' },
        { id: 'tool-tool-1', type: 'tool_call', timestamp: 2, status: 'completed', toolCallId: 'tool-1' },
        { id: 't2', type: 'text', timestamp: 3, status: 'completed', content: '然后改好了' },
      ],
    }

    expect(textContents(mountTimeline([msg]))).toEqual(['先看一眼', '然后改好了'])
  })

  it('design 模式：跨帧切断的设计标签在合并后整体剥离', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      timelineEvents: [
        { id: 't1', type: 'text', timestamp: 1, status: 'completed', content: '给你 <od-card type="file" title="考勤表' },
        { id: 't2', type: 'text', timestamp: 2, status: 'completed', content: '.html">attendance.html</od-card> 看看' },
      ],
    }

    const contents = textContents(mountTimeline([msg], 'design'))
    expect(contents).toHaveLength(1)
    expect(contents[0]).not.toContain('od-card')
    expect(contents[0]).toContain('看看')
  })

  it('design 模式：只含设计标签的文本块不渲染空 Markdown 容器', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      timelineEvents: [
        { id: 't1', type: 'text', timestamp: 1, status: 'completed', content: '<next-steps><action label="继续" prompt="go"/></next-steps>' },
      ],
    }

    expect(mountTimeline([msg], 'design').findAllComponents({ name: 'MarkdownRenderer' })).toHaveLength(0)
  })

  /**
   * pi 流式写入时 path 参数排在 content 之后，闭合引号要到生成末尾才出现。
   * 路径未到达前 diff chip 用「写入中」占位（曾是误导性的 unknown），
   * 路径闭合后由节流刷新自动换成真实文件名。
   */
  it('无路径的写入 chip 显示「写入中」占位，有路径的显示文件名', () => {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'w1', name: 'Write', input: { content: 'const a = 1\nconst b = 2' }, status: 'running', startTime: 1 },
        { id: 'w2', name: 'Write', input: { path: 'src/app.ts', content: 'x' }, status: 'completed', startTime: 2, endTime: 3 },
      ],
      timelineEvents: [
        { id: 'tool-w1', type: 'tool_call', timestamp: 1, status: 'running', toolCallId: 'w1' },
        { id: 'tool-w2', type: 'tool_call', timestamp: 2, status: 'completed', toolCallId: 'w2' },
      ],
    }

    const chips = mountTimeline([msg]).findAll('.tool-group__diff-chip').map(el => el.text())

    expect(chips).toHaveLength(2)
    expect(chips[0]).toContain('写入中')
    expect(chips[0]).toContain('+2')
    expect(chips[1]).toContain('app.ts')
    expect(chips.join('')).not.toContain('unknown')
  })
})

/**
 * pi 扩展对话框进时间线 (issue #54)。
 *
 * 它不属于任何一条 message —— 帧里没有 toolCallId，也没有对应的工具条目 ——
 * 所以只能由 MessageList 按会话/分组分配后，作为视图层合成的事件传给 AgentTimeline。
 * 这里钉三件事：位置（事件游标 / anchorAtStart / 兜底）、不渲染别组消息的卡片、
 * 以及卡片状态变化能触发重算。
 */
describe('AgentTimeline 扩展对话框', () => {
  const SID = 'sid-1'

  beforeEach(() => {
    setActivePinia(rootPinia)
    extensionDialogService.clear()
  })

  function withAssistantTurn(): Message[] {
    const msg: Message = {
      id: 'm1',
      role: 'assistant',
      content: '我先看看这个仓库',
      timestamp: Date.now(),
      timelineEvents: [{ id: 't1', type: 'text', timestamp: 1, status: 'completed', content: '我先看看这个仓库' }],
    }
    return [msg]
  }

  function openDialog(request: Parameters<typeof extensionDialogService.open>[1]): ExtensionDialog[] {
    extensionDialogService.open(SID, request)
    return extensionDialogService.list(SID)
  }

  /** 组件不再自己读 service：状态变化后由父级把新列表传进来 */
  async function syncDialogs(wrapper: ReturnType<typeof mountTimeline>) {
    await wrapper.setProps({ dialogs: extensionDialogService.list(SID) })
  }

  it('待答的对话框挂在时间线末尾，不挂到某条工具条目上', () => {
    const wrapper = mountTimeline(withAssistantTurn(), undefined, openDialog({
      dialogId: 'u1', method: 'select', title: 'Plan mode — what next?', options: ['Start', 'Settings'],
    }))

    const cards = wrapper.findAllComponents({ name: 'ExtensionDialogCard' })
    expect(cards).toHaveLength(1)
    expect(cards[0].findAll('.option-btn').map(b => b.text())).toEqual(['Start', 'Settings'])
  })

  it('答过的收成一行留在原位，下一轮菜单接在它后面', async () => {
    const wrapper = mountTimeline(withAssistantTurn(), undefined, openDialog({
      dialogId: 'u1', method: 'select', title: 'First?', options: ['A', 'B'],
    }))

    extensionDialogService.resolve(SID, 'u1', 'A')
    extensionDialogService.open(SID, { dialogId: 'u2', method: 'select', title: 'Second?', options: ['C'] })
    await syncDialogs(wrapper)

    const cards = wrapper.findAllComponents({ name: 'ExtensionDialogCard' })
    expect(cards).toHaveLength(2)
    // 第一张不再可点，只留「答了什么」
    expect(cards[0].find('.option-list').exists()).toBe(false)
    expect(cards[0].find('.resolved-text').text()).toBe('A')
    expect(cards[1].findAll('.option-btn')).toHaveLength(1)
  })

  it('引擎把提问收掉时卡片跟着退场，不留一张点不动的卡', async () => {
    const wrapper = mountTimeline(withAssistantTurn(), undefined, openDialog({
      dialogId: 'u1', method: 'confirm', title: 'Clear session?', message: 'All messages will be lost.',
    }))
    expect(wrapper.find('.action-btn').exists()).toBe(true)

    extensionDialogService.close(SID, 'u1', 'process_exit')
    await syncDialogs(wrapper)

    expect(wrapper.find('.action-btn').exists()).toBe(false)
    expect(wrapper.find('.resolved-text').text()).toBe('引擎已退出，这次提问过期')
  })

  /**
   * 卡片必须留在「问它的那一行」之后，而不是统统吊在时间线末尾 (issue #54)。
   *
   * 末尾追加看着能用，实际是把卡片压在所有后续输出之上：用户答完、LLM 接着往下说，
   * 那张已答的卡还在最底下，读起来像提问还挂在那儿没结。
   */
  describe('按发生位置插入，不吊在末尾', () => {
    function turnWithToolThenText(): Message[] {
      return [{
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [{ id: 'tc1', name: 'Bash', input: {}, status: 'completed', startTime: 0, endTime: 1000 }],
        timelineEvents: [
          { id: 'tool-tc1', type: 'tool_call', timestamp: 1, status: 'completed', toolCallId: 'tc1' },
          { id: 't2', type: 'text', timestamp: 2, status: 'completed', content: '按你选的方案继续实现完了' },
        ],
      }]
    }

    function bodyKinds(wrapper: ReturnType<typeof mountTimeline>): string[] {
      return wrapper.findAll('.event-body').map(el => {
        if (el.findComponent({ name: 'ExtensionDialogCard' }).exists()) return 'dialog'
        if (el.find('.tool-row').exists()) return 'tool'
        if (el.find('.event-meta').exists()) return 'meta'
        return 'text'
      })
    }

    function mountTurn(messages: Message[], dialogs: Array<Record<string, unknown>>) {
      for (const dialog of dialogs) {
        extensionDialogService.open(SID, dialog as never)
      }
      return mountTimeline(messages, undefined, extensionDialogService.list(SID))
    }

    it('游标指着工具行时，卡片插在工具行与后续答复之间', () => {
      const wrapper = mountTurn(turnWithToolThenText(), [
        { dialogId: 'u1', method: 'select', title: '选哪个？', options: ['A', 'B'], anchorMessageId: 'm1', anchorEventId: 'tool-tc1' },
      ])

      expect(bodyKinds(wrapper)).toEqual(['tool', 'dialog', 'text'])
    })

    it('游标那一行已经不在了，退到该轮末尾，仍不越过下一条消息', () => {
      const messages = turnWithToolThenText()
      messages.push({
        id: 'm2',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        timelineEvents: [{ id: 't9', type: 'text', timestamp: 3, status: 'completed', content: '后面又一轮' }],
      })

      const wrapper = mountTurn(messages, [
        { dialogId: 'u1', method: 'select', title: '选哪个？', options: ['A'], anchorMessageId: 'm1', anchorEventId: '已被归一化并掉的碎片' },
      ])

      expect(bodyKinds(wrapper)).toEqual(['tool', 'text', 'dialog', 'text'])
    })

    it('压根没有游标的（会话一起来就问）才落到时间线末尾', () => {
      const wrapper = mountTurn(turnWithToolThenText(), [
        { dialogId: 'u1', method: 'confirm', title: '信任这个目录？' },
      ])

      expect(bodyKinds(wrapper)).toEqual(['tool', 'text', 'dialog'])
    })

    it('提问发生在首个 token 之前时，卡片排在本消息全部输出之前', () => {
      const wrapper = mountTurn(turnWithToolThenText(), [
        { dialogId: 'u1', method: 'select', title: 'Plan mode — what next?', options: ['A'], anchorMessageId: 'm1', anchorAtStart: true },
      ])

      expect(bodyKinds(wrapper)).toEqual(['dialog', 'tool', 'text'])
    })

    it('锚在别组消息上的卡片不会挂到本组末尾', () => {
      const wrapper = mountTurn(turnWithToolThenText(), [
        { dialogId: 'u1', method: 'select', title: '下一轮的提问', options: ['A'], anchorMessageId: 'm2', anchorEventId: 't9' },
      ])

      expect(wrapper.findAllComponents({ name: 'ExtensionDialogCard' })).toHaveLength(0)
    })

    it('连问的多张卡各回各位，先问的先落位', () => {
      const messages = turnWithToolThenText()
      messages[0].timelineEvents!.push(
        { id: 'tool-tc2', type: 'tool_call', timestamp: 3, status: 'completed', toolCallId: 'tc2' },
        { id: 't3', type: 'text', timestamp: 4, status: 'completed', content: '收尾说明' },
      )
      messages[0].toolCalls!.push({ id: 'tc2', name: 'UnknownTool', input: {}, status: 'completed', startTime: 0, endTime: 1000 })

      const wrapper = mountTurn(messages, [
        { dialogId: 'u1', method: 'select', title: 'Q1', options: ['A'], anchorMessageId: 'm1', anchorEventId: 'tool-tc1' },
        { dialogId: 'u2', method: 'select', title: 'Q2', options: ['A'], anchorMessageId: 'm1', anchorEventId: 'tool-tc2' },
      ])

      expect(bodyKinds(wrapper)).toEqual(['tool', 'dialog', 'text', 'tool', 'dialog', 'text'])
    })
  })
})
