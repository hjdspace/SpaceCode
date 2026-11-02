/**
 * 回合进行中，时间线末尾那行常驻活动指示的可见性。
 *
 * 回归点：此前该行走的是「空闲间隙」判定 —— 一旦有工具在跑就返回 false，
 * 理由是「工具已有自身 spinner」。实际那个 12px 图标混在「N 个工具调用」摘要里
 * 几乎看不出在动，一条长命令跑起来整条时间线静止，被用户读成任务已经结束。
 * 现在只要 loading 且本组已有可见内容就必须在。
 *
 * 两个刻意保留的例外：等待首个 token（由 MessageList 占位行负责，避免双份）
 * 与卡在用户裁决上（此刻并没有「进行中」，权限卡 / 对话框才是承重 UI）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { config, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import AgentTimeline from '../AgentTimeline.vue'
import type { Message } from '@/types'
import { ErrorCategory } from '@/types'
import type { PermissionRequest } from '@/services/permissionService'
import type { ExtensionDialog } from '@/services/extensionDialogService'
import { useTurnStore } from '@/stores/turn'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
const rootPinia = createPinia()
config.global.plugins = [i18n, rootPinia]

const STUBS = [
  'MarkdownRenderer',
  'ReasoningCard',
  'TurnSummaryBar',
  'LoadingState',
  'ErrorCard',
  'PermissionRequestCard',
  'ExtensionDialogCard',
]

const SESSION = 's-activity'

/** 一条正在跑 `npm run build` 的 Bash 工具调用，形状取自真实 turn 事件 */
function bashRunning(): Message {
  return {
    id: 'm-bash',
    role: 'assistant',
    content: '',
    timestamp: Date.now() - 5_000,
    toolCalls: [
      {
        id: 't-bash',
        name: 'Bash',
        input: { command: 'npm run build' },
        status: 'running',
        startTime: Date.now() - 4_000,
      },
    ],
    timelineEvents: [
      { id: 'tool-t-bash', type: 'tool_call', timestamp: Date.now() - 4_000, status: 'running', toolCallId: 't-bash' },
    ],
  }
}

function mountTimeline(messages: Message[], extra: Record<string, unknown> = {}) {
  return mount(AgentTimeline, {
    props: {
      messages,
      sessionId: SESSION,
      loading: true,
      turnStartTime: Date.now() - 5_000,
      ...extra,
    },
    global: { stubs: STUBS },
  })
}

function pendingPermission(toolUseId: string): PermissionRequest {
  return {
    sessionId: SESSION,
    requestId: `req-${toolUseId}`,
    toolName: 'Bash',
    toolUseId,
    input: { command: 'npm run build' },
  }
}

function pendingDialog(): ExtensionDialog {
  return {
    sessionId: SESSION,
    dialogId: 'd-1',
    method: 'confirm',
    title: '是否继续',
    state: 'pending',
  }
}

describe('AgentTimeline 常驻活动指示行', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('Bash 执行中：时间线末尾必须有活动指示行', () => {
    const wrapper = mountTimeline([bashRunning()])

    const waiting = wrapper.find('.timeline-waiting')
    expect(waiting.exists()).toBe(true)

    const indicator = wrapper.findComponent({ name: 'LoadingState' })
    expect(indicator.exists()).toBe(true)
    expect(indicator.props('labels')).toHaveLength(5)
  })

  it('计时锚点用回合发起时刻，不在进工具期归零', () => {
    const turnStart = Date.now() - 5_000
    const wrapper = mountTimeline([bashRunning()], { turnStartTime: turnStart })

    expect(wrapper.findComponent({ name: 'LoadingState' }).props('startTime')).toBe(turnStart)
  })

  it('等待首个 token（本组无可见内容）：交给 MessageList 占位行，不重复挂', () => {
    const empty: Message = { id: 'm-empty', role: 'assistant', content: '', timestamp: Date.now() }
    const wrapper = mountTimeline([empty])

    expect(wrapper.find('.timeline-waiting').exists()).toBe(false)
  })

  it('回合已结束（loading=false）：指示行消失', () => {
    const wrapper = mountTimeline([bashRunning()], { loading: false })

    expect(wrapper.find('.timeline-waiting').exists()).toBe(false)
  })

  it('等待权限裁决：不报「进行中」', () => {
    const turnStore = useTurnStore()
    turnStore.pendingPermissions.set(SESSION, new Map([[ 't-bash', pendingPermission('t-bash') ]]))

    const wrapper = mountTimeline([bashRunning()])

    expect(wrapper.find('.timeline-waiting').exists()).toBe(false)
  })

  it('等待 pi 扩展对话框回答：不报「进行中」', () => {
    const wrapper = mountTimeline([bashRunning()], { dialogs: [pendingDialog()] })

    expect(wrapper.find('.timeline-waiting').exists()).toBe(false)
  })

  it('引擎重试倒计时中：显示倒计时卡而非轮询行', () => {
    const msg = bashRunning()
    msg.metadata = {
      retryState: {
        attempt: 1,
        maxRetries: 3,
        errorCategory: ErrorCategory.RATE_LIMIT,
        errorTitle: '请求过于频繁',
        errorMessage: 'API 返回 429 速率限制错误',
        delayMs: 30_000,
        startedAt: Date.now(),
        aborted: false,
      },
    }

    const wrapper = mountTimeline([msg])

    expect(wrapper.find('.timeline-engine-retry').exists()).toBe(true)
    expect(wrapper.find('.timeline-waiting').exists()).toBe(false)
  })
})
