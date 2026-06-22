<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="visible" class="changelog-overlay" @click.self="handleClose">
        <div class="changelog-modal">
          <div class="changelog-header">
            <h2 class="changelog-title">SpaceCode v{{ version }}</h2>
            <button class="changelog-close" @click="handleClose" :title="t('common.close')">
              <X :size="18" />
            </button>
          </div>
          <div class="changelog-body">
            <div v-if="loading" class="changelog-loading">
              <RefreshCw :size="24" class="spin-icon" />
              <span>{{ t('changelog.loading') }}</span>
            </div>
            <div v-else-if="error" class="changelog-error">
              <p>{{ t('changelog.loadFailed') }}</p>
              <p class="error-detail">{{ error }}</p>
            </div>
            <div v-else-if="content" class="changelog-content markdown-body" v-html="renderedContent"></div>
            <div v-else class="changelog-empty">
              <p>{{ t('changelog.noContent') }}</p>
            </div>
          </div>
          <div class="changelog-footer">
            <button class="changelog-btn" @click="handleClose">{{ t('common.close') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, RefreshCw } from 'lucide-vue-next'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '@/services/electronAPI'

const props = defineProps<{
  visible: boolean
  version: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'close': []
}>()

const { t } = useI18n()
const content = ref<string | null>(null)
const source = ref<'local' | 'remote' | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const renderedContent = computed(() => {
  if (!content.value) return ''
  try {
    const raw = marked(content.value)
    return DOMPurify.sanitize(raw as string)
  } catch {
    return content.value
  }
})

watch(() => props.visible, async (newVal) => {
  if (newVal && props.version) {
    await loadReleaseNotes()
  }
})

async function loadReleaseNotes() {
  loading.value = true
  error.value = null
  content.value = null

  try {
    const result = await api.changelog.getReleaseNotes(props.version)
    if (result) {
      content.value = result.content
      source.value = result.source
    } else {
      content.value = null
      source.value = null
    }
  } catch (err: any) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

function handleClose() {
  emit('update:visible', false)
  emit('close')
}
</script>

<style lang="scss" scoped>
.changelog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.changelog-modal {
  width: 560px;
  max-width: 90vw;
  max-height: 80vh;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  animation: slideUp 0.2s ease;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.changelog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--surface-border);

  .changelog-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .changelog-close {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    background: transparent;
    border: none;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color var(--transition-fast), color var(--transition-fast);

    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
  }
}

.changelog-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  min-height: 120px;
}

.changelog-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--text-muted);
  font-size: 13px;

  .spin-icon {
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.changelog-error {
  padding: 20px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;

  .error-detail {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-muted);
    opacity: 0.7;
  }
}

.changelog-empty {
  padding: 20px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.changelog-content {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);

  :deep(h2) {
    font-size: calc(var(--font-size-base) + 1px);
    font-weight: 600;
    margin: 20px 0 8px;
    color: var(--text-primary);

    &:first-child {
      margin-top: 0;
    }
  }

  :deep(h3) {
    font-size: var(--font-size-base);
    font-weight: 600;
    margin: 16px 0 6px;
    color: var(--text-primary);
  }

  :deep(p) {
    margin: 6px 0;
    color: var(--text-secondary);
  }

  :deep(ul) {
    margin: 6px 0;
    padding-left: 20px;
  }

  :deep(li) {
    margin: 4px 0;
    color: var(--text-secondary);
  }

  :deep(strong) {
    color: var(--text-primary);
    font-weight: 600;
  }

  :deep(a) {
    color: var(--accent-primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(code) {
    background: var(--surface-border);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
    font-family: var(--font-mono);
  }
}

.changelog-footer {
  display: flex;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid var(--surface-border);

  .changelog-btn {
    padding: 6px 16px;
    border-radius: var(--radius-md);
    background: var(--surface-border);
    border: none;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--transition-fast);

    &:hover {
      background: var(--surface-hover);
    }
  }
}

// Transition
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
