<template>
  <div class="imagegen-settings s-page-shell">
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">{{ t('settings.title') }}</div>
      <h1 class="s-masthead-title">{{ t('imageGen.title') }}</h1>
      <p class="s-masthead-desc">{{ t('imageGen.description') }}</p>
    </div>

    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon"><ImageIcon :size="14" /></div>
          <span class="s-panel-title">{{ t('imageGen.panelTitle') }}</span>
        </div>
      </div>

      <div class="s-panel-body" @input="dirty = true" @change="dirty = true">
        <div class="s-form-group">
          <label class="s-form-label" for="imagegen-preset">{{ t('imageGen.presetLabel') }}</label>
          <select id="imagegen-preset" v-model="presetId" class="s-form-select" @change="applyPreset">
            <option value="openai">{{ t('imageGen.presets.openai') }}</option>
            <option value="zhipu">{{ t('imageGen.presets.zhipu') }}</option>
            <option value="ark">{{ t('imageGen.presets.ark') }}</option>
            <option value="custom">{{ t('imageGen.presets.custom') }}</option>
          </select>
          <p class="s-form-hint">{{ t('imageGen.presetHint') }}</p>
        </div>

        <div class="s-form-group">
          <label class="s-form-label" for="imagegen-dialect">{{ t('imageGen.dialectLabel') }}</label>
          <select id="imagegen-dialect" v-model="dialect" class="s-form-select" :disabled="presetId !== 'custom'">
            <option value="openai">{{ t('imageGen.dialects.openai') }}</option>
            <option value="seedream">{{ t('imageGen.dialects.seedream') }}</option>
            <option value="zhipu">{{ t('imageGen.dialects.zhipu') }}</option>
          </select>
          <p class="s-form-hint">
            {{ presetId === 'custom' ? t('imageGen.dialectHint') : t('imageGen.dialectLocked') }}
          </p>
        </div>

        <div class="s-form-group">
          <label class="s-form-label" for="imagegen-base-url">{{ t('imageGen.baseUrlLabel') }}</label>
          <input
            id="imagegen-base-url"
            v-model="baseUrl"
            class="s-form-input"
            type="text"
            :placeholder="t('imageGen.baseUrlPlaceholder')"
            spellcheck="false"
          />
        </div>

        <div class="s-form-group">
          <label class="s-form-label" for="imagegen-api-key">{{ t('imageGen.apiKeyLabel') }}</label>
          <div class="s-input-with-action">
            <input
              id="imagegen-api-key"
              v-model="apiKey"
              class="s-form-input"
              :type="showKey ? 'text' : 'password'"
              :placeholder="hasApiKey ? t('imageGen.apiKeyConfiguredPlaceholder') : t('imageGen.apiKeyPlaceholder')"
              spellcheck="false"
              autocomplete="off"
            />
            <button
              class="s-btn s-btn-secondary"
              type="button"
              data-test="toggle-key"
              @click="showKey = !showKey"
            >
              <component :is="showKey ? EyeOff : Eye" :size="14" />
              <span>{{ showKey ? t('imageGen.hideKey') : t('imageGen.showKey') }}</span>
            </button>
          </div>
          <p class="s-form-hint">{{ t('imageGen.apiKeyHint') }}</p>
        </div>

        <div ref="modelFieldRef" class="s-form-group model-field">
          <label class="s-form-label" for="imagegen-model">{{ t('imageGen.modelLabel') }}</label>
          <div class="s-input-with-action">
            <div ref="modelInputRef" class="model-input-wrap">
              <input
                id="imagegen-model"
                v-model="model"
                class="s-form-input"
                type="text"
                :placeholder="t('imageGen.modelPlaceholder')"
                spellcheck="false"
                autocomplete="off"
                role="combobox"
                :aria-expanded="showModelOptions"
                aria-controls="imagegen-model-options"
                @focus="openModelOptions"
                @click="openModelOptions"
                @keydown.esc="showModelOptions = false"
              />
              <button
                v-if="fetchedModels.length > 0"
                class="model-toggle"
                type="button"
                :aria-label="t('imageGen.fetchModels')"
                :aria-expanded="showModelOptions"
                @mousedown.prevent
                @click="toggleModelOptions"
              >
                <ChevronDown :size="14" class="chevron" :class="{ open: showModelOptions }" />
              </button>
              <Teleport to="body">
                <ul
                  v-if="showModelOptions && fetchedModels.length > 0"
                  id="imagegen-model-options"
                  ref="modelOptionsRef"
                  class="model-options"
                  :style="modelDropdownStyle"
                  role="listbox"
                >
                  <li
                    v-for="id in fetchedModels"
                    :key="id"
                    class="model-option"
                    :class="{ selected: id === model }"
                    role="option"
                    :aria-selected="id === model"
                    @mousedown.prevent
                    @click="pickModel(id)"
                  >
                    {{ id }}
                  </li>
                </ul>
              </Teleport>
            </div>
            <button
              class="s-btn s-btn-secondary"
              type="button"
              data-test="fetch-models"
              :disabled="fetchingModels"
              @click="fetchModels"
            >
              <RefreshCw v-if="fetchingModels" :size="14" class="spin" />
              <Download v-else :size="14" />
              <span>{{ fetchingModels ? t('imageGen.fetchingModels') : t('imageGen.fetchModels') }}</span>
            </button>
          </div>
          <p class="s-form-hint">{{ t('imageGen.modelHint') }}</p>
          <p v-if="fetchMessage" class="s-form-hint" :class="{ 'validation-error': fetchFailed }">
            {{ fetchMessage }}
          </p>
        </div>

        <div class="s-toggle-wrapper">
          <div class="s-toggle-info">
            <span class="s-toggle-label">{{ t('imageGen.watermarkLabel') }}</span>
            <span class="s-toggle-description">{{ t('imageGen.watermarkHint') }}</span>
          </div>
          <input id="imagegen-watermark" v-model="disableWatermark" type="checkbox" class="s-toggle-switch" />
        </div>

        <div class="save-row">
          <button class="s-btn s-btn-primary" type="button" data-test="save" :disabled="saving" @click="save">
            {{ saving ? t('imageGen.saving') : t('imageGen.save') }}
          </button>
          <span v-if="status" class="s-status-badge" :class="status">
            {{ status === 'success' ? t('imageGen.saved') : t('imageGen.saveFailed') }}
          </span>
        </div>
        <p v-if="validationError" class="s-form-hint validation-error">{{ validationError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Download, Eye, EyeOff, Image as ImageIcon, RefreshCw } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { api } from '@/services/electronAPI'
import { IMAGEGEN_PRESETS } from '@/shared/imageGenReference'
import type { ImageGenConfig, ImageGenDialect, ImageGenPresetId } from '@/shared/imageGenReference'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const existing = settingsStore.imageGenConfig

const presetId = ref<ImageGenPresetId>(existing?.presetId ?? 'openai')
const dialect = ref<ImageGenDialect>(existing?.dialect ?? IMAGEGEN_PRESETS.openai.dialect)
const baseUrl = ref(existing?.baseUrl ?? IMAGEGEN_PRESETS.openai.baseUrl)
const model = ref(existing?.model ?? IMAGEGEN_PRESETS.openai.model)
const disableWatermark = ref(existing?.disableWatermark ?? false)
const hasApiKey = ref(existing?.hasApiKey === true)
// key 只写：绝不预填，留空即沿用主进程里那份。
const apiKey = ref('')

const showKey = ref(false)
const saving = ref(false)
const status = ref<'success' | 'error' | null>(null)
const validationError = ref('')
const dirty = ref(false)

const fetchingModels = ref(false)
const fetchedModels = ref<string[]>([])
const fetchMessage = ref('')
const fetchFailed = ref(false)
const showModelOptions = ref(false)
const modelFieldRef = ref<HTMLElement | null>(null)
const modelInputRef = ref<HTMLElement | null>(null)
const modelOptionsRef = ref<HTMLElement | null>(null)

// 候选弹层挂到 body，避免被 .s-panel 的 overflow: hidden 裁掉。
const modelDropdownStyle = computed<Record<string, string>>(() => {
  const trigger = modelInputRef.value
  if (!showModelOptions.value || !trigger) return {}
  const rect = trigger.getBoundingClientRect()
  const style: Record<string, string> = {
    position: 'fixed',
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    zIndex: '120',
  }
  const spaceBelow = window.innerHeight - rect.bottom - 8
  const spaceAbove = rect.top - 8
  if (spaceBelow < 240 && spaceAbove > spaceBelow) {
    style.bottom = `${window.innerHeight - rect.top + 4}px`
  } else {
    style.top = `${rect.bottom + 4}px`
  }
  return style
})

// 上游返回的候选只对当前 Base URL 有效；地址一改就作废，免得选到别家的模型名。
watch(baseUrl, () => {
  fetchedModels.value = []
  fetchMessage.value = ''
  fetchFailed.value = false
  showModelOptions.value = false
})

function openModelOptions(): void {
  if (fetchedModels.value.length > 0) showModelOptions.value = true
}

function toggleModelOptions(): void {
  showModelOptions.value = !showModelOptions.value
}

function pickModel(id: string): void {
  model.value = id
  showModelOptions.value = false
}

// 候选是自绘弹层（原生 datalist 在暗色主题下不可控），点外部要能收起。
function handleDocumentClick(event: MouseEvent): void {
  if (!showModelOptions.value) return
  const target = event.target as Node
  if (modelFieldRef.value?.contains(target)) return
  if (modelOptionsRef.value?.contains(target)) return
  showModelOptions.value = false
}

onMounted(() => document.addEventListener('click', handleDocumentClick))
onUnmounted(() => document.removeEventListener('click', handleDocumentClick))

// 面板可能挂载早于 gui-settings.json 落地（KeepAlive 会把它留住）。落地后回灌，
// 但用户已经动过表单就不碰 —— 否则迟到的配置会覆盖他正在填的东西。
watch(() => settingsStore.imageGenConfig, (next) => {
  if (dirty.value || !next) return
  presetId.value = next.presetId
  dialect.value = next.dialect
  baseUrl.value = next.baseUrl
  model.value = next.model
  disableWatermark.value = next.disableWatermark
  hasApiKey.value = next.hasApiKey === true
})

// 预置锁方言：协议由供应商决定，让用户选只会选出错的组合。
const effectiveDialect = computed<ImageGenDialect>(() =>
  presetId.value === 'custom' ? dialect.value : IMAGEGEN_PRESETS[presetId.value].dialect,
)

function applyPreset(): void {
  status.value = null
  validationError.value = ''
  if (presetId.value === 'custom') return
  const preset = IMAGEGEN_PRESETS[presetId.value]
  dialect.value = preset.dialect
  baseUrl.value = preset.baseUrl
  model.value = preset.model
}

async function fetchModels(): Promise<void> {
  const url = baseUrl.value.trim().replace(/\/+$/, '')
  fetchFailed.value = false
  fetchMessage.value = ''
  if (!/^https?:\/\/\S+$/i.test(url)) {
    fetchFailed.value = true
    fetchMessage.value = t('imageGen.invalid')
    return
  }

  fetchingModels.value = true
  const result = await api.listImageGenModels(url, apiKey.value.trim())
  fetchingModels.value = false

  if (result.success) {
    fetchedModels.value = result.models
    fetchFailed.value = result.models.length === 0
    showModelOptions.value = result.models.length > 0
    fetchMessage.value = result.models.length > 0
      ? t('imageGen.fetchedModels', { count: result.models.length })
      : t('imageGen.noModelsFound')
    return
  }

  fetchFailed.value = true
  switch (result.reason) {
    case 'no-key':
      fetchMessage.value = t('imageGen.needApiKey')
      break
    case 'http':
      fetchMessage.value = t('imageGen.fetchFailed', { status: result.status })
      break
    case 'unavailable':
      fetchMessage.value = t('imageGen.fetchUnavailable')
      break
    default:
      fetchMessage.value = t('imageGen.fetchNetworkError')
  }
}

async function save(): Promise<void> {
  validationError.value = ''
  status.value = null
  const config: ImageGenConfig = {
    presetId: presetId.value,
    dialect: effectiveDialect.value,
    baseUrl: baseUrl.value.trim().replace(/\/+$/, ''),
    apiKey: apiKey.value.trim(),
    model: model.value.trim(),
    disableWatermark: disableWatermark.value,
  }
  if (!/^https?:\/\/\S+$/i.test(config.baseUrl) || !config.model || (!config.apiKey && !hasApiKey.value)) {
    validationError.value = t('imageGen.invalid')
    return
  }

  saving.value = true
  const result = await settingsStore.setImageGenConfig(config)
  saving.value = false
  status.value = result.success ? 'success' : 'error'
  if (result.success) {
    hasApiKey.value = true
    apiKey.value = ''
  }
}
</script>

<style scoped lang="scss">
.model-field {
  position: relative;
}

.model-input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;

  .s-form-input {
    padding-right: 36px;
  }

  // 全局聚焦样式是「描边 + 外发光」，配上这里的箭头会看起来像双层蓝框；只留描边。
  .s-form-input:focus {
    box-shadow: none;
  }
}

.model-toggle {
  @include reset-button;
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--text-muted);
  border-radius: 4px;
  transition: all var(--transition-fast);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .chevron {
    transition: transform var(--transition-fast);

    &.open {
      transform: rotate(180deg);
    }
  }
}

.model-options {
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  margin: 0;
  list-style: none;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  @include scrollbar-overlay;
}

.model-option {
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text-primary);
  border-radius: 6px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    background: var(--bg-hover);
  }

  &.selected {
    color: var(--accent-primary);
    font-weight: 600;
    background: var(--bg-hover);
  }
}

.save-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
}

.validation-error {
  color: var(--error);
}
</style>