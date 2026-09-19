// 小窗口滚动链的样式不变量检查。
// 节点的缩略聊天窗只有在外层消息区建立 flex 高度链时，
// MessageList 内部的 overflow-y:auto 才会真正生效 —— 否则内容只是被裁掉，表现为"滚不动"。
import { describe, expect, it } from 'vitest'
import miniChatPanelSource from '../MiniChatPanel.vue?raw'

/** 取出 .mini-chat-messages 的样式块内容 */
const messagesBlock = (/.mini-chat-messages\s*\{[^}]*\}/.exec(miniChatPanelSource)?.[0] ?? '')

describe('编排节点缩略聊天窗 — 滚动高度链', () => {
  it('消息区是 flex 列容器且允许收缩', () => {
    expect(messagesBlock).not.toBe('')
    expect(messagesBlock).toMatch(/display\s*:\s*flex/)
    expect(messagesBlock).toMatch(/flex-direction\s*:\s*column/)
    expect(messagesBlock).toMatch(/min-height\s*:\s*0/)
  })

  it('消息区不把纵向滚动裁掉', () => {
    expect(messagesBlock).not.toMatch(/overflow-y\s*:\s*hidden/)
  })
})
