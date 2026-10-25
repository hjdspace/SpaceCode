<!--
  单条 GenUI 卡片的宿主外壳。

  只做三件事：把卡片 iframe 的授权面钉死在 `allow-scripts`、跑宿主桥的握手、
  失败时给这一张卡（且只有这一张卡）错误占位与重试。
  卡片内部的一切由 opaque origin 的沙箱文档负责，主文档不参与渲染卡片内容。
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
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createCardBridge, type CardBridge, type CardBridgeState } from '@/lib/genui/cardBridge'
import type { GenuiTheme } from '@/shared/genuiSandbox'
import type { GenuiCardRecord, SandboxSource } from '@/types/genui'

const props = defineProps<{
  card: GenuiCardRecord
  /** 沙箱源；null 表示当前宿主还没有接入沙箱（H5 在票 06 接入） */
  source: SandboxSource | null
  theme: GenuiTheme
  locale: string
}>()

const { t } = useI18n()

const frameRef = ref<HTMLIFrameElement | null>(null)
const frameToken = ref(0)
const state = ref<CardBridgeState>(
  props.source ? { status: 'connecting' } : { status: 'error', failure: 'unsupported-origin' },
)

let bridge: CardBridge | null = null

const docUrl = computed(() => props.source?.docUrl ?? '')
const showFrame = computed(() => props.source !== null && state.value.status !== 'error')
const canRetry = computed(() => state.value.status === 'error' && state.value.failure !== 'unsupported-origin')
const errorText = computed(() =>
  state.value.status === 'error' ? t(`genui.errors.${state.value.failure}`) : '',
)

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
  })
  bridge.start()
}

async function retry(): Promise<void> {
  if (!props.source) return
  detach()
  state.value = { status: 'connecting' }
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

.genui-card-retry {
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
</style>
