<template>
  <div class="super-agent-view">
    <!-- 顶部操作区（T13 #83）：系统问题汇总入口（只读面板，MVP 不可操作）。
         派工不再有独立入口 —— Router 已能按对话建单（super-agent:route），
         两个入口并存只会让人纠结"该在这儿填还是跟它说"。 -->
    <header class="health-entry">
      <div class="entry-group">
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
      </div>
    </header>

    <!-- Router 工卡：夹在消息区上沿，折叠态只报「这些话落在哪个目录」 -->
    <RouterWorkBadge v-if="routerSessionId" />

    <!-- 执行队列（T05）：串行调度现状，running + 排队位置 + 脏区提示，广播驱动。 -->
    <div
      v-if="queueVisible"
      class="dispatch-queue"
      data-testid="super-agent-queue"
    >
      <div class="queue-heading">{{ t('superAgent.queue.title') }}</div>
      <!-- 点击条目在右侧打开 Worker 只读标签（T07 #77）：多标签并存、只读不接管 -->
      <div
        v-for="entry in queueEntries"
        :key="entry.ticketId"
        class="queue-entry"
        :data-state="entry.state"
        :data-testid="`super-agent-queue-entry-${entry.ticketId}`"
        role="button"
        tabindex="0"
        @click="appStore.openWorkerTab(entry.ticketId, entry.title)"
        @keydown.enter.prevent="appStore.openWorkerTab(entry.ticketId, entry.title)"
      >
        <span class="queue-title">{{ entry.title }}</span>
        <span class="queue-state">
          {{ entry.state === 'running'
            ? t('superAgent.queue.running')
            : `${t('superAgent.queue.queued')} · ${t('superAgent.queue.position', { position: entry.position })}` }}
        </span>
        <span v-if="entry.dirty" class="queue-dirty">{{ t('superAgent.queue.dirtyHint') }}</span>
      </div>
    </div>

    <!-- 健康面板（T13 #83，T20 #90 升级为可操作）：重试/忽略/重新评估。 -->
    <template v-if="superAgentStore.healthPanelOpen">
      <SuperAgentHealth
        :problems="superAgentStore.healthProblems"
        @retry="handleHealthRetry"
        @dismiss="handleHealthDismiss"
        @reevaluate="handleHealthReevaluate"
      />
      <p
        v-if="healthActionHint"
        class="health-action-hint"
        :class="{ failed: healthActionFailed }"
        data-testid="super-agent-health-action-hint"
      >
        {{ healthActionHint }}
      </p>
    </template>

    <!-- Router 已绑定：复用主聊天时间线 + Composer。Router 是唯一对话者，
         loading/中止都按 routerSessionId 寻址 —— 不会触碰任何 Worker。
         工单单位（卡片 + 该单的 Worker 提问 + 待验收超时提醒）按创建时间锚定在
         派工那条助手回复下方；早于整段对话的旧单钳到最早那条回复，只有助手回复
         全部缺失时才整体落在末尾。 -->
    <template v-if="routerSessionId">
      <div class="super-agent-messages">
        <MessageList
          :messages="messages"
          :loading="isLoading"
          :session-id="routerSessionId"
          presentation="im"
          @tool-submit="handleToolSubmit"
          @tool-skip="handleToolSkip"
        >
          <template #assistant-group="{ group }">
            <div v-if="cardsForGroup(group.messages).length" class="ticket-cards" data-testid="super-agent-tickets">
              <TicketTimelineEntry
                v-for="card in cardsForGroup(group.messages)"
                :key="card.ticketId"
                :card="card"
                :progress="superAgentStore.ticketProgress[card.ticketId] ?? null"
                :attentions="attentionsByTicket.get(card.ticketId) ?? []"
                :review-reminder="reviewReminderByTicket.get(card.ticketId) ?? null"
                @open="handleTicketOpen"
                @accept="handleTicketAccept"
                @stop="handleTicketStop"
                @retry="handleTicketRetry"
                @message="handleTicketMessage"
              />
            </div>
          </template>
          <template #append>
            <!-- 历史缺失时只在末尾展示一次；动作失败提示也始终保留。 -->
            <div
              v-if="unanchoredCards.length || orphanAttentions.length"
              class="ticket-cards"
              data-testid="super-agent-tickets"
            >
              <TicketTimelineEntry
                v-for="card in unanchoredCards"
                :key="card.ticketId"
                :card="card"
                :progress="superAgentStore.ticketProgress[card.ticketId] ?? null"
                :attentions="attentionsByTicket.get(card.ticketId) ?? []"
                :review-reminder="reviewReminderByTicket.get(card.ticketId) ?? null"
                @open="handleTicketOpen"
                @accept="handleTicketAccept"
                @stop="handleTicketStop"
                @retry="handleTicketRetry"
                @message="handleTicketMessage"
              />
              <!-- 卡片已不在看板上（清理/断档）时，提问仍落在末尾，不能静默消失 -->
              <AttentionBubble
                v-for="bubble in orphanAttentions"
                :key="bubble.attentionId"
                :attention="bubble"
              />
            </div>
            <p v-if="ticketActionHint" class="ticket-action-hint" data-testid="super-agent-ticket-action-hint">
              {{ ticketActionHint }}
            </p>
          </template>
        </MessageList>
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
import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { HeartPulse, Sparkles } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import { useSuperAgentStore } from '@/stores/superAgent'
import { createUuid } from '@/utils/uuid'
import type {
  SuperAgentAttentionView,
  SuperAgentQueueEntry,
  SuperAgentTicketCard,
} from '@/shared/channels/superAgent'
import type { SuperAgentReviewReminderItem } from '@/stores/superAgent'
import MessageList from '../chat/MessageList.vue'
import ChatInput, { type AllAttachments, type SendOptions } from '../chat/ChatInput.vue'
import SuperAgentHealth from './SuperAgentHealth.vue'
import AttentionBubble from './AttentionBubble.vue'
import TicketTimelineEntry from './TicketTimelineEntry.vue'
import RouterWorkBadge from './RouterWorkBadge.vue'
import { buildOutgoingMessage } from '@/lib/composer-outgoing'
import {
  generateCostMessage,
  generateHelpMessage,
  generateKeybindingsMessage,
} from '@/lib/slashCommandMessages'
import { findCommand } from '@/lib/constants/commands'
import type { EffortLevel } from '@/shared/effort'
import type { Message } from '@/types'

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

/**
 * Router turn 进行中：真源是主进程 RouterRunner 的 router-status（会话归它），
 * 不是本地 turn —— 渲染端只是观察者，关掉窗口也不影响 Router 收尾。
 */
const isLoading = computed(() => superAgentStore.routerRunning)

/**
 * 输入框 @ 上下文读的工作目录 = 本页绑定的项目根（主进程那份快照才是引擎真正的 cwd）。
 * 不读实时项目指针：切项目的瞬间若这里先动，@ 文件列表会指向还没绑定的目录。
 */
const workingDirectory = computed(() => superAgentStore.boundRepoRoot ?? undefined)

// ── 健康上报（T13 #83）：拉取 + 订阅 health.changed，渲染端只读 ──
let stopWatchingHealth: (() => void) | null = null
let stopWatchingQueue: (() => void) | null = null
// ── 工单卡片（T06 #76）：全量拉取 + ticket-updated/progress 订阅 ──
let stopWatchingTickets: (() => void) | null = null
// ── Attention 气泡（T08 #78）：全量拉取 + asked/answered/withdrawn 订阅 ──
let stopWatchingAttentions: (() => void) | null = null
// ── Router 轮次状态（T21）：会话归主进程，typing/停止按钮跟着 router-status 走 ──
let stopWatchingRouterStatus: (() => void) | null = null
let unmounted = false
let subscriptionsStarted = false

/**
 * 跟随全局项目指针换作用域。
 *
 * 本组件是"粘住的 v-if + v-show"挂载的（ChatPanel 里 superAgentMounted 一旦为真
 * 就不再回 false），切项目不会重挂，所以项目变化只能靠 watch 显式重绑。
 *
 * 次序有讲究：switchProject 先确立 store 的项目过滤域，订阅随即建好，再拉五面镜像 ——
 * 订阅若等慢快照全部返回，期间到达的工单/队列事件就丢了。订阅只建一次：
 * 各 watch* 都按 snapshot.repoRoot 丢弃不属于当前项目的事件，换根后自动只认新项目。
 */
async function followProjectRoot(repoRoot: string): Promise<void> {
  await superAgentStore.switchProject(repoRoot)
  if (!repoRoot) return
  if (unmounted) return
  if (!subscriptionsStarted) {
    subscriptionsStarted = true
    stopWatchingHealth = superAgentStore.watchHealth()
    stopWatchingQueue = superAgentStore.watchQueue()
    stopWatchingTickets = superAgentStore.watchTickets()
    stopWatchingAttentions = superAgentStore.watchAttentions()
    stopWatchingRouterStatus = superAgentStore.watchRouterStatus()
  }
  await Promise.all([
    superAgentStore.loadState(repoRoot),
    superAgentStore.loadHealth(repoRoot),
    superAgentStore.loadQueue(repoRoot),
    superAgentStore.loadTickets(repoRoot),
    superAgentStore.loadAttentions(repoRoot),
  ])
}

onMounted(() => followProjectRoot(appStore.projectRoot))

watch(() => appStore.projectRoot, root => { void followProjectRoot(root) })

onUnmounted(() => {
  unmounted = true
  stopWatchingHealth?.()
  stopWatchingHealth = null
  stopWatchingQueue?.()
  stopWatchingQueue = null
  stopWatchingTickets?.()
  stopWatchingTickets = null
  stopWatchingAttentions?.()
  stopWatchingAttentions = null
  stopWatchingRouterStatus?.()
  stopWatchingRouterStatus = null
})

/** 看板卡片（T06）：排序沿用主进程投影（createdAt 升序）。 */
const ticketCards = computed<SuperAgentTicketCard[]>(() =>
  superAgentStore.ticketBoard?.tickets ?? [],
)

// 按创建时间锚定回复，后续报告和闲聊不能把旧工单拖到末尾。
const ticketAnchors = computed(() => {
  const assistants = messages.value.filter(message => message.role === 'assistant' && Number.isFinite(message.timestamp))
  // 使用消息引用而非 id：历史恢复可能带有重复 id，不能让一张卡出现在两组。
  const anchors = new Map<string, Message>()
  for (const card of ticketCards.value) {
    const createdAt = Date.parse(card.createdAt)
    let closest: Message | undefined
    for (const message of assistants) {
      if (message.timestamp <= createdAt && (!closest || message.timestamp >= closest.timestamp)) {
        closest = message
      }
    }
    // 早于整段对话的工单（由主聊天/IM 派发，Router 转录里没有它那一轮）钳到最早的
    // 助手回复：卡片顺序跟着 createdAt 走才读得通。挂到末尾等于宣称最新这条回复
    // 刚产出了一张旧单 —— 上一轮那张「已停止」的卡片就是这样把人骗到的。
    const anchor = closest ?? assistants[0]
    if (anchor) anchors.set(card.ticketId, toRaw(anchor))
  }
  return anchors
})

function cardsForGroup(groupMessages: Message[]): SuperAgentTicketCard[] {
  const members = new Set(groupMessages.map(message => toRaw(message)))
  return ticketCards.value.filter(card => {
    const anchor = ticketAnchors.value.get(card.ticketId)
    return anchor !== undefined && members.has(anchor)
  })
}

const unanchoredCards = computed(() =>
  ticketCards.value.filter(card => !ticketAnchors.value.has(card.ticketId)),
)

// ── 工单提醒随卡片进时间线（T08 #78 / T10 #80）：都按 ticketId 归到所属工单位，
//    顶部不再挂一份「提问 + 超时提醒」列表；计数仍由侧边栏入口徽章承担。 ──
const attentionsByTicket = computed(() => {
  const grouped = new Map<string, SuperAgentAttentionView[]>()
  for (const view of superAgentStore.attentionBubbles) {
    const list = grouped.get(view.ticketId)
    if (list) list.push(view)
    else grouped.set(view.ticketId, [view])
  }
  return grouped
})

const reviewReminderByTicket = computed(() => {
  const grouped = new Map<string, SuperAgentReviewReminderItem>()
  for (const item of superAgentStore.reviewReminders) grouped.set(item.ticketId, item)
  return grouped
})

/** 看板里已经没有这张卡（清理/断档）时，提问兜底落在末尾，不能静默消失。 */
const orphanAttentions = computed(() => {
  const known = new Set(ticketCards.value.map(card => card.ticketId))
  return superAgentStore.attentionBubbles.filter(view => !known.has(view.ticketId))
})

// ── T10 #80：review 出口（验收/停止/继续追问/重试）—— 委托 store 落库，
//    失败给出非模态提示；错误经 IPC 序列化，展示原始信息便于定位。 ──
const ticketActionHint = ref('')

async function runTicketAction(action: () => Promise<unknown>): Promise<void> {
  ticketActionHint.value = ''
  try {
    await action()
  } catch (error) {
    console.error('[SuperAgentView] ticket action failed:', error)
    ticketActionHint.value = t('superAgent.ticket.actionFailedHint', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function handleTicketAccept(ticketId: string): void {
  const repoRoot = superAgentStore.boundRepoRoot
  if (!repoRoot) return
  void runTicketAction(() => superAgentStore.acceptTicket(repoRoot, ticketId))
}

/**
 * 点击卡片 → 打开 worker:<ticketId> 右侧标签（§10.3）。
 * 执行队列只覆盖 running/queued，失败与已完成的工单同样要能查执行历史 ——
 * 卡片是唯一始终在场的入口，不能只在排队时可点。
 */
function handleTicketOpen(ticketId: string): void {
  const card = ticketCards.value.find((item) => item.ticketId === ticketId)
  if (!card) return
  appStore.openWorkerTab(card.ticketId, card.title)
}

function handleTicketStop(ticketId: string): void {
  const repoRoot = superAgentStore.boundRepoRoot
  if (!repoRoot) return
  void runTicketAction(() => superAgentStore.stopTicket(repoRoot, ticketId))
}

function handleTicketRetry(ticketId: string): void {
  const repoRoot = superAgentStore.boundRepoRoot
  if (!repoRoot) return
  void runTicketAction(() => superAgentStore.retryTicket(repoRoot, ticketId))
}

function handleTicketMessage(payload: { ticketId: string; text: string }): void {
  const repoRoot = superAgentStore.boundRepoRoot
  if (!repoRoot) return
  void runTicketAction(() =>
    superAgentStore.messageTicket(repoRoot, {
      requestId: createUuid(),
      ticketId: payload.ticketId,
      text: payload.text,
    }),
  )
}

// ── T20 #90：健康处置出口（重试/忽略/重新评估）—— 委托 store 落库与
//    领域处置，成功/失败都以非模态提示回显（状态回显）。 ──
const healthActionHint = ref('')
const healthActionFailed = ref(false)

async function runHealthAction(action: () => Promise<unknown>, successKey: string): Promise<void> {
  healthActionHint.value = ''
  healthActionFailed.value = false
  try {
    await action()
    healthActionHint.value = t(successKey)
  } catch (error) {
    console.error('[SuperAgentView] health action failed:', error)
    healthActionFailed.value = true
    healthActionHint.value = t('superAgent.health.actionFailedHint', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function handleHealthRetry(category: string, subjectId: string | null): void {
  const repoRoot = superAgentStore.boundRepoRoot
  if (!repoRoot) return
  void runHealthAction(
    () => superAgentStore.retryHealthProblem(repoRoot, category, subjectId),
    'superAgent.health.retryDone',
  )
}

function handleHealthDismiss(category: string, subjectId: string | null): void {
  const repoRoot = superAgentStore.boundRepoRoot
  if (!repoRoot) return
  void runHealthAction(
    () => superAgentStore.dismissProblem(repoRoot, category, subjectId),
    'superAgent.health.dismissDone',
  )
}

function handleHealthReevaluate(evalId: string): void {
  const repoRoot = superAgentStore.boundRepoRoot
  if (!repoRoot) return
  void runHealthAction(
    () => superAgentStore.reevaluateEval(repoRoot, evalId),
    'superAgent.health.reevaluateDone',
  )
}

// ── 执行队列（T05）：running + 排队位，广播驱动；派工本身只由对话驱动 ──
const queueEntries = computed<SuperAgentQueueEntry[]>(() => [
  ...(superAgentStore.queue?.running ?? []),
  ...(superAgentStore.queue?.queued ?? []),
])
const queueVisible = computed(() => queueEntries.value.length > 0)

// ── 模型展示与切换（与主聊天同一口径）───────────────────────────
// Router 会话归主进程，渲染端够不到 sessionStore.switchModel —— 选择只能随
// 每条消息下发，由 RouterRunner 落到引擎上；不下发就等于下拉框是装饰品。
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
  settingsStore.lastSelectedModel = model
  settingsStore.saveSettings()
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

// ── 发送 / 中止：交给主进程 RouterRunner（T21）──────────────────
// 正文组装仍与主聊天共用同一份（marker 与附件格式逐字一致），但投递通路不同：
// Router 会话归主进程且工具面为空，走 turnStore 就等于把它降格成一条
// 带全套写工具的普通聊天 —— 那正是"让它派活它自己干了"的根因。
async function handleSend(content: string, attachments: AllAttachments, options?: SendOptions) {
  const repoRoot = superAgentStore.boundRepoRoot
  if (!repoRoot) return
  const hasContent = content.trim().length > 0 || attachments.files.length > 0 || attachments.images.length > 0
  if (!hasContent) return

  const { messageContent, userContent } = buildOutgoingMessage(content, attachments, options)
  try {
    await superAgentStore.sendRouterMessage(repoRoot, {
      requestId: createUuid(),
      text: messageContent,
      displayText: userContent,
      ...(currentModel.value ? { model: currentModel.value } : {}),
      ...(attachments.images.length > 0 ? { images: attachments.images } : {}),
    })
  } catch (error) {
    console.error('[SuperAgentView] routerMessage failed:', error)
  }
}

async function handleStop() {
  const repoRoot = superAgentStore.boundRepoRoot
  if (!repoRoot) return
  try {
    // 只中止 Router 这一轮；Worker 会话由各自的 Assignment 管理，不受影响
    await superAgentStore.abortRouter(repoRoot)
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
      const repoRoot = superAgentStore.boundRepoRoot
      if (!repoRoot) return ''
      // 中止也走 Router 通路：turnStore.abort 按普通聊天会话寻址，会漏掉主进程那一轮
      await superAgentStore.abortRouter(repoRoot)
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
        const repoRoot = superAgentStore.boundRepoRoot
        if (!repoRoot) return ''
        const fullCommand = args ? `/${command} ${args}` : `/${command}`
        // 仍走 Router 通路：turnStore.sendMessage 会按普通聊天的配置去 init 引擎，
        // 把这条常驻会话（空工具面 + 角色说明）就地换掉。
        await superAgentStore.sendRouterMessage(repoRoot, {
          requestId: createUuid(),
          text: fullCommand,
          displayText: fullCommand,
        })
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
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

// ── 顶部操作区（T13 健康入口 + T05 新建工单入口 + T08 待处理计数）──
.health-entry {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px 0;
}

.entry-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
}

.health-chip .count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent-primary);
  color: var(--bg-elevated);
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}

// ── 执行队列（T05）：串行调度现状（执行中/排队位置/脏区提示）──
.dispatch-queue {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 12px 0;
  padding: 8px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-elevated);
  font-size: 12px;
}

.queue-heading {
  color: var(--text-secondary);
  font-weight: 600;
}

.queue-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-primary);
  /* 点击打开 Worker 只读标签（T07 #77）：可点击态 */
  cursor: pointer;
  border-radius: 6px;

  &:hover,
  &:focus-visible {
    background: var(--surface-hover);
  }
}

.queue-state {
  color: var(--text-secondary);
}

.queue-entry[data-state='running'] .queue-state {
  color: var(--accent-primary);
}

.queue-dirty {
  color: var(--text-secondary);
}

.super-agent-health {
  margin: 6px 12px 0;
}

// ── 工单单位（卡片 + 提问 + 超时提醒）：挂在所属助手回复下方，缺历史的在末尾兜底，随时间线滚动 ──
.ticket-cards {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 0;
}

// T10 #80：出口动作失败的非模态提示（同在时间线末尾）
.ticket-action-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--status-error, #d4564d);
}

// ── T20 #90：健康处置回显 —— 成功为中性提示，失败为错误色 ──
.health-action-hint {
  margin: 4px 12px 0;
  font-size: 12px;
  color: var(--text-muted);

  &.failed {
    color: var(--status-error, #d4564d);
  }
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
