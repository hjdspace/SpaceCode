<template>
  <div
    class="file-attachment-card"
    :class="{ 'is-openable': isPasted && openable }"
    :title="isPasted ? displayName : file.path"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
    @click="handleClick"
  >
    <div class="file-attachment-icon" aria-hidden="true">
      <FileText :size="20" />
      <span class="file-attachment-badge">{{ badge }}</span>
    </div>
    <div class="file-attachment-meta">
      <span class="file-attachment-name">{{ displayName }}</span>
      <span class="file-attachment-type">{{ subtitle }}</span>
    </div>
    <button
      v-if="removable"
      type="button"
      class="file-attachment-remove"
      :title="t('chatInput.removeAttachment')"
      :aria-label="t('chatInput.removeAttachment')"
      @click.stop="$emit('remove')"
    >
      <X :size="12" />
    </button>
  </div>

  <!-- 粘贴文本悬停预览：只读文件内容，不把原文塞回 DOM -->
  <Teleport to="body">
    <Transition name="paste-preview">
      <div
        v-if="preview.visible"
        ref="previewRef"
        class="paste-preview"
        :style="preview.style"
      >
        <pre class="paste-preview-text">{{ preview.text }}</pre>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { FileText, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { Attachment } from '@/types'
import { api } from '@/services/electronAPI'
import { formatSize } from '@/utils/artifactFormat'
import { summarizePastedText } from '@/lib/pasteText'

const props = withDefaults(defineProps<{
  file: Attachment
  removable?: boolean
  /** 已发送消息里的粘贴件可点击，在右侧面板打开全文 */
  openable?: boolean
}>(), {
  removable: false,
  openable: false,
})

const emit = defineEmits<{
  remove: []
  open: []
}>()

const { t } = useI18n()

/** 悬停预览最多展示的字符数；全文仍然要点开右侧面板看 */
const PREVIEW_CHAR_LIMIT = 4000

const isPasted = computed(() => props.file.source === 'paste')

/** 卡片上展示的大写类型标签（MD / TSX / PDF…），无扩展名时回退 FILE */
const extension = computed(() => {
  const name = props.file.name
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'FILE'
  return name.slice(dot + 1).toUpperCase().slice(0, 4)
})

const badge = computed(() => (isPasted.value ? 'TXT' : extension.value))

/** 历史会话从引擎正文还原时只有路径，标题/大小需要在文件还在时补齐 */
const resolvedTitle = ref('')
const resolvedSizeBytes = ref<number | null>(null)

const displayName = computed(() =>
  isPasted.value
    ? props.file.title?.trim() || resolvedTitle.value || t('chatInput.pastedText')
    : props.file.name
)

const subtitle = computed(() => {
  if (isPasted.value) {
    const size = props.file.sizeBytes ?? resolvedSizeBytes.value
    const label = t('chatInput.pastedText')
    return size != null ? `${label} · ${formatSize(size)}` : label
  }
  return extension.value
})

const previewRef = ref<HTMLElement | null>(null)
const preview = ref<{ visible: boolean; text: string; style: Record<string, string> }>({
  visible: false,
  text: '',
  style: {},
})

let contentPromise: Promise<string | null> | undefined
let hoverToken = 0

function loadContent(): Promise<string | null> {
  if (!contentPromise) {
    contentPromise = api.readFile(props.file.path).catch(() => null)
  }
  return contentPromise
}

async function hydratePastedMetadata() {
  if (props.file.sizeBytes == null) {
    try {
      const stat = await api.stat(props.file.path)
      if (stat && stat.size > 0) resolvedSizeBytes.value = stat.size
    } catch {
      // 临时文件可能已被系统清理，保留兜底文案
    }
  }
  if (!props.file.title?.trim()) {
    const text = await loadContent()
    if (text) resolvedTitle.value = summarizePastedText(text)
  }
}

onMounted(() => {
  if (isPasted.value) void hydratePastedMetadata()
})

function handleClick() {
  if (isPasted.value && props.openable) {
    hidePreview()
    emit('open')
  }
}

async function handleMouseEnter(e: MouseEvent) {
  if (!isPasted.value) return
  const token = ++hoverToken
  const card = e.currentTarget as HTMLElement

  const loadedText = await loadContent()
  if (token !== hoverToken) return
  if (!loadedText) return

  const text = loadedText.length > PREVIEW_CHAR_LIMIT
    ? `${loadedText.slice(0, PREVIEW_CHAR_LIMIT)}…`
    : loadedText
  preview.value = { visible: true, text, style: { visibility: 'hidden' } }
  await nextTick()
  if (token !== hoverToken) return
  positionPreview(card)
}

function handleMouseLeave() {
  hoverToken++
  hidePreview()
}

function hidePreview() {
  preview.value = { ...preview.value, visible: false }
}

function positionPreview(card: HTMLElement) {
  const el = previewRef.value
  if (!el) return
  const rect = card.getBoundingClientRect()
  const gap = 8
  const margin = 8
  const width = el.offsetWidth
  const height = el.offsetHeight
  const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin)
  let top = rect.top - height - gap
  if (top < margin) top = Math.min(rect.bottom + gap, window.innerHeight - height - margin)
  preview.value = {
    ...preview.value,
    style: { position: 'fixed', top: `${top}px`, left: `${left}px`, visibility: 'visible' },
  }
}
</script>

<style lang="scss" scoped>
.file-attachment-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  max-width: 240px;
  padding: 10px 12px;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  background: var(--bg-secondary);

  &.is-openable {
    cursor: pointer;
    transition: border-color 0.15s ease;

    &:hover {
      border-color: var(--surface-border-strong);
    }
  }
}

.file-attachment-icon {
  position: relative;
  flex: 0 0 34px;
  width: 34px;
  height: 38px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 4px;
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-muted);

  svg {
    position: absolute;
    top: 5px;
    left: 7px;
    opacity: 0.35;
  }
}

.file-attachment-badge {
  position: relative;
  max-width: 30px;
  padding: 1px 3px;
  border-radius: 3px;
  background: #3b82f6;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-attachment-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.file-attachment-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-attachment-type {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.file-attachment-remove {
  position: absolute;
  top: -7px;
  right: -7px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--surface-border);
  border-radius: 50%;
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;

  &:hover {
    color: var(--text-primary);
    border-color: var(--surface-border-strong);
  }
}

// 悬停预览浮窗（Teleport 到 body，scoped 作用域仍随节点保留）
.paste-preview {
  z-index: 9999;
  width: 480px;
  max-width: calc(100vw - 16px);
  max-height: 300px;
  padding: 10px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  pointer-events: none;
}

.paste-preview-text {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

.paste-preview-enter-active,
.paste-preview-leave-active {
  transition: opacity 0.12s ease-out, transform 0.12s ease-out;
}

.paste-preview-enter-from,
.paste-preview-leave-to {
  opacity: 0;
  transform: translateY(2px);
}
</style>
