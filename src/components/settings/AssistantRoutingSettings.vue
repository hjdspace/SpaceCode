<template>
  <div class="assistant-routing-settings s-page-shell">
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">{{ t('settings.title') }}</div>
      <h1 class="s-masthead-title">{{ t('settings.assistantRouting.title') }}</h1>
      <p class="s-masthead-desc">{{ t('settings.assistantRouting.description') }}</p>
    </div>

    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon"><Route :size="14" /></div>
          <span class="s-panel-title">{{ t('settings.assistantRouting.panelTitle') }}</span>
        </div>
        <span v-if="status" class="s-status-badge" :class="status" data-test="save-status">
          {{ status === 'success' ? t('settings.assistantRouting.saved') : t('settings.assistantRouting.saveFailed') }}
        </span>
      </div>

      <div class="s-panel-body">
        <div class="s-toggle-wrapper">
          <div class="s-toggle-info">
            <label class="s-toggle-label" for="routing-enabled">{{ t('settings.assistantRouting.enabledLabel') }}</label>
            <span class="s-toggle-description">{{ enabledHint }}</span>
          </div>
          <input
            id="routing-enabled"
            v-model="enabled"
            data-test="routing-enabled"
            type="checkbox"
            class="s-toggle-switch"
            @change="onEnabledChange"
          />
        </div>

        <div class="s-form-group">
          <label class="s-form-label" for="routing-model-source">{{ t('settings.assistantRouting.modelSourceLabel') }}</label>
          <select
            id="routing-model-source"
            v-model="modelSource"
            data-test="model-source"
            class="s-form-select"
            @change="onSourceChange"
          >
            <option value="follow-fast">{{ t('settings.assistantRouting.modelSourceFollowFast') }}</option>
            <option value="custom">{{ t('settings.assistantRouting.modelSourceCustom') }}</option>
          </select>
        </div>

        <div v-if="modelSource === 'follow-fast'" class="routing-fast-summary" data-test="fast-summary">
          <template v-if="followFastAvailable">
            <span class="routing-fast-label">{{ t('settings.assistantRouting.followFastModel') }}</span>
            <code class="routing-fast-model" data-test="fast-model">
              {{ fastModel || t('settings.assistantRouting.followFastUnspecified') }}
            </code>
          </template>
          <p v-else class="s-form-hint routing-warning">{{ t('settings.assistantRouting.followFastUnavailable') }}</p>
          <p class="s-form-hint">{{ t('settings.assistantRouting.followFastHint') }}</p>
        </div>

        <template v-else>
          <div class="s-form-group">
            <label class="s-form-label" for="routing-provider">{{ t('settings.assistantRouting.providerLabel') }}</label>
            <select
              id="routing-provider"
              v-model="provider"
              data-test="provider"
              class="s-form-select"
              @change="markDirty"
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>

          <div class="s-form-group">
            <label class="s-form-label" for="routing-base-url">{{ t('settings.assistantRouting.baseUrlLabel') }}</label>
            <input
              id="routing-base-url"
              v-model="baseUrl"
              data-test="base-url"
              class="s-form-input"
              type="text"
              :placeholder="t('settings.assistantRouting.baseUrlPlaceholder')"
              spellcheck="false"
              @input="markDirty"
            />
          </div>

          <div class="s-form-group">
            <label class="s-form-label" for="routing-api-key">{{ t('settings.assistantRouting.apiKeyLabel') }}</label>
            <div class="s-input-with-action">
              <input
                id="routing-api-key"
                v-model="apiKey"
                data-test="api-key"
                class="s-form-input"
                :type="showKey ? 'text' : 'password'"
                :placeholder="t('settings.assistantRouting.apiKeyPlaceholder')"
                spellcheck="false"
                autocomplete="off"
                @input="markDirty"
              />
              <button
                class="s-btn s-btn-secondary"
                type="button"
                data-test="toggle-key"
                @click="showKey = !showKey"
              >
                <component :is="showKey ? EyeOff : Eye" :size="14" />
                <span>{{ showKey ? t('settings.assistantRouting.hideKey') : t('settings.assistantRouting.showKey') }}</span>
              </button>
            </div>
            <p class="s-form-hint">{{ t('settings.assistantRouting.apiKeyHint') }}</p>
          </div>

          <div class="s-form-group">
            <label class="s-form-label" for="routing-model">{{ t('settings.assistantRouting.modelLabel') }}</label>
            <input
              id="routing-model"
              v-model="model"
              data-test="model"
              class="s-form-input"
              type="text"
              :placeholder="t('settings.assistantRouting.modelPlaceholder')"
              spellcheck="false"
              autocomplete="off"
              @input="markDirty"
            />
          </div>

          <p class="s-form-hint">{{ t('settings.assistantRouting.customHint') }}</p>
          <p v-if="!customHasKey" class="s-form-hint routing-warning">{{ t('settings.assistantRouting.customUnavailableHint') }}</p>

          <div class="save-row">
            <button class="s-btn s-btn-primary" type="button" data-test="save" :disabled="saving" @click="saveCustom">
              {{ saving ? t('settings.assistantRouting.saving') : t('settings.assistantRouting.save') }}
            </button>
          </div>
        </template>

        <p v-if="validationError" class="s-form-hint validation-error">{{ validationError }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff, Route } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { resolveRouterModelBinding } from '@/services/assistantRouter'
import type { RouterConfig } from '@/types/workRouting'

const { t } = useI18n()
const settingsStore = useSettingsStore()

const enabled = ref(settingsStore.routerConfig.enabled)
const modelSource = ref<RouterConfig['modelSource']>(settingsStore.routerConfig.modelSource)
const provider = ref<NonNullable<RouterConfig['provider']>>(settingsStore.routerConfig.provider ?? 'anthropic')
const baseUrl = ref(settingsStore.routerConfig.baseUrl ?? '')
const apiKey = ref(settingsStore.routerConfig.apiKey ?? '')
const model = ref(settingsStore.routerConfig.model ?? '')

const showKey = ref(false)
const saving = ref(false)
const status = ref<'success' | 'error' | null>(null)
const validationError = ref('')
/** 用户动过 custom 表单后，迟到的配置回灌不能覆盖他正在填的内容。 */
const dirty = ref(false)

/** 与真实决策共用同一条规则：haiku 槽位 → 主模型回退；无 key（OAuth）不可用。 */
const followFastBinding = computed(() =>
  resolveRouterModelBinding(
    { ...settingsStore.routerConfig, modelSource: 'follow-fast' },
    settingsStore.config,
    settingsStore.getHaikuModel(),
  ),
)
const followFastAvailable = computed(() => !!followFastBinding.value)
const fastModel = computed(() => followFastBinding.value?.model)
const customHasKey = computed(() => apiKey.value.trim().length > 0)
const enabledHint = computed(() =>
  enabled.value
    ? t('settings.assistantRouting.enabledHint')
    : t('settings.assistantRouting.disabledHint'),
)

function applyConfig(next: RouterConfig): void {
  enabled.value = next.enabled
  modelSource.value = next.modelSource
  provider.value = next.provider ?? 'anthropic'
  baseUrl.value = next.baseUrl ?? ''
  apiKey.value = next.apiKey ?? ''
  model.value = next.model ?? ''
}

// 面板可能挂载早于 gui-settings.json 落地（KeepAlive 会把它留住）；配置到达后回灌。
watch(
  () => settingsStore.routerConfig,
  (next) => {
    if (dirty.value || !next) return
    applyConfig(next)
  },
)

function markDirty(): void {
  dirty.value = true
  status.value = null
  validationError.value = ''
}

async function persist(patch: Partial<RouterConfig>): Promise<void> {
  saving.value = true
  status.value = null
  const result = await settingsStore.setRouterConfig(patch)
  saving.value = false
  status.value = result.success ? 'success' : 'error'
}

async function commit(patch: Partial<RouterConfig>): Promise<void> {
  status.value = null
  validationError.value = ''
  await persist(patch)
}

async function onEnabledChange(): Promise<void> {
  await commit({ enabled: enabled.value })
}

/**
 * 「自定义」只是打开表单：连接字段齐全并按下保存前，仍然沿用 follow-fast。
 * 切回 follow-fast 没有表单可保存，立即落盘并让表单回到已存配置。
 */
async function onSourceChange(): Promise<void> {
  if (modelSource.value === 'custom') {
    status.value = null
    validationError.value = ''
    return
  }
  dirty.value = false
  await commit({ modelSource: 'follow-fast' })
}

async function saveCustom(): Promise<void> {
  validationError.value = ''
  const url = baseUrl.value.trim().replace(/\/+$/, '')
  if (url && !/^https?:\/\/\S+$/i.test(url)) {
    validationError.value = t('settings.assistantRouting.invalidBaseUrl')
    return
  }

  dirty.value = false
  await persist({
    modelSource: 'custom',
    provider: provider.value,
    baseUrl: url,
    apiKey: apiKey.value.trim(),
    model: model.value.trim(),
  })
  if (status.value === 'success') applyConfig(settingsStore.routerConfig)
}
</script>

<style scoped lang="scss">
.routing-fast-summary {
  margin-top: 16px;
  padding: 14px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.routing-fast-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.routing-fast-model {
  margin-left: 8px;
  padding: 2px 8px;
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 5px;
}

.routing-warning {
  color: var(--warning);
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
