<!--
  单条 GenUI 卡片的宿主外壳。

  只做四件事：把卡片 iframe 的授权面钉死在 `allow-scripts`、跑宿主桥的握手、
  失败时给这一张卡（且只有这一张卡）错误占位与重试、把已通过桥校验的动作交给平台适配器。
  卡片内部的一切由 opaque origin 的沙箱文档负责，主文档不参与渲染卡片内容。

  展开在同一组件的弹窗内新起一个沙箱实例（schema 仍经 postMessage 注入），
  原 iframe 留在原位不动 —— 关闭弹窗就是回到展开前的那张卡。
-->
<template>
  <div class="genui-card" :data-state="state.status" :data-theme="theme">
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

    <div v-if="showExpand" class="genui-card-actions">
      <button
        ref="expandButtonRef"
        type="button"
        class="genui-card-expand"
        @click="openExpanded"
      >{{ t('genui.actions.expand') }}</button>
    </div>

    <p v-if="actionError" class="genui-card-action-error" role="alert">
      {{ t(`genui.actions.${actionError}`) }}
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
/** 复制/外链失败留在卡片下方，不把整张卡换成错误态 */
const actionError = ref<'copyFailed' | 'linkFailed' | null>(null)
const expanded = ref(false)
const expandButtonRef = ref<HTMLButtonElement | null>(null)
const closeButtonRef = ref<HTMLButtonElement | null>(null)

let bridge: CardBridge | null = null

const docUrl = computed(() => props.source?.docUrl ?? '')
const frameStyle = computed(() => (frameHeight.value ? { height: `${frameHeight.value}px` } : {}))
const showFrame = computed(() => props.source !== null && state.value.status !== 'error')
const showExpand = computed(
  () => props.expandable !== false && props.source !== null && state.value.status === 'ready',
)
const canRetry = computed(() => state.value.status === 'error' && state.value.failure !== 'unsupported-origin')
const errorText = computed(() =>
  state.value.status === 'error' ? t(`genui.errors.${state.value.failure}`) : '',
)

/** 适配器一直不回执也要收口：用同一个时限把卡片换成可重试的错误占位。 */
class ActionTimeoutError extends Error {}

function withTimeout(task: Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ActionTimeoutError('card action timed out')),
      GENUI_ACTION_TIMEOUT_MS,
    )
    task.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function runAction(action: CardAction): Promise<void> {
  actionError.value = null
  if (action.action === 'expand') {
    openExpanded()
    return
  }
  // submit 在本票只保留白名单与校验骨架；提交回环见票 04
  if (action.action === 'submit') return

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
    actionError.value = action.action === 'copy' ? 'copyFailed' : 'linkFailed'
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
    },
  })
  bridge.start()
}

async function retry(): Promise<void> {
  if (!props.source) return
  detach()
  state.value = { status: 'connecting' }
  frameHeight.value = 0
  actionError.value = null
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
