<template>
  <div class="imagegen-card">
    <div class="ig-head">
      <ImageIcon :size="14" class="ig-icon" />
      <span class="ig-title">{{ t(isEdit ? 'imageGen.card.editTitle' : 'imageGen.card.title') }}</span>
      <span v-if="referenceCount" class="ig-references">{{ t('imageGen.card.referenceCount', { count: referenceCount }) }}</span>
      <span v-if="model" class="ig-model">{{ t('imageGen.card.model', { model }) }}</span>
      <span v-if="summary" class="ig-summary">{{ summary }}</span>
    </div>

    <div v-if="isCallError" class="ig-call-error">{{ callErrorText }}</div>

    <div v-if="items.length" class="ig-grid">
      <div
        v-for="(item, index) in items"
        :key="index"
        class="ig-item"
        :class="`is-${statusOf(item)}`"
      >
        <img
          v-if="dataUrls[index]"
          class="ig-thumb"
          :src="dataUrls[index]"
          :alt="item.path"
          :title="t('imageGen.card.zoom')"
          @click="zoomed = index"
        />
        <div v-else class="ig-placeholder">
          <ImageOff :size="18" />
        </div>

        <div v-if="statusOf(item) !== 'succeeded'" class="ig-item-status">
          {{ t(`imageGen.card.status.${statusOf(item)}`) }}
        </div>
        <div v-if="itemErrors[index]" class="ig-item-error">{{ itemErrors[index] }}</div>

        <button
          v-if="item.path"
          class="ig-open-folder"
          :disabled="!canReveal"
          :aria-label="canReveal ? t('imageGen.card.openFolder') : t('imageGen.card.openFolderUnavailable')"
          :title="canReveal ? t('imageGen.card.openFolder') : t('imageGen.card.openFolderUnavailable')"
          @click="reveal(item.path)"
        >
          <FolderOpen :size="13" />
        </button>
      </div>
    </div>

    <div v-if="zoomed !== null" class="ig-lightbox" @click.self="zoomed = null">
      <img :src="dataUrls[zoomed]" :alt="items[zoomed]?.path" />
      <button
        class="ig-lightbox-close"
        :aria-label="t('imageGen.card.close')"
        :title="t('imageGen.card.close')"
        @click="zoomed = null"
      >
        <X :size="18" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Image as ImageIcon, ImageOff, FolderOpen, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import { getImageMimeType, toDataUrl } from '@/utils/markdownImagePath'

type ItemStatus = 'succeeded' | 'failed' | 'cancelled'

interface ImageItem {
  path?: string
  size?: string
  status?: ItemStatus
  error?: string
}

const props = defineProps<{ toolCall: ToolCall }>()
const { t, te } = useI18n()

const canReveal = api.shell.canShowItemInFolder
const zoomed = ref<number | null>(null)

/** 工具成功时返回 JSON；整次失败时是纯文本，解析不出来就没有逐图报告。 */
const payload = computed<{ model?: string; referenceCount?: number; images: ImageItem[] }>(() => {
  try {
    const parsed = JSON.parse(props.toolCall.output ?? '')
    const images = Array.isArray(parsed?.images) ? parsed.images : []
    return {
      model: typeof parsed?.model === 'string' ? parsed.model : undefined,
      referenceCount: typeof parsed?.referenceCount === 'number' ? parsed.referenceCount : undefined,
      images: images.filter((i: unknown): i is ImageItem => !!i && typeof i === 'object'),
    }
  } catch {
    return { images: [] }
  }
})

const items = computed(() => payload.value.images)
const model = computed(() => payload.value.model)
/** 身份取自工具名：整次失败时输出是纯文本、在途时还没有输出，返回值认不出这是改图。 */
const isEdit = computed(() => props.toolCall.name.endsWith('__edit_image'))
const referenceCount = computed(() => {
  if (payload.value.referenceCount) return payload.value.referenceCount
  const paths: unknown = props.toolCall.input?.imagePaths
  return isEdit.value && Array.isArray(paths) ? paths.length : undefined
})
const isCallError = computed(() => props.toolCall.status === 'error')

/** 早期工具面不带 status：有路径即成功，没路径即失败。 */
function statusOf(item: ImageItem): ItemStatus {
  if (item.status === 'failed' || item.status === 'cancelled') return item.status
  return item.path ? 'succeeded' : 'failed'
}

const summary = computed(() => {
  const counts = { succeeded: 0, failed: 0, cancelled: 0 }
  for (const item of items.value) counts[statusOf(item)] += 1
  const parts: string[] = []
  if (counts.succeeded) parts.push(t('imageGen.card.okCount', { count: counts.succeeded }))
  if (counts.failed) parts.push(t('imageGen.card.failedCount', { count: counts.failed }))
  if (counts.cancelled) parts.push(t('imageGen.card.cancelledCount', { count: counts.cancelled }))
  return parts.join(' · ')
})

/**
 * 供应商原文可能把 Authorization 头回显进错误体，所以渲染前一律抹掉凭证样式的串。
 * 认得的稳定错误码直接用本地文案，根本不碰原文。
 */
function redactSecrets(text: string): string {
  const marker = t('imageGen.card.redacted')
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, marker)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, `Bearer ${marker}`)
}

function errorText(item: ImageItem): string {
  const code = /^([a-z][a-z0-9_]*):/.exec(item.error ?? '')?.[1]
  const key = code ? `imageGen.card.errors.${code}` : ''
  return key && te(key) ? t(key) : t('imageGen.card.errorFallback')
}

const callErrorText = computed(() =>
  redactSecrets(props.toolCall.output?.trim() || t('imageGen.card.callFailed')),
)

const dataUrls = ref<Record<number, string>>({})
const unreadable = ref<number[]>([])

/** 逐项报错文案：失败项用错误码文案，读不出来的成功项交代读盘失败。 */
const itemErrors = computed(() => items.value.map((item, index) => {
  if (statusOf(item) === 'failed') return errorText(item)
  return unreadable.value.includes(index) ? t('imageGen.card.readFailed') : null
}))

// CSP 的 img-src 不含 file:，本地图片必须读成 data URL 才能显示。
let loadToken = 0
watch(items, async list => {
  const token = ++loadToken
  const urls: Record<number, string> = {}
  const failed: number[] = []
  await Promise.all(list.map(async (item, index) => {
    if (!item.path || statusOf(item) !== 'succeeded') return
    const base64 = await api.readFileAsBase64(item.path)
    if (base64) urls[index] = toDataUrl(getImageMimeType(item.path), base64)
    else failed.push(index)
  }))
  // 流式输出会多次触发读盘，慢的那批不能盖掉已经显示的新图。
  if (token !== loadToken) return
  dataUrls.value = urls
  unreadable.value = failed
  if (zoomed.value !== null && !urls[zoomed.value]) zoomed.value = null
}, { immediate: true })

function reveal(path: string): void {
  if (!canReveal) return
  void api.shell.showItemInFolder(path)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') zoomed.value = null
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped lang="scss">
.imagegen-card {
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  padding: 10px;
}

.ig-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.ig-icon {
  color: var(--accent-primary);
}

.ig-model,
.ig-references,
.ig-summary {
  color: var(--text-secondary);
  font-size: var(--text-xs-plus);
}

.ig-call-error {
  margin-top: 8px;
  padding: 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--error);
  color: var(--text-primary);
  font-size: var(--text-xs-plus);
  white-space: pre-wrap;
  word-break: break-word;
}

.ig-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.ig-item {
  position: relative;
  width: 132px;

  &.is-failed .ig-placeholder {
    border-color: var(--error);
    color: var(--error);
  }

  &.is-cancelled .ig-placeholder {
    border-color: var(--surface-border-strong);
    color: var(--text-disabled);
  }
}

.ig-thumb {
  width: 132px;
  height: 132px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--surface-border);
  background: var(--bg-secondary);
  cursor: zoom-in;
  display: block;
}

.ig-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 132px;
  height: 132px;
  border-radius: var(--radius-sm);
  border: 1px dashed var(--surface-border-strong);
  background: var(--bg-secondary);
  color: var(--text-muted);
}

.ig-item-status {
  margin-top: 4px;
  font-size: var(--text-xs-plus);
  color: var(--text-secondary);
}

.ig-item-error {
  margin-top: 2px;
  font-size: var(--text-xs-plus);
  color: var(--text-secondary);
  word-break: break-word;
}

.ig-open-folder {
  position: absolute;
  right: 4px;
  top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--surface-border-strong);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &:disabled {
    color: var(--text-disabled);
    cursor: not-allowed;
  }
}

.ig-lightbox {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-scrim);
  cursor: zoom-out;

  img {
    max-width: 92vw;
    max-height: 92vh;
    object-fit: contain;
    border-radius: var(--radius-sm);
    cursor: default;
  }
}

.ig-lightbox-close {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  border: 1px solid var(--surface-border-strong);
  background: var(--bg-elevated);
  color: var(--text-primary);
  cursor: pointer;
}
</style>