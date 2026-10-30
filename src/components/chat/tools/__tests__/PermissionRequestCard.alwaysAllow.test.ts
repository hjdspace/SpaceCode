// @vitest-environment jsdom
/**
 * 「始终允许」按钮的行为契约。
 *
 * 回归背景：按钮曾按工具名白名单显示，并只回传 decisionClassification:'user_permanent'。
 * 那个字段仅进 OTel 遥测，不产生任何权限规则，于是点了等于只放行一次，下次编辑同一
 * 文件照样弹卡。现在按钮由引擎随请求附带的 permission_suggestions 驱动，并把它们原样
 * 回传到 updatedPermissions。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PermissionRequestCard from '@/components/chat/tools/PermissionRequestCard.vue'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'
import type { PermissionUpdate } from '@/shared/channels/claudeCode'

const storeMocks = vi.hoisted(() => ({
  allowPermission: vi.fn(async () => {}),
  denyPermission: vi.fn(async () => {}),
  getPendingPermissionForToolUse: vi.fn(),
}))

vi.mock('@/stores/turn', () => ({ useTurnStore: () => storeMocks }))

// MarkdownRenderer 静态导入链路会实例化 settings store 并调用 api，打桩避免 unhandled rejection
vi.mock('@/services/electronAPI', () => ({
  api: {
    readFile: vi.fn(async () => 'content'),
    readFileAsBase64: vi.fn(async () => null),
    loadGuiSettings: vi.fn(async () => ({ success: false })),
    getEnv: vi.fn(async () => undefined),
    terminal: { onExit: vi.fn() },
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: { 'en-US': enUS, 'zh-CN': zhCN },
})

// 引擎对仓库内 Edit 实际下发的建议：切到 acceptEdits，只活在会话内存里
const SESSION_SUGGESTIONS: PermissionUpdate[] = [
  { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
]
// Bash 前缀规则会落盘到 .claude/settings.local.json
const PERSISTED_SUGGESTIONS: PermissionUpdate[] = [
  {
    type: 'addRules',
    rules: [{ toolName: 'Bash', ruleContent: 'git:*' }],
    behavior: 'allow',
    destination: 'localSettings',
  },
]

const EDIT_INPUT = { file_path: 'D:/repo/a.ts', old_string: 'x', new_string: 'y' }

function mountCard(toolName: string, input: Record<string, unknown> = EDIT_INPUT) {
  return mount(PermissionRequestCard, {
    props: { messageId: 'msg-1', toolUseId: 'tu-1', toolName, input },
    global: { plugins: [i18n, createPinia()] },
  })
}

function pendingWith(suggestions: PermissionUpdate[] | undefined) {
  storeMocks.getPendingPermissionForToolUse.mockReturnValue({
    toolUseId: 'tu-1',
    permissionSuggestions: suggestions,
  })
}

describe('PermissionRequestCard 始终允许', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    storeMocks.getPendingPermissionForToolUse.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('引擎没给建议时不显示按钮，Edit 也不例外', async () => {
    pendingWith(undefined)
    const wrapper = mountCard('Edit')

    expect(wrapper.find('.always-allow').exists()).toBe(false)
    expect(wrapper.find('.allow').exists()).toBe(true)
  })

  it('有建议就显示，不再按工具名白名单屏蔽 Bash', async () => {
    pendingWith(PERSISTED_SUGGESTIONS)
    const wrapper = mountCard('Bash', { command: 'git push' })

    expect(wrapper.find('.always-allow').exists()).toBe(true)
  })

  it('点击后把引擎的建议原样回传到 updatedPermissions', async () => {
    pendingWith(SESSION_SUGGESTIONS)
    const wrapper = mountCard('Edit')

    await wrapper.find('.always-allow').trigger('click')

    expect(storeMocks.allowPermission).toHaveBeenCalledWith(
      'msg-1', 'tu-1', EDIT_INPUT, 'user_permanent', SESSION_SUGGESTIONS, undefined,
    )
  })

  it('普通「允许」不回传规则，只放行这一次', async () => {
    pendingWith(SESSION_SUGGESTIONS)
    const wrapper = mountCard('Edit')

    await wrapper.find('.allow').trigger('click')

    // 连 decisionClassification 都不带 —— 它不是持久化开关；
    // 末位是所属会话，未传时由 store 回落到当前会话。
    expect(storeMocks.allowPermission).toHaveBeenCalledWith(
      'msg-1', 'tu-1', EDIT_INPUT, undefined, undefined, undefined,
    )
  })

  it('会话级规则不承诺"始终"，改用本会话文案', async () => {
    pendingWith(SESSION_SUGGESTIONS)
    const wrapper = mountCard('Edit')

    expect(wrapper.find('.always-allow').text()).toBe('Allow for this session')
  })

  it('落盘到 settings 的规则才显示"Always Allow"', async () => {
    pendingWith(PERSISTED_SUGGESTIONS)
    const wrapper = mountCard('Bash', { command: 'git push' })

    expect(wrapper.find('.always-allow').text()).toBe('Always Allow')
  })
})
