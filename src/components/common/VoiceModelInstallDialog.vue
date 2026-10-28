<template>
  <Teleport to="body">
    <Transition name="vmd-dialog">
      <div
        v-if="visible"
        class="vmd-overlay"
        role="dialog"
        aria-modal="true"
        @click.self="emit('cancel')"
        @keydown.escape="emit('cancel')"
      >
        <div class="vmd-content">
          <h3 class="vmd-title">{{ $t('voiceInput.installTitle') }}</h3>
          <p class="vmd-text">{{ $t('voiceInput.installIntro') }}</p>
          <dl class="vmd-rows">
            <div v-if="info?.model" class="vmd-row">
              <dt>{{ $t('voiceInput.modelLabel') }}</dt>
              <dd class="vmd-model">{{ info.model.name }}</dd>
            </div>
            <div v-if="info?.model" class="vmd-row">
              <dt>{{ $t('voiceInput.modelLicense') }}</dt>
              <dd>{{ info.model.license }}</dd>
            </div>
            <div class="vmd-row">
              <dt>{{ $t('voiceInput.archiveSize') }}</dt>
              <dd>{{ formatSize(info?.archiveBytes ?? 0) }}</dd>
            </div>
            <div class="vmd-row">
              <dt>{{ $t('voiceInput.installedSize') }}</dt>
              <dd>{{ formatSize(info?.installedBytes ?? 0) }}</dd>
            </div>
            <div class="vmd-row">
              <dt>{{ $t('voiceInput.downloadSource') }}</dt>
              <dd class="vmd-source">{{ primarySourceLabel }}</dd>
            </div>
          </dl>
          <p class="vmd-hint">{{ $t('voiceInput.sourceFallbackHint') }}</p>
          <div class="vmd-actions">
            <button class="vmd-btn vmd-btn-secondary" type="button" @click="emit('cancel')">
              {{ $t('common.cancel') }}
            </button>
            <button class="vmd-btn vmd-btn-primary" type="button" @click="emit('confirm')">
              {{ $t('voiceInput.confirmInstall') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 语音识别模型安装确认 —— 设置页与聊天输入框首次点击麦克风时共用。
 *
 * 只负责确认与展示体积/下载源；下载、进度与失败处理留在各自宿主。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatSize } from '@/utils/artifactFormat'
import type { VoiceModelInstallInfo, VoiceModelSourceKind } from '@/shared/channels/voice'

const props = defineProps<{
  visible: boolean
  info: VoiceModelInstallInfo | null
}>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()

const primarySourceLabel = computed(() => {
  const source = props.info?.sources[0]
  if (!source) return t('voiceInput.notAvailable')
  return `${sourceKindLabel(source.kind)} · ${hostOf(source.url)}`
})

function sourceKindLabel(kind: VoiceModelSourceKind): string {
  const key: Record<VoiceModelSourceKind, string> = {
    github: 'voiceInput.sourceGithub',
    mirror: 'voiceInput.sourceMirror',
    custom: 'voiceInput.sourceCustom',
  }
  return t(key[kind])
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
</script>

<style lang="scss" scoped>
.vmd-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

.vmd-content {
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  padding: 24px;
  max-width: 460px;
  width: 90%;
  box-shadow: var(--shadow-xl);
}

.vmd-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}

.vmd-text {
  font-size: var(--text-base);
  color: var(--text-secondary);
  margin: 0 0 16px;
  line-height: 1.6;
}

.vmd-rows {
  margin: 0;
  padding: 12px 14px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vmd-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;

  dt {
    font-size: 12.5px;
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
}

.vmd-source {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vmd-model {
  max-width: 300px;
  text-align: right;
}

.vmd-hint {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.vmd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}

.vmd-btn {
  padding: 8px 16px;
  font-size: var(--text-base);
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.vmd-btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border-color: var(--surface-border);

  &:hover {
    background: var(--surface-hover);
  }
}

.vmd-btn-primary {
  background: var(--accent-primary);
  color: #fff;

  &:hover {
    opacity: 0.9;
  }
}

.vmd-dialog-enter-active,
.vmd-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.vmd-dialog-enter-from,
.vmd-dialog-leave-to {
  opacity: 0;
}
</style>
