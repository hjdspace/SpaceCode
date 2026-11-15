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

        <div class="s-form-group">
          <label class="s-form-label" for="imagegen-model">{{ t('imageGen.modelLabel') }}</label>
          <input
            id="imagegen-model"
            v-model="model"
            class="s-form-input"
            type="text"
            :placeholder="t('imageGen.modelPlaceholder')"
            spellcheck="false"
          />
          <p class="s-form-hint">{{ t('imageGen.modelHint') }}</p>
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
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff, Image as ImageIcon } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
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