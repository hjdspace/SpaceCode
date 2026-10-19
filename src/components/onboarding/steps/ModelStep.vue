<template>
  <div class="ob-group-title">{{ t('onboarding.model.pick') }}</div>
  <div class="ob-row">
    <button
      v-for="option in METHOD_OPTIONS"
      :key="option.id"
      type="button"
      class="ob-chip"
      :class="{ 'is-active': settingsStore.authMethod === option.id }"
      :disabled="option.oauth"
      @click="selectMethod(option.id)"
    >
      <span class="ob-chip-dot" :style="{ background: option.color }" />
      {{ option.name }}
      <span v-if="option.oauth" class="ob-chip-note">OAuth</span>
    </button>
  </div>
  <p class="ob-hint ob-hint--warn">{{ t('onboarding.model.oauthTip') }}</p>

  <template v-if="!isOAuthMethod">
    <div class="ob-group-title">{{ t('onboarding.model.vendor') }}</div>
    <div class="ob-grid ob-grid--2">
      <div>
        <span class="ob-label">{{ t('onboarding.model.vendor') }}</span>
        <select class="ob-select" :value="presetIndex" @change="selectPreset(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="(preset, index) in presets" :key="preset.id" :value="index">
            {{ preset.name }}{{ preset.badgeType ? ' · ' + t(badgeKey(preset.badgeType)) : '' }}
          </option>
        </select>
      </div>
      <div>
        <span class="ob-label">{{ t('auth.baseUrl') }}</span>
        <input class="ob-input is-mono" :value="activeConfig.baseUrl" spellcheck="false" :placeholder="defaultBaseUrlOf(settingsStore.authMethod)" @change="commitBaseUrl">
      </div>
    </div>

    <div class="key-block">
      <span class="ob-label">{{ t('auth.apiKey') }}</span>
      <div class="ob-key-field">
        <input
          class="ob-input is-mono"
          :type="showKey ? 'text' : 'password'"
          :value="activeConfig.apiKey"
          spellcheck="false"
          @change="commitApiKey"
        >
        <button type="button" class="ob-eye" @click="showKey = !showKey">
          <EyeOff v-if="showKey" :size="13" />
          <Eye v-else :size="13" />
        </button>
      </div>
      <p class="ob-hint">{{ t('onboarding.model.keyTip') }}</p>
    </div>

    <div class="ob-row test-row">
      <button type="button" class="ob-btn ob-btn--ghost ob-btn--sm" :disabled="probing" @click="runTest">
        {{ t('onboarding.model.test') }}
      </button>
      <span class="ob-endpoint">GET {{ endpointPath }}</span>
      <span class="state" :class="ready ? 'is-ok' : 'is-pending'">
        {{ ready ? t('onboarding.model.configured') : t('onboarding.model.notConfigured') }}
      </span>
    </div>

    <div v-if="probing" class="ob-status ob-status--load">
      <Loader2 :size="13" class="spin" />{{ t('onboarding.model.testing') }}
    </div>
    <div v-else-if="probeMessage" class="ob-status" :class="probeOk ? 'ob-status--ok' : 'ob-status--err'">
      <Check v-if="probeOk" :size="13" :stroke-width="2.6" />
      <AlertTriangle v-else :size="13" />
      {{ probeMessage }}
    </div>

    <div class="ob-group-title">{{ t('onboarding.model.slots') }}</div>
    <div v-for="slot in SLOTS" :key="slot.key" class="ob-slot">
      <span>{{ t(slot.labelKey) }}</span>
      <SearchableSelect
        :model-value="activeConfig[slot.key]"
        :options="availableModels"
        :z-index="1100"
        @update:model-value="commitSlot(slot.key, $event)"
      />
    </div>
    <p class="ob-hint">{{ fetching ? t('onboarding.model.fetching') : t('onboarding.model.slotNote') }}</p>
  </template>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Check, Eye, EyeOff, Loader2 } from 'lucide-vue-next'
import { useSettingsStore, type AuthMethod, type ProviderConfig } from '@/stores/settings'
import { PROVIDER_PRESETS } from '@/lib/providerPresets'
import SearchableSelect from '@/components/settings/SearchableSelect.vue'
import type { EnrichedModel } from '@/lib/modelCatalog'
import { loadProviderModels } from '@/lib/providerModels'
import { OAUTH_METHODS, defaultBaseUrlOf, resolveEndpoint } from '@/lib/providerConnection'
import type { ProbeFailure } from '@/lib/providerConnection'
import { normalizeApiUrl } from '@/utils/apiUrl'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const METHOD_OPTIONS: ReadonlyArray<{ id: AuthMethod; name: string; color: string; oauth: boolean }> = [
  { id: 'anthropic_compatible', name: 'Anthropic', color: '#d97757', oauth: false },
  { id: 'openai_compatible', name: 'OpenAI', color: '#10a37f', oauth: false },
  { id: 'gemini_api', name: 'Gemini', color: '#4285f4', oauth: false },
  { id: 'claudeai', name: 'Claude', color: '#cc785c', oauth: true },
  { id: 'console', name: 'Console', color: '#5c5f7a', oauth: true }
]

type SlotKey = 'haikuModel' | 'sonnetModel' | 'opusModel'

const SLOTS: ReadonlyArray<{ key: SlotKey; labelKey: string }> = [
  { key: 'sonnetModel', labelKey: 'onboarding.model.slotBalanced' },
  { key: 'opusModel', labelKey: 'onboarding.model.slotPowerful' },
  { key: 'haikuModel', labelKey: 'onboarding.model.slotFast' }
]

const showKey = ref(false)
const probing = ref(false)
const fetching = ref(false)
const availableModels = ref<EnrichedModel[]>([])
const probe = ref<{ count: number } | { reason: ProbeFailure } | null>(null)

const isOAuthMethod = computed(() => OAUTH_METHODS.has(settingsStore.authMethod))

const activeConfig = computed<ProviderConfig>(() => {
  switch (settingsStore.authMethod) {
    case 'openai_compatible': return settingsStore.openaiConfig
    case 'gemini_api': return settingsStore.geminiConfig
    default: return settingsStore.anthropicConfig
  }
})

const presets = computed(() => PROVIDER_PRESETS[settingsStore.authMethod] ?? [])

const presetIndex = computed(() => {
  const index = presets.value.findIndex(p => p.baseUrl === activeConfig.value.baseUrl)
  return index === -1 ? 0 : index
})

const ready = computed(() => settingsStore.isConfigured)

const endpoint = computed(() => resolveEndpoint(settingsStore.authMethod, {
  anthropic: settingsStore.anthropicConfig,
  openai: settingsStore.openaiConfig,
  gemini: settingsStore.geminiConfig
}))

const endpointPath = computed(() =>
  endpoint.value ? `${normalizeApiUrl(endpoint.value.baseUrl, endpoint.value.target)}/models` : ''
)

const probeOk = computed(() => !!probe.value && 'count' in probe.value)

const probeMessage = computed(() => {
  const result = probe.value
  if (!result) return ''
  if ('count' in result) return t('onboarding.model.testOk', { count: result.count })
  if (result.reason === 'no-key') return t('onboarding.model.testNoKey')
  if (result.reason === 'proxy') return t('onboarding.model.testProxy')
  return t('onboarding.model.testFailed')
})

function badgeKey(badgeType: 'recommended' | 'official'): string {
  return badgeType === 'official' ? 'auth.badgeOfficial' : 'auth.badgeRecommended'
}

/** 拉一次列表填进下拉。silent=true 时不弹失败提示 —— 拉不通就退回兜底候选。 */
async function refreshModels(silent: boolean) {
  const target = endpoint.value
  if (!target) return
  fetching.value = true
  try {
    const result = await loadProviderModels(target, settingsStore.modelCapabilities)
    availableModels.value = result.models
    if (!silent) {
      probe.value = result.fromEndpoint
        ? { count: result.models.length }
        : { reason: result.reason ?? 'network' }
    }
  } catch (e) {
    console.error('[ModelStep] Failed to load provider models:', e)
    if (!silent) {
      probe.value = { reason: 'network' }
    }
  } finally {
    fetching.value = false
  }
}

watch(
  () => `${settingsStore.authMethod}|${activeConfig.value.baseUrl}|${activeConfig.value.apiKey}`,
  () => { void refreshModels(true) },
  { immediate: true }
)

function selectMethod(next: AuthMethod) {
  if (OAUTH_METHODS.has(next) || settingsStore.authMethod === next) return
  settingsStore.authMethod = next
  probe.value = null
  void settingsStore.saveSettings()
}

function selectPreset(index: number) {
  const preset = presets.value[index]
  if (!preset) return
  activeConfig.value.baseUrl = preset.baseUrl
  void settingsStore.saveSettings()
}

function commitBaseUrl(event: Event) {
  activeConfig.value.baseUrl = (event.target as HTMLInputElement).value.trim()
  probe.value = null
  void settingsStore.saveSettings()
}

function commitApiKey(event: Event) {
  activeConfig.value.apiKey = (event.target as HTMLInputElement).value.trim()
  probe.value = null
  void settingsStore.saveSettings()
}

function commitSlot(key: SlotKey, value: string) {
  activeConfig.value[key] = value
  void settingsStore.saveSettings()
}

async function runTest() {
  if (!endpoint.value) return
  probing.value = true
  probe.value = null
  await refreshModels(false)
  probing.value = false
}
</script>

<style lang="scss" scoped>
.key-block {
  margin-top: 12px;
}

.test-row {
  margin-top: 12px;
}

.state {
  margin-left: auto;
  font-size: var(--text-2xs);
  padding: 4px 9px;
  border-radius: var(--radius-full);

  &.is-ok {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
    font-weight: var(--font-weight-semibold);
  }

  &.is-pending {
    background: color-mix(in srgb, var(--warning) 16%, transparent);
    color: var(--warning);
    font-weight: var(--font-weight-semibold);
  }
}

.ob-slot :deep(.select-trigger) {
  padding: 8px 12px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.spin {
  animation: ob-rotate 1s linear infinite;
}

@keyframes ob-rotate {
  to { transform: rotate(360deg); }
}
</style>
