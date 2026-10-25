<!--
  消息区的生成式 UI 卡片分组（票 01 承载 + 票 02 真实卡片 + 票 04 提交接线）。

  卡片属于产生它的助手消息，渲染在该消息的 AgentTimeline 之后、下一条消息之前，
  不插进时间线事件流，也不进侧栏。这里负责四件宿主侧的事：从 metadata 取卡片记录、
  取降级说明、判定沙箱源、把应用实际生效的明暗与语言推给每张卡。
  提交端口按卡片 id 绑好后交给外壳，组件本身不碰 store。
-->
<template>
  <div v-if="cards.length || fallbacks.length" class="genui-card-group">
    <GenuiCardFrame
      v-for="card in cards"
      :key="card.id"
      :card="card"
      :source="resolvedSource"
      :theme="theme"
      :locale="locale"
      :submit-card="(payload: Record<string, unknown>) => submitCard(card, payload)"
    />

    <!-- 没能成卡的围栏原文仍留在正文里，这里只补一句「为什么没渲染成界面」 -->
    <div v-if="fallbacks.length" class="genui-card-fallbacks">
      <p class="genui-card-fallbacks-label">{{ t('genui.fallbacks.label') }}</p>
      <ul class="genui-card-fallbacks-list">
        <li v-for="fallback in fallbacks" :key="fallback.id">{{ fallbackText(fallback) }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import GenuiCardFrame from './GenuiCardFrame.vue'
import { resolveSandboxSource, type SandboxSource } from '@/lib/genui/sandboxUrl'
import { createCardSubmissionPort } from '@/lib/genui/cardSubmissionPort'
import { toSandboxTheme } from '@/lib/genui/themeTokens'
import type { GenuiTheme } from '@/shared/genuiSandbox'
import type { GenuiCardFallback, GenuiCardRecord } from '@/types/genui'
import type { Message } from '@/types'

const props = defineProps<{
  messages: Message[]
  /** 宿主可显式指定沙箱源（H5 在票 06 接入）；不传则按当前窗口位置判定 */
  source?: SandboxSource | null
}>()

const { t, locale } = useI18n()

const cards = computed<GenuiCardRecord[]>(() =>
  props.messages.flatMap((message) => message.metadata?.genUiCards ?? []),
)

const fallbacks = computed<GenuiCardFallback[]>(() =>
  props.messages.flatMap((message) => message.metadata?.genUiCardFallbacks ?? []),
)

/**
 * 提交端口在 setup 里取一次：真正的 store/i18n 访问推迟到第一次提交，
 * 挂载消息区因此不要求 Pinia 就位（不点提交的用例保持纯组件测试）。
 */
const submitCard = createCardSubmissionPort()

function fallbackText(fallback: GenuiCardFallback): string {
  const reason = t(`genui.fallbacks.reasons.${fallback.reason}`)
  return fallback.componentName ? `${fallback.componentName} · ${reason}` : reason
}

// 沙箱源由运行环境决定，一个窗口一次判定，不必每条消息重算
const hostSource = resolveSandboxSource(window.location)
const resolvedSource = computed(() => props.source ?? hostSource)

/**
 * 主题取应用真正落到 `data-theme` 上的值（含 system 解析与 anthropic 变体），
 * 卡片只认明暗两套 token，读不到父窗口 CSS。
 */
const theme = ref<GenuiTheme>(toSandboxTheme(document.documentElement.dataset.theme))
let observer: MutationObserver | null = null

onMounted(() => {
  observer = new MutationObserver(() => {
    theme.value = toSandboxTheme(document.documentElement.dataset.theme)
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<style lang="scss" scoped>
/* 与 DesignBlocks 同缩进：卡片属于消息，不属于时间线气泡 */
.genui-card-group {
  margin-left: 36px;
  max-width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 降级说明：紧贴在同组卡片之后，颜色与工具卡一致走主题变量，不硬编码 */
.genui-card-fallbacks {
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.genui-card-fallbacks-label {
  margin: 0;
}

.genui-card-fallbacks-list {
  margin: 2px 0 0;
  padding-left: 16px;
  list-style: disc;
}
</style>
