<!--
  单条 GenUI 卡片的宿主外壳。

  只做四件事：把卡片 iframe 的授权面钉死在 `allow-scripts`、跑宿主桥的握手、
  失败时给这一张卡（且只有这一张卡）错误占位与重试、把已通过桥校验的动作交给平台适配器。
  卡片内部的一切由 opaque origin 的沙箱文档负责，主文档不参与渲染卡片内容。

  已提交的卡片保留 iframe 但整层 inert：卡片画面上方盖一条摘要带，只读由宿主判定，
  不靠沙箱自己「禁用按钮」。提交失败留在下方错误行，画面保持可编辑（票 04）。

  展开在同一组件的弹窗内新起一个沙箱实例（schema 仍经 postMessage 注入），
  原 iframe 留在原位不动 —— 关闭弹窗就是回到展开前的那张卡。
-->
<template>
  <div
    class="genui-card"
    :data-state="state.status"
    :data-theme="theme"
    :data-submitted="card.submitted ? 'true' : undefined"
  >
    <iframe
      v-if="showFrame"
      :key="frameToken"
      ref="frameRef"
      class="genui-card-frame"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      :src="docUrl"
      :style="frameStyle"
      :title="t('genui.cardLabel')"
      :inert="isReadonly || undefined"
    ></iframe>

    <div v-else class="genui-card-error" role="alert">
      <span class="genui-card-error-text">{{ errorText }}</span>
      <button
        v-if="canRetry"
        type="button"
        class="genui-card-retry"
        @click="retry"
      >{{ t('genui.retry') }}</button>
    </div>

    <p v-if="isReadonly" class="genui-card-submitted" role="status">
      {{ card.submitted?.summary }}
    </p>

    <div v-if="showExpand" class="genui-card-actions">
      <button
        ref="expandButtonRef"
        type="button"
        class="genui-card-expand"
        @click="openExpanded"
      >{{ t('genui.actions.expand') }}</button>
    </div>

    <p v-if="actionErrorKey" class="genui-card-action-error" role="alert">
      {{ actionErrorText }}
    </p>

    <div v-if="expanded" class="genui-card-expand-backdrop" @click.self="closeExpanded">
      <div
        class="genui-card-expand-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('genui.actions.expandTitle')"
      >
        <div class="genui-card-expand-header">
          <span class="genui-card-expand-title">{{ t('genui.actions.expandTitle') }}</span>
          <button
            ref="closeButtonRef"
            type="button"
            class="genui-card-expand-close"
            @click="closeExpanded"
          >{{ t('genui.actions.expandClose') }}</button>
        </div>
        <!-- schema 只进这个新沙箱；expandable=false 防止弹窗里再套一层 -->
        <GenuiCardFrame
          :card="card"
          :source="source"
          :theme="theme"
          :locale="locale"
          :action-port="actionPort"
          :submit-card="submitCard"
          :expandable="false"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createCardBridge, type CardBridge, type CardBridgeState } from '@/lib/genui/cardBridge'
import { resolveCardActionPort, type CardActionPort } from '@/lib/genui/cardActionAdapters'
import type { CardAction } from '@/lib/genui/cardActions'
import type { GenuiCardSubmissionResult } from '@/lib/genui/cardSubmission'
import { GENUI_ACTION_TIMEOUT_MS, type GenuiTheme } from '@/shared/genuiSandbox'
import type { GenuiCardRecord, SandboxSource } from '@/types/genui'

const props = withDefaults(defineProps<{
  card: GenuiCardRecord
  /** 沙箱源；null 表示当前宿主还没有接入沙箱（H5 在票 06 接入） */
  source: SandboxSource | null
  theme: GenuiTheme
  locale: string
  /** 平台适配器；测试注入，生产按当前宿主（桌面 IPC / H5 浏览器）解析 */
  actionPort?: CardActionPort
  /**
   * 提交端口（票 04），由分组按这张卡的 id 绑定好再传进来。
   * 缺省 = 当前宿主没接提交，submit 只在桥口被校验掉，不动任何状态。
   */
  submitCard?: (payload: Record<string, unknown>) => Promise<GenuiCardSubmissionResult>
  /** 弹窗内的实例为 false，避免展开里再套展开 */
  expandable?: boolean
}>(), {
  // 布尔 prop 缺省时 Vue 会按 false 处理，这里必须显式给 true
  expandable: true,
})

const { t } = useI18n()

const frameRef = ref<HTMLIFrameElement | null>(null)
const frameToken = ref(0)
/** 沙箱报来的内容高度；没报到之前沿用样式里的占位高度 */
const frameHeight = ref(0)
const state = ref<CardBridgeState>(
  props.source ? { status: 'connecting' } : { status: 'error', failure: 'unsupported-origin' },
)
/**
 * 动作与提交的失败都留在卡片下方一行，不把整张卡换成错误态 ——
 * 沙箱里填了一半的表单不能被宿主一次失败抹掉。存的是 i18n key：
 * 动作侧与提交侧的文案分属两个命名空间，reason 原名不足以定位。
 */
const actionErrorKey = ref<string | null>(null)
const expanded = ref(false)
const expandButtonRef = ref<HTMLButtonElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)

let bridge: CardBridge | null = null

const docUrl = computed(() => props.source?.docUrl ?? '')
const frameStyle = computed(() => (frameHeight.value ? { height: `${frameHeight.value}px` } : {}))
const showFrame = computed(() => props.source !== null && state.value.status !== 'error')
/** 只读由 metadata 决定：已提交的卡片 inert，再点也发不出 submit */
const isReadonly = computed(() => !!props.card.submitted)
const showExpand = computed(
  () => props.expandable !== false && props.source !== null && state.value.status === 'ready',
)
const canRetry = computed(() => state.value.status === 'error' && state.value.failure !== 'unsupported-origin')
const errorText = computed(() =>
  state.value.status === 'error' ? t(`genui.errors.${state.value.failure}`) : '',
)
const actionErrorText = computed(() => (actionErrorKey.value ? t(actionErrorKey.value) : ''))

/** 适配器一直不回执也要收口：用同一个时限把卡片换成可重试的错误占位。 */
class ActionTimeoutError extends Error {}

function withTimeout<T>(task: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ActionTimeoutError('card action timed out')),
      GENUI_ACTION_TIMEOUT_MS,
    )
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * 提交：只等端口给出结果，不等整轮回复收口。
 * 端口抛错（引擎不可用）与超时都算发送失败 —— 卡片保持可编辑，用户还能再提交一次。
 */
async function runSubmit(payload: Record<string, unknown>): Promise<void> {
  if (!props.submitCard || isReadonly.value) return
  try {
    const result = await withTimeout(props.submitCard(payload))
    // 成功路径不写状态：metadata 上的 submitted 由 host 落库，记录流回这里才变只读。
    if (result.status === 'failed') actionErrorKey.value = `genui.submission.failed.${result.reason}`
  } catch (err) {
    actionErrorKey.value = err instanceof ActionTimeoutError
      ? 'genui.submission.failed.timeout'
      : 'genui.submission.failed.send-failed'
  }
}

async function runAction(action: CardAction): Promise<void> {
  actionErrorKey.value = null
  if (action.action === 'expand') {
    openExpanded()
    return
  }
  if (action.action === 'submit') {
    await runSubmit(action.payload)
    return
  }

  const port = props.actionPort ?? resolveCardActionPort()
  const task = action.action === 'copy' ? port.copyText(action.text) : port.openExternal(action.url)

  try {
    await withTimeout(task)
  } catch (err) {
    if (err instanceof ActionTimeoutError) {
      expanded.value = false
      detach()
      state.value = { status: 'error', failure: 'action-timeout' }
      return
    }
    actionErrorKey.value = action.action === 'copy' ? 'genui.actions.copyFailed' : 'genui.actions.linkFailed'
  }
}

function openExpanded(): void {
  if (!showExpand.value) return
  expanded.value = true
  void nextTick(() => closeButtonRef.value?.focus())
}

function closeExpanded(): void {
  if (!expanded.value) return
  expanded.value = false
  void nextTick(() => expandButtonRef.value?.focus())
}

function detach(): void {
  bridge?.dispose()
  bridge = null
}

function attach(): void {
  detach()
  const frame = frameRef.value
  if (!frame || !props.source) return
  bridge = createCardBridge({
    iframe: frame,
    schema: props.card.schema,
    theme: props.theme,
    locale: props.locale,
    protocolVersion: props.card.protocolVersion,
    onStateChange: (next) => {
      state.value = next
    },
    onResize: (height) => {
      frameHeight.value = height
    },
    onAction: (action) => {
      void runAction(action)
    },
    onIgnoredMessage: (ignored) => {
      // 不转发到通用 IPC：只在本卡留一条记录，便于排查某个动作为什么没生效
      console.warn('[genui] ignored card message', ignored)
      if (ignored.type !== 'action') return
      // 桥口拒绝的原因里只有「装不下」值得通知用户：那是卡片真想递的内容被闸门拦下。
      // 未知动作与非法外链是沙箱越界，静默丢弃即可 —— 给文案等于替不可信代码向用户喊话。
      if (ignored.reason === 'oversized') actionErrorKey.value = 'genui.actions.oversized'
    },
  })
  bridge.start()
}

async function retry(): Promise<void> {
  if (!props.source) return
  detach()
  state.value = { status: 'connecting' }
  frameHeight.value = 0
  actionErrorKey.value = null
  // 换 key 重建 iframe：重试等价于重新加载卡片文档，而不是在旧 frame 上补发消息
  frameToken.value += 1
  await nextTick()
  attach()
}

watch(
  () => [props.theme, props.locale] as const,
  () => {
    bridge?.pushAppearance({ theme: props.theme, locale: props.locale })
  },
)

onMounted(attach)
onBeforeUnmount(detach)
</script>

<style lang="scss" scoped>
.genui-card {
  /* 卡片宽度受消息列约束：min-width:0 让它能跟着父容器收缩，不撑破气泡行 */
  max-width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.genui-card-frame {
  display: block;
  width: 100%;
  min-width: 0;
  height: 260px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-secondary);
}

.genui-card-error {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px dashed var(--surface-border);
  border-radius: var(--radius-md, 8px);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.genui-card-error-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.genui-card-actions {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
}

.genui-card-action-error {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}

.genui-card-retry,
.genui-card-expand,
.genui-card-expand-close {
  flex: 0 0 auto;
  padding: 3px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--accent-primary);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: background var(--transition-fast);

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }
}

.genui-card-expand-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(0 0 0 / 45%);
}

.genui-card-expand-dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(960px, 100%);
  max-height: 100%;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-primary);
}

.genui-card-expand-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.genui-card-expand-title {
  min-width: 0;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 600;
}
</style>
