<template>
  <div class="super-agent-view">
    <!-- 系统问题入口（T13）：顶部只显示汇总计数，点击开关只读面板。
         MVP 只上报不可操作：不提供重试/忽略等处置按钮。 -->
    <header class="health-entry">
      <button
        class="health-chip"
        :class="{ open: superAgentStore.healthPanelOpen }"
        type="button"
        data-testid="super-agent-health-entry"
        @click="superAgentStore.toggleHealthPanel()"
      >
        <HeartPulse :size="14" />
        <span>{{ t('superAgent.health.entry') }}</span>
        <span v-if="superAgentStore.healthProblemCount > 0" class="count">
          {{ superAgentStore.healthProblemCount }}
        </span>
      </button>
    </header>

    <SuperAgentHealth v-if="superAgentStore.healthPanelOpen" :problems="superAgentStore.healthProblems" />

    <!-- Router 已绑定：复用主聊天时间线 + Composer。Router 是唯一对话者，
         loading/中止都按 routerSessionId 寻址 —— 不会触碰任何 Worker。 -->
    <template v-if="routerSessionId">
      <div class="super-agent-messages">
        <MessageList
          :messages="messages"
          :loading="isLoading"
          :session-id="routerSessionId"
          @tool-submit="handleToolSubmit"
          @tool-skip="handleToolSkip"
        />
      </div>

      <ChatInput
        class="super-agent-composer"
        @send="handleSend"
        @slash-command="handleSlashCommand"
        @update:model="handleModelChange"
        @update:effort="handleEffortChange"
        @update:agent="handleAgentChange"
        @open-skills="handleOpenSkills"
        @stop="handleStop"
        :disabled="isLoading"
        :is-sending="isLoading"
        :model-value="currentModel"
        :working-directory="workingDirectory"
        :placeholder="t('superAgent.composerPlaceholder')"
        :session-id="routerSessionId"
        :show-work-gallery-action="false"
        :excluded-commands="routerExcludedCommands"
      />
    </template>

    <!-- 未绑定（无项目根 / bind 未完成）：保留 T01 的空态 -->
    <div v-else class="super-agent-empty">
      <div class="empty-icon">
        <Sparkles :size="30" />
      </div>
      <h2>{{ t('superAgent.emptyTitle') }}</h2>
      <p>{{ t('superAgent.emptyHint') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { HeartPulse, Sparkles } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import { useSuperAgentStore } from '@/stores/superAgent'
import MessageList from '../chat/MessageList.vue'
import ChatInput, { type AllAttachments, type SendOptions } from '../chat/ChatInput.vue'
import SuperAgentHealth from './SuperAgentHealth.vue'
import { buildOutgoingMessage } from '@/lib/composer-outgoing'
import {
  generateCostMessage,
  generateHelpMessage,
  generateKeybindingsMessage,
} from '@/lib/slashCommandMessages'
import { findCommand } from '@/lib/constants/commands'
import type { EffortLevel } from '@/shared/effort'

const { t } = useI18n()
const appStore = useAppStore()
const settingsStore = useSettingsStore()
const sessionStore = useChatSessionStore()
const turnStore = useTurnStore()
const superAgentStore = useSuperAgentStore()

/**
 * Router 宿主裁剪的命令：context/diff/rewind(checkpoint) 依赖主聊天本地 UI
 * （上下文弹窗 / Diff 面板 / 回退选择器），在 Super Agent 中只隐藏不实现。
 */
const routerExcludedCommands = ['context', 'diff', 'rewind', 'checkpoint']

// ── Router 会话接线 ───────────────────────────────────────────────
const routerSessionId = computed(() => superAgentStore.boundSessionId)

const messages = computed(() =>
  routerSessionId.value ? sessionStore.getDisplayMessages(routerSessionId.value) : []
)

/** Router turn 进行中：MessageList 的轻量 typing + 计时与 Composer 的停止按钮都由它驱动 */
const isLoading = computed(() =>
  routerSessionId.value ? turnStore.getIsLoading(routerSessionId.value) : false
)

const workingDirectory = computed(() =>
  routerSessionId.value
    ? sessionStore.getWorkingDirectory(routerSessionId.value)
    : appStore.projectRoot
)

// ── 健康上报（T13 #83）：拉取 + 订阅 health.changed，渲染端只读 ──
let stopWatchingHealth: (() => void) | null = null

onMounted(async () => {
  const repoRoot = appStore.projectRoot
  if (!repoRoot) return
  await superAgentStore.bind(repoRoot)
  await superAgentStore.loadState(repoRoot)
  await superAgentStore.loadHealth(repoRoot)
  stopWatchingHealth = superAgentStore.watchHealth()
})

onUnmounted(() => {
  stopWatchingHealth?.()
  stopWatchingHealth = null
})

// ── 模型展示（与主聊天同源的初值；Router 会话模型不在此切换）──────
const currentModel = ref('')

onMounted(() => {
  currentModel.value = settingsStore.lastSelectedModel || settingsStore.config.model || ''
})

watch(() => settingsStore.config.model, (newModel) => {
  if (newModel && newModel !== currentModel.value) {
    currentModel.value = newModel
  }
})

function handleModelChange(model: string) {
  currentModel.value = model
}

async function handleEffortChange(level: EffortLevel) {
  settingsStore.effortLevel = level
  settingsStore.saveSettings()
}

async function handleAgentChange(agent: string) {
  if (routerSessionId.value) {
    await sessionStore.switchAgent(agent, routerSessionId.value)
  }
}

function handleOpenSkills() {
  window.dispatchEvent(new CustomEvent('open-skills-manager'))
}

// ── 发送 / 中止：与主聊天共用同一份正文组装，marker 与附件格式逐字一致 ──
async function handleSend(content: string, attachments: AllAttachments, options?: SendOptions) {
  const sid = routerSessionId.value
  if (!sid) return
  const hasContent = content.trim().length > 0 || attachments.files.length > 0 || attachments.images.length > 0
  if (!hasContent) return

  const { messageContent, userContent } = buildOutgoingMessage(content, attachments, options)
  try {
    await turnStore.sendMessage(messageContent, userContent, {
      files: attachments.files,
      images: attachments.images,
    }, { sessionId: sid })
  } catch (error) {
    console.error('[SuperAgentView] sendMessage failed:', error)
  }
}

async function handleStop() {
  const sid = routerSessionId.value
  if (!sid) return
  try {
    // 只中止 Router 会话的当前 turn；Worker 会话由各自的 Assignment 管理，不受影响
    await turnStore.abort(sid)
  } catch (error) {
    console.error('[SuperAgentView] stop failed:', error)
  }
}

// ── 斜杠命令：全局命令与主聊天同源执行，UI 绑定命令给出宿主提示 ──
async function handleSlashCommand(
  command: string,
  args: string,
  _attachments: AllAttachments,
  displayLabel?: string,
) {
  const sid = routerSessionId.value
  if (!sid) return

  const commandText = displayLabel || `/${command}${args ? ' ' + args : ''}`
  await sessionStore.addMessage({
    role: 'user',
    content: commandText,
  }, sid)

  const result = await executeRouterCommand(command, args, sid)
  if (result) {
    await sessionStore.addMessage({
      role: 'assistant',
      content: result,
    }, sid)
  }
}

async function executeRouterCommand(command: string, args: string, sid: string): Promise<string> {
  switch (command.toLowerCase()) {
    case 'help':
      return generateHelpMessage(t)

    case 'clear':
    case 'reset':
    case 'new': {
      await turnStore.abort(sid)
      const session = sessionStore.getSession(sid)
      if (session) session.messages = []
      return t('chatPanel.commandCleared')
    }

    case 'cost':
      return generateCostMessage(sessionStore.getSessionMessages(sid), t)

    case 'terminal':
      appStore.openTerminalTab(args || undefined)
      return t('chatPanel.commandTerminalOpened')

    case 'settings':
      window.dispatchEvent(new CustomEvent('open-settings'))
      return t('chatPanel.commandSettingsOpened')

    case 'skills':
      window.dispatchEvent(new CustomEvent('open-skills-manager'))
      return t('chatPanel.commandSkillsOpened')

    case 'mcp':
      window.dispatchEvent(new CustomEvent('open-mcp-manager'))
      return t('chatPanel.commandMcpOpened')

    case 'browser-use':
      window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'browser-use' } }))
      return t('chatPanel.commandBrowserUseOpened')

    case 'rewind':
    case 'checkpoint':
    case 'context':
    case 'diff':
      return t('superAgent.commandNotAvailableHere')

    case 'theme': {
      const currentTheme = settingsStore.appearance.theme
      const isDark = currentTheme === 'dark' || currentTheme === 'anthropic-dark'
      settingsStore.updateAppearance({ theme: isDark ? 'light' : 'dark' })
      return isDark ? t('chatPanel.commandThemeLight') : t('chatPanel.commandThemeDark')
    }

    case 'vim':
      return t('chatPanel.commandVimWip')

    case 'keybindings':
      return generateKeybindingsMessage(t)

    default: {
      const cmdDef = findCommand(command)
      if (cmdDef && (cmdDef.kind === 'sdk_command' || cmdDef.kind === 'codepilot_command')) {
        const fullCommand = args ? `/${command} ${args}` : `/${command}`
        await turnStore.sendMessage(fullCommand, fullCommand, {
          files: [],
          images: [],
        }, { sessionId: sid })
        return ''
      }
      return t('chatPanel.commandUnknown', { command })
    }
  }
}

// ── 工具问答 / 授权：与主聊天同源，按 routerSessionId 寻址 ──
async function handleToolSubmit(messageId: string, toolId: string, updatedInput: Record<string, unknown>) {
  const sid = routerSessionId.value
  if (!sid) return
  if (turnStore.hasPendingPermissionForToolUse(toolId)) {
    await turnStore.allowPermission(messageId, toolId, updatedInput)
    return
  }
  const answers = (updatedInput?.answers as Record<string, string> | undefined) ?? {}
  await turnStore.submitToolAnswer(sid, messageId, toolId, answers)
}

async function handleToolSkip(messageId: string, toolId: string) {
  const sid = routerSessionId.value
  if (!sid) return
  if (turnStore.hasPendingPermissionForToolUse(toolId)) {
    await turnStore.denyPermission(messageId, toolId, 'User skipped')
    return
  }
  await turnStore.skipToolAnswer(sid, messageId, toolId)
}
</script>

<style scoped lang="scss">
.super-agent-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

// ── 系统问题入口（T13）：顶部汇总计数 + 只读面板开关 ──
.health-entry {
  display: flex;
  justify-content: flex-end;
  padding: 6px 12px 0;
}

.health-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border-light);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  &.open {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  .count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--accent-primary);
    color: var(--bg-elevated);
    font-weight: 600;
    line-height: 18px;
    text-align: center;
  }
}

.super-agent-health {
  margin: 6px 12px 0;
}

.super-agent-empty {
  margin: auto;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  padding: 32px 24px;
}

.empty-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  color: var(--accent-primary);
  background: var(--surface-glass);
  border: 1px solid var(--border-subtle);
}

h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

p {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.super-agent-messages {
  // MessageList 内部靠 flex:1 + min-height:0 建立滚动高度链，父级必须是 flex 容器
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.super-agent-composer {
  flex-shrink: 0;

  // 宿主裁剪：项目/分支切换工具条属于主聊天（Super Agent 绑定固定的 repoRoot）
  :deep(.context-toolbar-row) {
    display: none;
  }
}
</style>
