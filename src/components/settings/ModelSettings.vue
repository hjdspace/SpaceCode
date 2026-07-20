<template>
  <div class="model-settings">
    <!-- ═══ 2 列 Grid 主体 ═══ -->
    <div class="ms-grid">

      <!-- ─── 卡片 1：连接配置（左列，跨 1 行） ─── -->
      <section class="ms-card ms-card-connection">
        <header class="ms-card-header">
          <div class="ms-card-title">
            <div class="ms-card-icon"><Server :size="15" /></div>
            <h2>{{ $t('settings.connectionConfig') }}</h2>
          </div>
          <div class="provider-tabs" role="tablist" :aria-label="$t('settings.connectionConfig')">
            <button
              v-for="method in authMethods"
              :key="method.id"
              class="provider-tab"
              :class="{ active: authMethod === method.id }"
              type="button"
              role="tab"
              :aria-selected="authMethod === method.id"
              @click="selectAuthMethod(method.id)"
            >
              {{ method.title }}
            </button>
          </div>
        </header>

        <div class="ms-card-body">
          <!-- API Key 模式（Anthropic / OpenAI / Gemini） -->
          <div v-if="isApiKeyMode" class="ms-form">
            <!-- Base URL -->
            <div class="ms-form-row">
              <label class="ms-form-label">{{ $t('auth.baseUrl') }}</label>
              <div class="ms-input-group">
                <button
                  class="provider-logo-btn"
                  type="button"
                  :aria-label="$t('auth.preset')"
                  @click="togglePresetDropdown(activeTarget)"
                >
                  <div
                    v-if="selectedProviders[activeTarget]"
                    class="provider-logo"
                    :class="selectedProviders[activeTarget]!.logoClass"
                  >
                    <div
                      v-if="selectedProviders[activeTarget]!.logoType === 'svgRaw'"
                      class="logo-svg"
                      v-html="selectedProviders[activeTarget]!.svgRaw"
                    />
                    <img
                      v-else-if="selectedProviders[activeTarget]!.logoType === 'img'"
                      :src="selectedProviders[activeTarget]!.logoSrc"
                      class="logo-img"
                      alt="logo"
                    />
                  </div>
                  <Globe v-else :size="16" />
                </button>
                <input
                  type="text"
                  v-model="activeConfig.baseUrl"
                  :placeholder="activePlaceholder"
                  class="ms-input mono"
                />
                <button
                  class="ms-btn-ghost"
                  type="button"
                  :class="{ active: activeDropdown === activeTarget }"
                  @click="togglePresetDropdown(activeTarget)"
                >
                  {{ $t('auth.preset') }}
                  <ChevronDown :size="12" />
                </button>
              </div>
              <BaseUrlPresets
                :visible="activeDropdown === activeTarget"
                :presets="currentPresets"
                :selected-id="selectedProviders[activeTarget]?.id ?? null"
                @select="(p) => selectProvider(activeTarget, p)"
                @close="activeDropdown = null"
              />
              <span v-if="authMethod === 'anthropic_compatible'" class="ms-form-hint">{{ $t('auth.leaveEmptyDefault') }}</span>
              <span v-else-if="authMethod === 'gemini_api'" class="ms-form-hint">{{ $t('auth.leaveEmptyGoogleDefault') }}</span>
            </div>

            <!-- API Key -->
            <div class="ms-form-row">
              <label class="ms-form-label">{{ $t('auth.apiKey') }}</label>
              <div class="ms-api-key-group">
                <input
                  :type="showApiKey ? 'text' : 'password'"
                  v-model="activeConfig.apiKey"
                  :placeholder="activeKeyPlaceholder"
                  class="ms-input mono"
                />
                <button class="ms-btn-icon" type="button" @click="showApiKey = !showApiKey" :aria-label="$t('auth.apiKey')">
                  <Eye v-if="!showApiKey" :size="14" />
                  <EyeOff v-else :size="14" />
                </button>
                <button
                  class="ms-btn-outline-accent"
                  type="button"
                  :disabled="testing"
                  @click="testConnection"
                >
                  <Loader2 v-if="testing" :size="13" class="spin" />
                  <Plug v-else :size="13" />
                  {{ testing ? $t('auth.testing') : $t('auth.testConnection') }}
                </button>
                <button
                  class="ms-btn-outline-accent"
                  type="button"
                  :disabled="fetchingModels"
                  @click="fetchModels"
                >
                  <RefreshCw v-if="fetchingModels" :size="13" class="spin" />
                  <Download v-else :size="13" />
                  {{ fetchingModels ? $t('auth.fetching') : $t('auth.fetchModels') }}
                </button>
              </div>
            </div>

            <!-- 连接状态条 -->
            <div v-if="connectionStatus" class="ms-status-bar" :class="connectionStatus.type" role="status">
              <CheckCircle v-if="connectionStatus.type === 'success'" :size="14" />
              <XCircle v-else-if="connectionStatus.type === 'error'" :size="14" />
              <AlertCircle v-else :size="14" />
              <span class="status-text">{{ connectionStatus.message }}</span>
              <span v-if="connectionStatus.type === 'success'" class="status-timestamp">{{ $t('settings.justNow') }}</span>
            </div>
          </div>

          <!-- OAuth 模式（Claude.ai / Console） -->
          <div v-else class="ms-oauth-card">
            <div class="oauth-icon">
              <Crown v-if="authMethod === 'claudeai'" :size="18" />
              <Key v-else :size="18" />
            </div>
            <div class="oauth-info">
              <div class="oauth-title">
                {{ authMethod === 'claudeai' ? $t('auth.claudeAccount') : $t('auth.anthropicConsole') }}
              </div>
              <div class="oauth-desc">
                {{ authMethod === 'claudeai' ? $t('auth.signInClaudeDesc') : $t('auth.signInConsoleDesc') }}
              </div>
              <div v-if="oauthAccount" class="oauth-account">
                <span class="account-dot"></span>
                <span>{{ $t('auth.loggedInAs') }} {{ oauthAccount.email }}</span>
                <span v-if="oauthAccount.subscription && authMethod === 'claudeai'" class="subscription-badge">{{ oauthAccount.subscription }}</span>
              </div>
            </div>
            <button
              class="ms-btn-outline-accent"
              type="button"
              :disabled="oauthLoading"
              @click="startOAuthLogin(authMethod === 'claudeai')"
            >
              <LogIn :size="13" />
              {{ oauthLoading ? $t('auth.connecting') : (authMethod === 'claudeai' ? $t('auth.signInWithClaude') : $t('auth.signInWithConsole')) }}
            </button>
          </div>
        </div>
      </section>

      <!-- ─── 卡片 2：模型选择（右列，跨 2 行） ─── -->
      <section class="ms-card ms-card-models">
        <header class="ms-card-header">
          <div class="ms-card-title">
            <div class="ms-card-icon"><Bot :size="15" /></div>
            <h2>{{ $t('settings.modelSelection') }}</h2>
          </div>
        </header>

        <div class="ms-card-body ms-models-body">
          <div class="ms-model-row">
            <div class="ms-model-row-head">
              <span class="ms-tag ms-tag-fast">{{ $t('model.fast') }}</span>
              <span class="ms-model-role">{{ $t('model.haikuModel') }}</span>
            </div>
            <SearchableSelect
              v-model="haikuModel"
              :options="availableModels"
              :placeholder="$t('model.selectModel')"
            />
          </div>

          <div class="ms-model-row">
            <div class="ms-model-row-head">
              <span class="ms-tag ms-tag-recommended">{{ $t('model.balanced') }}</span>
              <span class="ms-model-role">{{ $t('model.sonnetModel') }}</span>
            </div>
            <SearchableSelect
              v-model="sonnetModel"
              :options="availableModels"
              :placeholder="$t('model.selectModel')"
            />
          </div>

          <div class="ms-model-row">
            <div class="ms-model-row-head">
              <span class="ms-tag ms-tag-powerful">{{ $t('model.powerful') }}</span>
              <span class="ms-model-role">{{ $t('model.opusModel') }}</span>
            </div>
            <SearchableSelect
              v-model="opusModel"
              :options="availableModels"
              :placeholder="$t('model.selectModel')"
            />
          </div>

          <p class="ms-hint">
            <Info :size="12" />
            {{ $t('settings.modelSwitchHint') }}
          </p>
        </div>
      </section>

      <!-- ─── 卡片 3：上下文窗口（底部全宽） ─── -->
      <section class="ms-card ms-card-context">
        <header class="ms-card-header">
          <div class="ms-card-title">
            <div class="ms-card-icon"><BarChart3 :size="15" /></div>
            <h2>{{ $t('contextUsage.modelContextTitle') }}</h2>
          </div>
          <button class="ms-link-btn" type="button" @click="resetContextWindows">
            <RotateCcw :size="11" />
            {{ $t('settings.resetDefault') }}
          </button>
        </header>

        <div class="ms-card-body">
          <p class="ms-context-desc">{{ $t('contextUsage.modelContextDesc') }}</p>

          <!-- 上半：3 列模型上下文选择 -->
          <div class="ms-context-grid">
            <div v-for="m in contextWindowModels" :key="m.key" class="ms-context-item">
              <div class="ms-model-row-head">
                <span class="ms-tag" :class="`ms-tag-${m.tagClass}`">{{ m.tag }}</span>
                <span class="ms-model-role">{{ m.role }}</span>
              </div>
              <div class="ms-context-model-name" :title="m.modelId || m.placeholder">{{ m.modelId || m.placeholder }}</div>
              <select
                class="ms-context-select"
                :value="getContextWindow(m.modelId)"
                :disabled="!m.modelId"
                @change="setContextWindow(m.modelId, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">{{ $t('contextUsage.contextWindowDefault') }}</option>
                <option v-for="preset in contextWindowPresets" :key="preset.value" :value="preset.value">
                  {{ preset.label }}
                </option>
              </select>
            </div>
          </div>

          <!-- 下半：上下文预览 -->
          <div class="ms-context-preview">
            <ContextUsagePreview :model-id="previewModelId" />
          </div>
        </div>
      </section>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  Server, Bot, Crown, Key, LogIn, CheckCircle,
  Eye, EyeOff, RefreshCw, Plug, Loader2, Download,
  XCircle, AlertCircle, BarChart3, ChevronDown, Globe, Info, RotateCcw
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import { useSettingsStore, CONTEXT_WINDOW_PRESETS } from '@/stores/settings'
import type { AuthMethod, OAuthAccountInfo, ProviderConfig } from '@/stores/settings'
import SearchableSelect from './SearchableSelect.vue'
import ContextUsagePreview from './ContextUsagePreview.vue'
import BaseUrlPresets from './BaseUrlPresets.vue'
import { PROVIDER_PRESETS } from '@/lib/providerPresets'
import type { ProviderPreset } from '@/lib/providerPresets'

const props = defineProps<{
  modelValue: {
    authMethod: AuthMethod
    anthropicConfig: ProviderConfig
    openaiConfig: ProviderConfig
    geminiConfig: ProviderConfig
    oauthAccount: OAuthAccountInfo | null
  }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: typeof props.modelValue]
  'change': []
}>()

const settingsStore = useSettingsStore()
const { t } = useI18n()

const authMethods = computed(() => [
  { id: 'anthropic_compatible' as AuthMethod, title: 'Anthropic' },
  { id: 'openai_compatible' as AuthMethod, title: 'OpenAI' },
  { id: 'gemini_api' as AuthMethod, title: 'Gemini' },
  { id: 'claudeai' as AuthMethod, title: 'Claude' },
  { id: 'console' as AuthMethod, title: 'Console' }
])

const config = computed({
  get: () => props.modelValue,
  set: (val) => {
    emit('update:modelValue', val)
    emit('change')
  }
})

const authMethod = computed({
  get: () => config.value.authMethod,
  set: (val) => config.value.authMethod = val
})

const oauthAccount = computed(() => config.value.oauthAccount)

// 是否为 API Key 模式（非 OAuth）
const isApiKeyMode = computed(() =>
  authMethod.value === 'anthropic_compatible' ||
  authMethod.value === 'openai_compatible' ||
  authMethod.value === 'gemini_api'
)

// 当前激活的 provider target（用于 BaseUrlPresets 联动）
const activeTarget = computed<'anthropic' | 'openai' | 'gemini'>(() => {
  if (authMethod.value === 'openai_compatible') return 'openai'
  if (authMethod.value === 'gemini_api') return 'gemini'
  return 'anthropic'
})

// 当前激活的 config 引用（直接 v-model 绑定）
const activeConfig = computed<ProviderConfig>(() => {
  if (authMethod.value === 'openai_compatible') return config.value.openaiConfig
  if (authMethod.value === 'gemini_api') return config.value.geminiConfig
  return config.value.anthropicConfig
})

const activePlaceholder = computed(() => {
  if (authMethod.value === 'openai_compatible') return 'https://api.openai.com/v1'
  if (authMethod.value === 'gemini_api') return 'https://generativelanguage.googleapis.com/v1beta'
  return 'https://api.anthropic.com'
})

const activeKeyPlaceholder = computed(() => {
  if (authMethod.value === 'openai_compatible') return 'sk-...'
  if (authMethod.value === 'gemini_api') return 'AIza...'
  return 'sk-ant-...'
})

// 共享模型字段 — 从 anthropicConfig 读取（所有 provider 保持同步），写入所有 provider config
const haikuModel = computed({
  get: () => config.value.anthropicConfig.haikuModel,
  set: (val: string) => {
    config.value.anthropicConfig.haikuModel = val
    config.value.openaiConfig.haikuModel = val
    config.value.geminiConfig.haikuModel = val
  },
})
const sonnetModel = computed({
  get: () => config.value.anthropicConfig.sonnetModel,
  set: (val: string) => {
    config.value.anthropicConfig.sonnetModel = val
    config.value.openaiConfig.sonnetModel = val
    config.value.geminiConfig.sonnetModel = val
  },
})
const opusModel = computed({
  get: () => config.value.anthropicConfig.opusModel,
  set: (val: string) => {
    config.value.anthropicConfig.opusModel = val
    config.value.openaiConfig.opusModel = val
    config.value.geminiConfig.opusModel = val
  },
})

const showApiKey = ref(false)
const testing = ref(false)
const fetchingModels = ref(false)
const oauthLoading = ref(false)
const connectionStatus = ref<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null)

// Preset dropdown state
const activeDropdown = ref<'anthropic' | 'openai' | 'gemini' | null>(null)
const selectedProviders = ref<Record<string, ProviderPreset | null>>({
  anthropic: null,
  openai: null,
  gemini: null,
})

const currentPresets = computed(() => {
  const key = authMethod.value === 'anthropic_compatible'
    ? 'anthropic_compatible'
    : authMethod.value === 'openai_compatible'
      ? 'openai_compatible'
      : authMethod.value === 'gemini_api'
        ? 'gemini_api'
        : ''
  return key ? PROVIDER_PRESETS[key] ?? [] : []
})

function togglePresetDropdown(target: 'anthropic' | 'openai' | 'gemini') {
  activeDropdown.value = activeDropdown.value === target ? null : target
}

function selectProvider(target: 'anthropic' | 'openai' | 'gemini', provider: ProviderPreset) {
  selectedProviders.value[target] = provider
  if (target === 'anthropic') {
    config.value.anthropicConfig.baseUrl = provider.baseUrl
  } else if (target === 'openai') {
    config.value.openaiConfig.baseUrl = provider.baseUrl
  } else if (target === 'gemini') {
    config.value.geminiConfig.baseUrl = provider.baseUrl
  }
}

const availableModels = ref<{ id: string; name?: string }[]>([])

const previewModelId = computed(
  () => settingsStore.config.model || sonnetModel.value || 'claude-sonnet-4-6',
)

const contextWindowPresets = CONTEXT_WINDOW_PRESETS

const contextWindowModels = computed(() => [
  { key: 'haiku', modelId: haikuModel.value, placeholder: t('model.haikuModel'), tag: t('model.fast'), tagClass: 'fast', role: 'Haiku' },
  { key: 'sonnet', modelId: sonnetModel.value, placeholder: t('model.sonnetModel'), tag: t('model.balanced'), tagClass: 'recommended', role: 'Sonnet' },
  { key: 'opus', modelId: opusModel.value, placeholder: t('model.opusModel'), tag: t('model.powerful'), tagClass: 'powerful', role: 'Opus' },
])

function getContextWindow(modelId: string): string {
  if (!modelId) return ''
  const val = settingsStore.modelContextWindows[modelId]
  return val ? String(val) : ''
}

function setContextWindow(modelId: string, value: string) {
  if (!modelId) return
  const updated = { ...settingsStore.modelContextWindows }
  if (value) {
    updated[modelId] = parseInt(value, 10)
  } else {
    delete updated[modelId]
  }
  settingsStore.modelContextWindows = updated
  settingsStore.saveSettings()
}

function resetContextWindows() {
  const updated = { ...settingsStore.modelContextWindows }
  for (const m of [haikuModel.value, sonnetModel.value, opusModel.value]) {
    if (m && updated[m]) delete updated[m]
  }
  settingsStore.modelContextWindows = updated
  settingsStore.saveSettings()
}

function normalizeApiUrl(baseUrl: string, provider: string): string {
  let url = baseUrl.replace(/\/+$/, '')

  if (provider === 'anthropic' && !url.includes('/v1')) {
    url += '/v1'
  } else if (provider === 'openai' && !url.includes('/v1')) {
    url += '/v1'
  }

  return url
}

const defaultModels = computed(() => {
  const models: { id: string; name?: string }[] = []

  switch (authMethod.value) {
    case 'anthropic_compatible':
    case 'claudeai':
    case 'console':
      models.push(
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
        { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' }
      )
      break
    case 'openai_compatible':
      models.push(
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
      )
      break
    case 'gemini_api':
      models.push(
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
        { id: 'gemini-pro', name: 'Gemini Pro' },
        { id: 'gemini-pro-vision', name: 'Gemini Pro Vision' }
      )
      break
  }

  return models
})

onMounted(() => {
  availableModels.value = [...defaultModels.value]
})

function selectAuthMethod(method: AuthMethod) {
  authMethod.value = method
  availableModels.value = [...defaultModels.value]
}

async function testConnection() {
  testing.value = true
  connectionStatus.value = null

  try {
    let baseUrl = ''
    let apiKey = ''
    let provider = ''

    switch (authMethod.value) {
      case 'anthropic_compatible':
        baseUrl = config.value.anthropicConfig.baseUrl || 'https://api.anthropic.com'
        apiKey = config.value.anthropicConfig.apiKey
        provider = 'anthropic'
        break
      case 'openai_compatible':
        baseUrl = config.value.openaiConfig.baseUrl || 'https://api.openai.com/v1'
        apiKey = config.value.openaiConfig.apiKey
        provider = 'openai'
        break
      case 'gemini_api':
        baseUrl = config.value.geminiConfig.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
        apiKey = config.value.geminiConfig.apiKey
        provider = 'gemini'
        break
    }

    if (!apiKey) {
      connectionStatus.value = { type: 'warning', message: t('auth.enterApiKeyFirst') }
      testing.value = false
      return
    }

    const normalizedUrl = normalizeApiUrl(baseUrl, provider)
    const url = `${normalizedUrl}/models`
    const result = await api.httpFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!result) {
      connectionStatus.value = { type: 'error', message: t('auth.httpProxyUnavailable') }
    } else if (result.ok) {
      connectionStatus.value = { type: 'success', message: t('auth.connectionSuccessful') }
    } else {
      connectionStatus.value = { type: 'error', message: t('auth.connectionFailed', { status: result.status, error: result.error || '' }) }
    }
  } catch (error) {
    connectionStatus.value = { type: 'error', message: error instanceof Error ? error.message : t('auth.networkError') }
  } finally {
    testing.value = false
    setTimeout(() => {
      connectionStatus.value = null
    }, 5000)
  }
}

async function fetchModels() {
  fetchingModels.value = true
  connectionStatus.value = null

  try {
    let baseUrl = ''
    let apiKey = ''
    let provider = ''

    switch (authMethod.value) {
      case 'anthropic_compatible':
        baseUrl = config.value.anthropicConfig.baseUrl || 'https://api.anthropic.com'
        apiKey = config.value.anthropicConfig.apiKey
        provider = 'anthropic'
        break
      case 'openai_compatible':
        baseUrl = config.value.openaiConfig.baseUrl || 'https://api.openai.com/v1'
        apiKey = config.value.openaiConfig.apiKey
        provider = 'openai'
        break
      case 'gemini_api':
        baseUrl = config.value.geminiConfig.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
        apiKey = config.value.geminiConfig.apiKey
        provider = 'gemini'
        break
    }

    if (!apiKey) {
      connectionStatus.value = { type: 'warning', message: t('auth.enterApiKeyFirst') }
      fetchingModels.value = false
      return
    }

    const normalizedUrl = normalizeApiUrl(baseUrl, provider)
    const url = `${normalizedUrl}/models`
    const result = await api.httpFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!result) {
      connectionStatus.value = { type: 'error', message: t('auth.httpProxyUnavailable') }
    } else if (result.ok) {
      const data = JSON.parse(result.data)
      let models: any[] = []

      if (Array.isArray(data)) {
        models = data
      } else if (data.data && Array.isArray(data.data)) {
        models = data.data
      } else if (data.models && Array.isArray(data.models)) {
        models = data.models
      }

      if (models.length > 0) {
        availableModels.value = models.map((m: any) => ({
          id: m.id || m.name || String(m),
          name: m.name || m.id || String(m)
        }))
        connectionStatus.value = { type: 'success', message: t('auth.fetchedModels', { count: models.length }) }
      } else {
        connectionStatus.value = { type: 'warning', message: t('auth.noModelsFound') }
      }
    } else {
      connectionStatus.value = { type: 'error', message: t('auth.fetchModelsFailed', { status: result.status, error: result.error || '' }) }
    }
  } catch (error) {
    connectionStatus.value = { type: 'error', message: error instanceof Error ? error.message : t('auth.networkError') }
  } finally {
    fetchingModels.value = false
    setTimeout(() => {
      connectionStatus.value = null
    }, 5000)
  }
}

async function startOAuthLogin(_isClaudeAi: boolean) {
  oauthLoading.value = true
  await new Promise(r => setTimeout(r, 1000))
  oauthLoading.value = false
}
</script>

<style lang="scss" scoped>
.model-settings {
  display: block;
  /* 允许 BaseUrlPresets 下拉溢出 */
  overflow: visible;
}

/* ═══ 垂直三段式布局：连接配置 → 模型选择 → 上下文窗口 ═══ */
.ms-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: stretch;
}

@media (max-width: 880px) {
  .ms-grid { gap: 12px; }
}

/* ═══ 卡片基础 ═══ */
.ms-card {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow: visible;
  transition: box-shadow var(--transition-fast), border-color var(--transition-fast);
  &:hover {
    box-shadow: var(--shadow-md);
    border-color: var(--border-default);
  }
}

.ms-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
  flex-wrap: wrap;
}

.ms-card-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ms-card-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ms-card-title h2 {
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  margin: 0;
}

/* ═══ Provider tab 切换 ═══ */
.provider-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}

.provider-tab {
  position: relative;
  padding: 6px 10px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--transition-fast), background var(--transition-fast);
  &:hover {
    color: var(--text-secondary);
    background: var(--bg-secondary);
  }
  &.active {
    color: var(--accent-primary);
    font-weight: 600;
  }
  &.active::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 0;
    height: 2px;
    background: var(--accent-primary);
    border-radius: 1px 1px 0 0;
  }
}

/* ═══ 卡片体 ═══ */
.ms-card-body {
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ms-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ms-form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.ms-form-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.ms-form-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.ms-input-group {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
}

.ms-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  &::placeholder { color: var(--text-disabled); }
  &:hover { border-color: var(--border-strong); }
  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }
  &.mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
}

/* Provider logo 占位按钮（Base URL 左侧 40x34） */
.provider-logo-btn {
  width: 40px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  overflow: hidden;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  &:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .provider-logo {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    .logo-svg {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      :deep(svg) { width: 16px; height: 16px; }
    }
    .logo-img {
      width: 18px;
      height: 18px;
      object-fit: contain;
    }
  }
}

/* 次要按钮（预设） */
.ms-btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  height: 34px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  &:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  &.active {
    background: var(--accent-primary-glow);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
}

/* 图标按钮（眼睛切换） */
.ms-btn-icon {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  &:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
}

/* Outline accent 按钮（测试连接 / 获取模型） */
.ms-btn-outline-accent {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 12px;
  height: 34px;
  background: var(--bg-elevated);
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-primary);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
  &:hover:not(:disabled) {
    background: var(--accent-primary-glow);
    box-shadow: 0 4px 12px var(--accent-primary-glow);
    transform: translateY(-1px);
  }
  &:active:not(:disabled) {
    transform: translateY(0);
    box-shadow: 0 1px 2px var(--accent-primary-glow);
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.ms-api-key-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  .ms-input { flex: 1; min-width: 200px; }
}

/* ═══ 连接状态条 ═══ */
.ms-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 500;
  border: 1px solid transparent;
  &.success {
    background: var(--success-glow);
    color: var(--success);
    border-color: rgba(5, 150, 105, 0.22);
  }
  &.error {
    background: var(--error-glow);
    color: var(--error);
    border-color: rgba(220, 38, 38, 0.22);
  }
  &.warning {
    background: var(--warning-glow);
    color: var(--warning);
    border-color: rgba(217, 119, 6, 0.22);
  }
  .status-text { flex: 1; }
  .status-timestamp {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 400;
    opacity: 0.7;
  }
}

/* ═══ OAuth 卡片 ═══ */
.ms-oauth-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--bg-secondary);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  flex-wrap: wrap;
}

.oauth-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.oauth-info {
  flex: 1;
  min-width: 200px;
  .oauth-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 2px;
  }
  .oauth-desc {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.45;
  }
  .oauth-account {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    font-size: 11px;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    .account-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--success);
    }
    .subscription-badge {
      padding: 2px 6px;
      background: var(--accent-primary);
      color: #fff;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
    }
  }
}

/* ═══ 模型选择卡片 ═══ */
.ms-models-body {
  gap: 10px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

@media (max-width: 720px) {
  .ms-models-body { grid-template-columns: 1fr; }
}

.ms-model-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition: border-color var(--transition-fast), background var(--transition-fast);
  &:hover {
    border-color: var(--border-default);
    background: var(--surface-card);
  }
}

.ms-model-row-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ms-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: lowercase;
  line-height: 1.5;
}

.ms-tag-fast {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.ms-tag-recommended {
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  font-weight: 600;
}

.ms-tag-powerful {
  background: var(--accent-secondary-glow, rgba(99, 102, 241, 0.12));
  color: var(--accent-secondary);
  font-weight: 600;
}

.ms-model-role {
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.005em;
}

.ms-hint {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 4px 0;
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* ═══ 上下文窗口卡片 ═══ */
.ms-link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);
  &:hover {
    color: var(--accent-primary);
    background: var(--accent-primary-glow);
  }
}

.ms-context-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-muted);
}

.ms-context-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px dashed var(--border-default);
}

.ms-context-item {
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color var(--transition-fast);
  &:hover { border-color: var(--border-default); }
}

.ms-context-model-name {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ms-context-select {
  width: 100%;
  padding: 5px 8px;
  font-size: 11px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-primary);
  cursor: pointer;
  font-family: inherit;
  outline: none;
  &:focus { border-color: var(--accent-primary); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.ms-context-preview {
  padding-top: 4px;
}

@media (max-width: 600px) {
  .ms-context-grid { grid-template-columns: 1fr; }
}

/* ═══ 通用 ═══ */
.spin { animation: spin 1s linear infinite; }

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* SearchableSelect 深度样式适配紧凑卡片 */
.ms-model-row :deep(.searchable-select .select-trigger) {
  height: 30px;
  padding: 0 10px;
  font-family: var(--font-mono);
  font-size: 12px;
}
</style>
