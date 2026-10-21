<template>
  <div v-if="shouldRender" class="plan-complete-card">
    <div class="plan-head">
      <div class="p-icon">
        <ClipboardCheck :size="15" />
      </div>
      <div class="p-title">
        <h3>{{ t('planMode.plan.title') }}</h3>
        <span>{{ t('planMode.plan.subtitle') }}</span>
      </div>
      <span class="state-pill" :class="pill.tone">{{ pill.text }}</span>
    </div>

    <div v-if="sections.length > 1" class="plan-toc">
      <button
        v-for="(section, sIndex) in sections"
        :key="sIndex"
        class="toc-item"
        :class="{ active: sIndex === activeSectionIndex }"
        type="button"
        @click="scrollToSection(sIndex)"
      >
        {{ section.text }}
      </button>
    </div>

    <div ref="planBodyEl" class="plan-body" :class="{ collapsed: !isExpanded }" @scroll="onBodyScroll">
      <MarkdownRenderer :content="planContent" class="plan-content" />
    </div>

    <div class="plan-foot">
      <span class="hint">{{ isExpanded ? t('planMode.plan.hintExpanded') : t('planMode.plan.hintCollapsed') }}</span>
      <button class="pf-btn" type="button" @click="toggleExpand">
        {{ isExpanded ? t('planMode.plan.collapse') : t('planMode.plan.expand') }}
      </button>
      <button class="pf-btn" type="button" @click="copyPlan">
        {{ copied ? t('planMode.plan.copied') : t('planMode.plan.copy') }}
      </button>
      <!-- TODO(plan-mode): 导出/存草稿需要宿主侧文件 API 与会话草稿存储，当前无数据源，不加假按钮 -->
      <template v-if="actionOptions.length > 0">
        <button
          v-for="(option, oIndex) in actionOptions"
          :key="option"
          class="pf-btn"
          :class="{ primary: oIndex === 0 }"
          type="button"
          :disabled="actionBusy"
          @click="handleAction(option)"
        >
          {{ option }}
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ClipboardCheck } from 'lucide-vue-next'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import { extensionDialogService } from '@/services/extensionDialogService'
import { useTurnStore } from '@/stores/turn'
import { matchPlanActionDialog } from '@/lib/planModeDialogMatcher'

/**
 * pi plan_mode_complete 的计划文档卡：Markdown 全文渲染 + 目录锚点 + 默认折叠
 * （120px 渐隐）+ 宿主侧复制。plan_mode_complete 返回后扩展还会发一帧
 * 标题含 "Plan mode" 的 select 行动菜单 —— 配对命中时把菜单选项渲染成行动条
 * 按钮（原文回传，宿主不替它编语义）；配对失败（历史回放 / 已应答）时只留
 * 展开与复制，绝不出现假按钮。
 */
const props = defineProps<{ toolCall: ToolCall }>()

const { t } = useI18n()
const turnStore = useTurnStore()

const planContent = computed(() => {
  const plan = props.toolCall.input?.plan
  return typeof plan === 'string' ? plan.trim() : ''
})

const shouldRender = computed(() => !!planContent.value)

// ── 状态徽标 ──
const pill = computed<{ text: string; tone: 'accent' | 'ok' | 'warn' | 'error' }>(() => {
  switch (props.toolCall.status) {
    case 'completed':
      return { text: t('planMode.plan.pillDone'), tone: 'ok' }
    case 'error':
      return { text: t('planMode.plan.pillError'), tone: 'error' }
    case 'running':
      return { text: t('planMode.plan.pillRunning'), tone: 'accent' }
    default:
      return { text: t('planMode.plan.pillPending'), tone: 'warn' }
  }
})

// ── 目录锚点：解析正文里的 ## / ### 标题（跳过代码围栏），与 DOM 里同类标题按下标对应 ──
interface PlanSection {
  text: string
}

function stripInline(text: string): string {
  return text.replace(/[*_`~]/g, '').trim()
}

const sections = computed<PlanSection[]>(() => {
  const result: PlanSection[] = []
  let inFence = false
  for (const line of planContent.value.split('\n')) {
    const trimmed = line.trim()
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^#{2,3}\s+(.+)$/.exec(trimmed)
    if (match) result.push({ text: stripInline(match[1]) })
  }
  return result
})

function headingElements(): HTMLElement[] {
  const body = planBodyEl.value
  if (!body) return []
  return Array.from(body.querySelectorAll('.md-heading')).filter(
    el => el.classList.contains('md-h2') || el.classList.contains('md-h3'),
  ) as HTMLElement[]
}

const planBodyEl = ref<HTMLElement | null>(null)
const isExpanded = ref(false)

function toggleExpand(): void {
  isExpanded.value = !isExpanded.value
}

const activeSectionIndex = ref(-1)

function scrollToSection(index: number): void {
  if (!isExpanded.value) isExpanded.value = true
  void nextTick(() => {
    const body = planBodyEl.value
    if (!body) return
    const target = headingElements()[index]
    if (!target) return
    const delta = target.getBoundingClientRect().top - body.getBoundingClientRect().top
    body.scrollTo({ top: Math.max(body.scrollTop + delta - 8, 0), behavior: 'smooth' })
  })
}

function onBodyScroll(): void {
  const body = planBodyEl.value
  if (!body) return
  const bodyTop = body.getBoundingClientRect().top
  let current = -1
  headingElements().forEach((heading, index) => {
    if (heading.getBoundingClientRect().top - bodyTop <= 24) current = index
  })
  activeSectionIndex.value = current
}

// ── 复制 Markdown（宿主侧剪贴板） ──
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function copyPlan(): Promise<void> {
  try {
    await navigator.clipboard.writeText(planContent.value)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // 剪贴板不可用时按钮文案不动，不打断阅读
  }
}

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

// ── 行动条：pending 的 plan-action select 帧（标题含 "Plan mode"） ──
const inFlightDialogIds = new Set<string>()
const actionDialog = computed(() =>
  extensionDialogService
    .listPending('select')
    .find(dialog => !inFlightDialogIds.has(dialog.dialogId) && matchPlanActionDialog(dialog)),
)
const actionOptions = computed<string[]>(() =>
  (actionDialog.value?.options ?? []).filter((option): option is string => typeof option === 'string' && option.length > 0),
)

const actionBusy = computed(() => !!actionDialog.value && inFlightDialogIds.has(actionDialog.value.dialogId))

/**
 * 行动条点击 = 按选项原文应答那一帧。store 先落回执再发 IPC，失败撤回 ——
 * 按钮保持可点，用户可原地重试（失败原因已在 store 日志里）。
 */
async function handleAction(option: string): Promise<void> {
  const dialog = actionDialog.value
  if (!dialog || inFlightDialogIds.has(dialog.dialogId)) return
  inFlightDialogIds.add(dialog.dialogId)
  try {
    await turnStore.answerExtensionDialog(dialog.sessionId, dialog.dialogId, { kind: 'value', value: option }, option)
  } catch {
    // 降级：应答失败保持按钮可点
  } finally {
    inFlightDialogIds.delete(dialog.dialogId)
  }
}
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

.plan-complete-card {
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  overflow: hidden;
  margin: 12px 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

// ── head ──
.plan-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-glass);
}

.p-icon {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  color: var(--accent-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.p-title {
  flex: 1;
  min-width: 0;

  h3 {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 1px;
  }

  span {
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
}

.state-pill {
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: var(--text-2xs);
  font-weight: 600;

  &.accent {
    color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  }

  &.ok {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 14%, transparent);
  }

  &.warn {
    color: var(--warning);
    background: color-mix(in srgb, var(--warning) 14%, transparent);
  }

  &.error {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 12%, transparent);
  }
}

// ── 目录锚点 ──
.plan-toc {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 9px 14px;
  border-bottom: 1px solid var(--surface-border);
}

.toc-item {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  &.active {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: #fff;
  }
}

// ── 正文：默认折叠 120px + 底部渐隐，展开后滚动阅读 ──
.plan-body {
  padding: 6px 16px 12px;
  max-height: 480px;
  overflow-y: auto;
  @include scrollbar-overlay;

  &.collapsed {
    max-height: 120px;
    overflow: hidden;
    position: relative;

    &::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 56px;
      background: linear-gradient(transparent, var(--surface-glass));
      pointer-events: none;
    }
  }
}

.plan-content {
  font-size: var(--text-md);
  line-height: var(--leading-prose);
  color: var(--text-secondary);

  :deep(.md-heading) {
    margin-top: 12px;
    margin-bottom: 8px;
    color: var(--text-primary);
  }

  :deep(.md-paragraph),
  :deep(.md-list) {
    margin-bottom: 8px;
  }

  :deep(.md-list) {
    padding-left: 20px;
  }

  :deep(pre.code-block) {
    margin: 8px 0;
  }
}

// ── footer：提示 + 展开/复制 + 行动条 ──
.plan-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px 10px;
  border-top: 1px solid var(--surface-border);
  background: var(--surface-glass);
  flex-wrap: wrap;
}

.hint {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  margin-right: auto;
  min-width: 0;
}

.pf-btn {
  padding: 5px 12px;
  border-radius: 6px;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid var(--border-strong);
  background: transparent;
  color: var(--text-secondary);
  transition: all 0.2s ease;
  flex-shrink: 0;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &:active:not(:disabled) {
    transform: scale(0.97);
  }

  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }

  &.primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: #fff;
    font-weight: 600;

    &:hover:not(:disabled) {
      opacity: 0.9;
      color: #fff;
    }
  }
}
</style>
