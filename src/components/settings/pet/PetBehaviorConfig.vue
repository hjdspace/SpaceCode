<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePetStore } from '@/stores/pet'
import { useSettingsStore, type ProviderConfig } from '@/stores/settings'
import type { ReactionMode } from '@/types/pet'

const petStore = usePetStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

const settings = computed(() => petStore.config?.settings)

const reactionMode = computed<ReactionMode>({
  get: () => settings.value?.reactionMode ?? 'preset',
  set: (val) => petStore.updateSettings({ reactionMode: val })
})

const aiModel = computed({
  get: () => settings.value?.aiModel ?? '',
  set: (val) => petStore.updateSettings({ aiModel: val })
})

// 从当前 authMethod 对应 provider config 的三槽位去重提取可用模型列表
const availableModels = computed<{ label: string; value: string }[]>(() => {
  const method = settingsStore.authMethod
  let cfg: ProviderConfig | undefined
  if (method === 'openai_compatible') cfg = settingsStore.openaiConfig
  else if (method === 'gemini_api') cfg = settingsStore.geminiConfig
  else cfg = settingsStore.anthropicConfig

  const seen = new Set<string>()
  const out: { label: string; value: string }[] = []
  for (const v of [cfg?.haikuModel, cfg?.sonnetModel, cfg?.opusModel]) {
    if (v && !seen.has(v)) {
      seen.add(v)
      out.push({ label: v, value: v })
    }
  }
  return out
})

// 当前 provider config 是否已配置 baseUrl + apiKey
const hasApiConfig = computed(() => {
  const method = settingsStore.authMethod
  let cfg: ProviderConfig | undefined
  if (method === 'openai_compatible') cfg = settingsStore.openaiConfig
  else if (method === 'gemini_api') cfg = settingsStore.geminiConfig
  else cfg = settingsStore.anthropicConfig
  return !!(cfg?.apiKey && cfg?.baseUrl)
})

// 当可用模型列表变化且不包含当前选中模型时，自动同步到第一个可用模型
watch(availableModels, (models) => {
  if (models.length > 0 && !models.some(m => m.value === aiModel.value)) {
    aiModel.value = models[0].value
  }
}, { immediate: true })

const intervalSec = computed({
  get: () => Math.round((settings.value?.reactionIntervalMs ?? 60000) / 1000),
  set: (val) => petStore.updateSettings({ reactionIntervalMs: val * 1000 })
})

const scaleDec = computed({
  get: () => settings.value?.scale ?? 1.0,
  set: (val) => petStore.updateSettings({ scale: val })
})

const muted = computed({
  get: () => settings.value?.muted ?? false,
  set: (val) => petStore.updateSettings({ muted: val })
})

const alwaysOnTop = computed({
  get: () => settings.value?.alwaysOnTopDesktop ?? true,
  set: (val) => petStore.updateSettings({ alwaysOnTopDesktop: val })
})

const clickThrough = computed({
  get: () => settings.value?.clickThrough ?? false,
  set: (val) => petStore.updateSettings({ clickThrough: val })
})
</script>

<template>
  <div class="pet-behavior-config">
    <div class="config-group">
      <label class="group-label">{{ t('petSettings.reactionMode') }}</label>
      <div class="radio-group">
        <label class="radio-label">
          <input type="radio" v-model="reactionMode" value="preset" />
          {{ t('petSettings.presetMode') }}
        </label>
        <label class="radio-label">
          <input type="radio" v-model="reactionMode" value="ai" />
          {{ t('petSettings.aiMode') }}
        </label>
      </div>
      <p class="hint" v-if="reactionMode === 'ai'">{{ t('petSettings.aiModeHint') }}</p>
    </div>

    <div class="config-group" v-if="reactionMode === 'ai'">
      <label class="group-label">{{ t('petSettings.aiModel') }}</label>
      <select v-if="availableModels.length > 0" v-model="aiModel" class="select-input">
        <option v-for="m in availableModels" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
      <p v-else class="hint warning">{{ t('petSettings.aiModelEmpty') }}</p>
      <p v-if="!hasApiConfig" class="hint warning">{{ t('petSettings.aiModelNoConfig') }}</p>
    </div>

    <div class="config-group">
      <label class="group-label">{{ t('petSettings.reactionInterval') }}: {{ intervalSec }}s</label>
      <input type="range" v-model.number="intervalSec" min="30" max="300" step="10" class="range-input" />
    </div>

    <div class="config-group">
      <label class="group-label">{{ t('petSettings.scale') }}: {{ scaleDec.toFixed(1) }}x</label>
      <input type="range" v-model.number="scaleDec" min="0.5" max="2.0" step="0.1" class="range-input" />
    </div>

    <div class="config-group">
      <label class="checkbox-label">
        <input type="checkbox" v-model="muted" />
        {{ t('petSettings.muted') }}
      </label>
    </div>

    <template v-if="petStore.mode === 'desktop'">
      <div class="config-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="alwaysOnTop" />
          {{ t('petSettings.alwaysOnTop') }}
        </label>
      </div>
      <div class="config-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="clickThrough" />
          {{ t('petSettings.clickThrough') }}
        </label>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.pet-behavior-config {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.config-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-label {
  font-size: 13px;
  color: var(--text-secondary, #ccc);
  font-weight: 500;
}

.radio-group { display: flex; gap: 16px; }

.radio-label, .checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-primary, #fff);
  cursor: pointer;

  input { cursor: pointer; }
}

.hint {
  color: var(--text-muted, #999);
  font-size: 11px;
  margin: 0;

  &.warning {
    color: var(--text-warning, #f0ad4e);
  }
}

.select-input {
  padding: 6px 12px;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-default, #444);
  border-radius: 4px;
  color: var(--text-primary, #fff);
  font-size: 13px;
  align-self: flex-start;
}

.range-input {
  width: 100%;
  max-width: 300px;
}
</style>
