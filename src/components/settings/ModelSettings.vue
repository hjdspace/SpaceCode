<template>
  <div class="model-settings">
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">Settings</div>
      <h1 class="s-masthead-title">{{ $t('settings.modelSettings') }}</h1>
      <p class="s-masthead-desc">{{ $t('settings.modelSettingsDesc') || '配置 AI 模型提供商、API 密钥和模型选择' }}</p>
    </div>

    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon lang"><Server :size="14" /></div>
          <span class="s-panel-title">{{ $t('settings.loginMethod') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="s-selection-grid">
          <div
            v-for="method in authMethods"
            :key="method.id"
            class="s-selection-card"
            :class="{ active: authMethod === method.id }"
            @click="selectAuthMethod(method.id)"
          >
            <div class="s-selection-card-icon">
              <component :is="method.icon" :size="20" />
            </div>
            <div class="s-selection-card-title">{{ method.title }}</div>
            <div class="s-selection-card-desc">{{ method.desc }}</div>
            <div class="s-check-badge">
              <Check :size="12" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="authMethod === 'anthropic_compatible'" class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon engine"><Server :size="14" /></div>
          <span class="s-panel-title">{{ $t('auth.anthropicConfig') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="s-form-group">
          <label class="s-form-label">{{ $t('auth.baseUrl') }}</label>
          <div class="baseurl-wrapper">
            <div class="baseurl-input-row">
              <div class="baseurl-selected-icon" @click="togglePresetDropdown('anthropic')">
                <div v-if="selectedProviders.anthropic" class="provider-logo" :class="selectedProviders.anthropic.logoClass">
                  <div v-if="selectedProviders.anthropic.logoType === 'svgRaw'" class="logo-svg" v-html="selectedProviders.anthropic.svgRaw" />
                  <img v-else-if="selectedProviders.anthropic.logoType === 'img'" :src="selectedProviders.anthropic.logoSrc" class="logo-img" alt="logo" />
                </div>
                <Globe v-else :size="16" class="baseurl-icon-default" />
              </div>
              <input
                type="text"
                v-model="config.anthropic.baseUrl"
                placeholder="https://api.anthropic.com"
                class="s-form-input baseurl-input"
              />
              <button
                class="s-btn s-btn-secondary baseurl-preset-btn"
                :class="{ active: activeDropdown === 'anthropic' }"
                @click="togglePresetDropdown('anthropic')"
              >
                <ChevronDown :size="14" />
                {{ $t('auth.preset') }}
              </button>
            </div>
            <BaseUrlPresets
              :visible="activeDropdown === 'anthropic'"
              :presets="currentPresets"
              :selected-id="selectedProviders.anthropic?.id ?? null"
              @select="(p) => selectProvider('anthropic', p)"
              @close="activeDropdown = null"
            />
          </div>
          <span class="s-form-hint">{{ $t('auth.leaveEmptyDefault') }}</span>
        </div>
        <div class="s-form-group">
          <label class="s-form-label">{{ $t('auth.apiKey') }}</label>
          <div class="s-input-with-action">
            <input
              :type="showApiKey ? 'text' : 'password'"
              v-model="config.anthropic.apiKey"
              placeholder="sk-ant-..."
              class="s-form-input"
            />
            <button class="s-btn-icon" @click="showApiKey = !showApiKey">
              <Eye v-if="!showApiKey" :size="16" />
              <EyeOff v-else :size="16" />
            </button>
          </div>
        </div>
        <div class="form-actions-row">
          <button class="s-btn s-btn-secondary" @click="testConnection" :disabled="testing">
            <Loader2 v-if="testing" :size="14" class="spin" />
            <Plug v-else :size="14" />
            {{ testing ? $t('auth.testing') : $t('auth.testConnection') }}
          </button>
          <button class="s-btn s-btn-secondary" @click="fetchModels" :disabled="fetchingModels">
            <RefreshCw v-if="fetchingModels" :size="14" class="spin" />
            <Download v-else :size="14" />
            {{ fetchingModels ? $t('auth.fetching') : $t('auth.fetchModels') }}
          </button>
        </div>
        <div v-if="connectionStatus" class="s-status-badge" :class="connectionStatus.type">
          <CheckCircle v-if="connectionStatus.type === 'success'" :size="14" />
          <XCircle v-if="connectionStatus.type === 'error'" :size="14" />
          <AlertCircle v-if="connectionStatus.type === 'warning'" :size="14" />
          <span>{{ connectionStatus.message }}</span>
        </div>
      </div>
    </div>

    <div v-else-if="authMethod === 'openai_compatible'" class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon engine"><Bot :size="14" /></div>
          <span class="s-panel-title">{{ $t('auth.openaiConfig') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="s-form-group">
          <label class="s-form-label">{{ $t('auth.baseUrl') }}</label>
          <div class="baseurl-wrapper">
            <div class="baseurl-input-row">
              <div class="baseurl-selected-icon" @click="togglePresetDropdown('openai')">
                <div v-if="selectedProviders.openai" class="provider-logo" :class="selectedProviders.openai.logoClass">
                  <div v-if="selectedProviders.openai.logoType === 'svgRaw'" class="logo-svg" v-html="selectedProviders.openai.svgRaw" />
                  <img v-else-if="selectedProviders.openai.logoType === 'img'" :src="selectedProviders.openai.logoSrc" class="logo-img" alt="logo" />
                </div>
                <Globe v-else :size="16" class="baseurl-icon-default" />
              </div>
              <input
                type="text"
                v-model="config.openai.baseUrl"
                placeholder="https://api.openai.com/v1"
                class="s-form-input baseurl-input"
              />
              <button
                class="s-btn s-btn-secondary baseurl-preset-btn"
                :class="{ active: activeDropdown === 'openai' }"
                @click="togglePresetDropdown('openai')"
              >
                <ChevronDown :size="14" />
                {{ $t('auth.preset') }}
              </button>
            </div>
            <BaseUrlPresets
              :visible="activeDropdown === 'openai'"
              :presets="currentPresets"
              :selected-id="selectedProviders.openai?.id ?? null"
              @select="(p) => selectProvider('openai', p)"
              @close="activeDropdown = null"
            />
          </div>
        </div>
        <div class="s-form-group">
          <label class="s-form-label">{{ $t('auth.apiKey') }}</label>
          <div class="s-input-with-action">
            <input
              :type="showApiKey ? 'text' : 'password'"
              v-model="config.openai.apiKey"
              placeholder="sk-..."
              class="s-form-input"
            />
            <button class="s-btn-icon" @click="showApiKey = !showApiKey">
              <Eye v-if="!showApiKey" :size="16" />
              <EyeOff v-else :size="16" />
            </button>
          </div>
        </div>
        <div class="form-actions-row">
          <button class="s-btn s-btn-secondary" @click="testConnection" :disabled="testing">
            <Loader2 v-if="testing" :size="14" class="spin" />
            <Plug v-else :size="14" />
            {{ testing ? $t('auth.testing') : $t('auth.testConnection') }}
          </button>
          <button class="s-btn s-btn-secondary" @click="fetchModels" :disabled="fetchingModels">
            <RefreshCw v-if="fetchingModels" :size="14" class="spin" />
            <Download v-else :size="14" />
            {{ fetchingModels ? $t('auth.fetching') : $t('auth.fetchModels') }}
          </button>
        </div>
        <div v-if="connectionStatus" class="s-status-badge" :class="connectionStatus.type">
          <CheckCircle v-if="connectionStatus.type === 'success'" :size="14" />
          <XCircle v-if="connectionStatus.type === 'error'" :size="14" />
          <AlertCircle v-if="connectionStatus.type === 'warning'" :size="14" />
          <span>{{ connectionStatus.message }}</span>
        </div>
      </div>
    </div>

    <div v-else-if="authMethod === 'gemini_api'" class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon engine"><Sparkles :size="14" /></div>
          <span class="s-panel-title">{{ $t('auth.geminiConfig') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="s-form-group">
          <label class="s-form-label">{{ $t('auth.baseUrl') }}</label>
          <div class="baseurl-wrapper">
            <div class="baseurl-input-row">
              <div class="baseurl-selected-icon" @click="togglePresetDropdown('gemini')">
                <div v-if="selectedProviders.gemini" class="provider-logo" :class="selectedProviders.gemini.logoClass">
                  <div v-if="selectedProviders.gemini.logoType === 'svgRaw'" class="logo-svg" v-html="selectedProviders.gemini.svgRaw" />
                  <img v-else-if="selectedProviders.gemini.logoType === 'img'" :src="selectedProviders.gemini.logoSrc" class="logo-img" alt="logo" />
                </div>
                <Globe v-else :size="16" class="baseurl-icon-default" />
              </div>
              <input
                type="text"
                v-model="config.gemini.baseUrl"
                placeholder="https://generativelanguage.googleapis.com/v1beta"
                class="s-form-input baseurl-input"
              />
              <button
                class="s-btn s-btn-secondary baseurl-preset-btn"
                :class="{ active: activeDropdown === 'gemini' }"
                @click="togglePresetDropdown('gemini')"
              >
                <ChevronDown :size="14" />
                {{ $t('auth.preset') }}
              </button>
            </div>
            <BaseUrlPresets
              :visible="activeDropdown === 'gemini'"
              :presets="currentPresets"
              :selected-id="selectedProviders.gemini?.id ?? null"
              @select="(p) => selectProvider('gemini', p)"
              @close="activeDropdown = null"
            />
          </div>
          <span class="s-form-hint">{{ $t('auth.leaveEmptyGoogleDefault') }}</span>
        </div>
        <div class="s-form-group">
          <label class="s-form-label">{{ $t('auth.apiKey') }}</label>
          <div class="s-input-with-action">
            <input
              :type="showApiKey ? 'text' : 'password'"
              v-model="config.gemini.apiKey"
              placeholder="AIza..."
              class="s-form-input"
            />
            <button class="s-btn-icon" @click="showApiKey = !showApiKey">
              <Eye v-if="!showApiKey" :size="16" />
              <EyeOff v-else :size="16" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="authMethod === 'claudeai'" class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon lang"><Crown :size="14" /></div>
          <span class="s-panel-title">{{ $t('auth.claudeAccount') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="oauth-content">
          <div class="oauth-icon-wrapper">
            <Crown :size="32" />
          </div>
          <p class="oauth-text">{{ $t('auth.signInClaudeDesc') }}</p>
          <p class="oauth-hint">{{ $t('auth.oauthHint') }}</p>
          <button class="s-btn s-btn-primary" @click="startOAuthLogin(true)" :disabled="oauthLoading">
            <LogIn :size="16" />
            {{ oauthLoading ? $t('auth.connecting') : $t('auth.signInWithClaude') }}
          </button>
          <div v-if="oauthAccount" class="oauth-status">
            <CheckCircle :size="16" class="success-icon" />
            <span>{{ $t('auth.loggedInAs') }} <strong>{{ oauthAccount.email }}</strong></span>
            <span class="subscription-badge">{{ oauthAccount.subscription }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="authMethod === 'console'" class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon lang"><Key :size="14" /></div>
          <span class="s-panel-title">{{ $t('auth.anthropicConsole') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="oauth-content">
          <div class="oauth-icon-wrapper">
            <Key :size="32" />
          </div>
          <p class="oauth-text">{{ $t('auth.signInConsoleDesc') }}</p>
          <p class="oauth-hint">{{ $t('auth.oauthHint') }}</p>
          <button class="s-btn s-btn-primary" @click="startOAuthLogin(false)" :disabled="oauthLoading">
            <LogIn :size="16" />
            {{ oauthLoading ? $t('auth.connecting') : $t('auth.signInWithConsole') }}
          </button>
          <div v-if="oauthAccount" class="oauth-status">
            <CheckCircle :size="16" class="success-icon" />
            <span>{{ $t('auth.loggedInAs') }} <strong>{{ oauthAccount.email }}</strong></span>
          </div>
        </div>
      </div>
    </div>

    <div class="s-panel model-config-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon engine"><Bot :size="14" /></div>
          <span class="s-panel-title">{{ $t('model.configuration') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="s-form-group">
          <label class="s-form-label">{{ $t('model.haikuModel') }} <span class="s-model-tag fast">{{ $t('model.fast') }}</span></label>
          <SearchableSelect
            v-model="config.haikuModel"
            :options="availableModels"
            :placeholder="$t('model.selectModel')"
          />
        </div>
        <div class="s-form-group">
          <label class="s-form-label">{{ $t('model.sonnetModel') }} <span class="s-model-tag recommended">{{ $t('model.balanced') }}</span></label>
          <SearchableSelect
            v-model="config.sonnetModel"
            :options="availableModels"
            :placeholder="$t('model.selectModel')"
          />
        </div>
        <div class="s-form-group">
          <label class="s-form-label">{{ $t('model.opusModel') }} <span class="s-model-tag powerful">{{ $t('model.powerful') }}</span></label>
          <SearchableSelect
            v-model="config.opusModel"
            :options="availableModels"
            :placeholder="$t('model.selectModel')"
          />
        </div>
      </div>
    </div>

    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon project"><BarChart3 :size="14" /></div>
          <span class="s-panel-title">{{ $t('contextUsage.modelContextTitle') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <p class="context-info-desc">{{ $t('contextUsage.modelContextDesc') }}</p>

        <div class="ctx-window-config">
          <div v-for="m in contextWindowModels" :key="m.key" class="ctx-window-row">
            <div class="ctx-window-label">
              <span class="ctx-window-model-tag" :class="m.tagClass">{{ m.tag }}</span>
              <span class="ctx-window-model-name" :title="m.modelId || m.placeholder">{{ m.modelId || m.placeholder }}</span>
            </div>
            <select
              class="s-form-select ctx-window-select"
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

        <ContextUsagePreview :model-id="previewModelId" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import {
  Server, Bot, Sparkles, Crown, Key, LogIn, CheckCircle,
  Eye, EyeOff, RefreshCw, Plug, Loader2, Download, Check,
  XCircle, AlertCircle, BarChart3, ChevronDown, Globe
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import { useSettingsStore, CONTEXT_WINDOW_PRESETS } from '@/stores/settings'
import type { AuthMethod, OAuthAccountInfo } from '@/stores/settings'
import SearchableSelect from './SearchableSelect.vue'
import ContextUsagePreview from './ContextUsagePreview.vue'
import BaseUrlPresets from './BaseUrlPresets.vue'
import { PROVIDER_PRESETS } from '@/lib/providerPresets'
import type { ProviderPreset } from '@/lib/providerPresets'

const props = defineProps<{
  modelValue: {
    authMethod: AuthMethod
    anthropic: { baseUrl: string; apiKey: string }
    openai: { baseUrl: string; apiKey: string }
    gemini: { baseUrl: string; apiKey: string }
    haikuModel: string
    sonnetModel: string
    opusModel: string
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
  { id: 'anthropic_compatible' as AuthMethod, title: 'Anthropic', desc: t('auth.compatibleApi'), icon: Server },
  { id: 'openai_compatible' as AuthMethod, title: 'OpenAI', desc: t('auth.compatibleApi'), icon: Bot },
  { id: 'gemini_api' as AuthMethod, title: 'Gemini', desc: t('auth.googleApi'), icon: Sparkles },
  { id: 'claudeai' as AuthMethod, title: 'Claude', desc: t('auth.accountOAuth'), icon: Crown },
  { id: 'console' as AuthMethod, title: 'Console', desc: t('auth.apiBilling'), icon: Key }
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
    config.value.anthropic.baseUrl = provider.baseUrl
  } else if (target === 'openai') {
    config.value.openai.baseUrl = provider.baseUrl
  } else if (target === 'gemini') {
    config.value.gemini.baseUrl = provider.baseUrl
  }
}

const availableModels = ref<{ id: string; name?: string }[]>([])

const previewModelId = computed(
  () => settingsStore.config.model || config.value.sonnetModel || 'claude-sonnet-4-6',
)

const contextWindowPresets = CONTEXT_WINDOW_PRESETS

const contextWindowModels = computed(() => [
  { key: 'haiku', modelId: config.value.haikuModel, placeholder: t('model.haikuModel'), tag: t('model.fast'), tagClass: 'fast' },
  { key: 'sonnet', modelId: config.value.sonnetModel, placeholder: t('model.sonnetModel'), tag: t('model.balanced'), tagClass: 'recommended' },
  { key: 'opus', modelId: config.value.opusModel, placeholder: t('model.opusModel'), tag: t('model.powerful'), tagClass: 'powerful' },
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
        baseUrl = config.value.anthropic.baseUrl || 'https://api.anthropic.com'
        apiKey = config.value.anthropic.apiKey
        provider = 'anthropic'
        break
      case 'openai_compatible':
        baseUrl = config.value.openai.baseUrl || 'https://api.openai.com/v1'
        apiKey = config.value.openai.apiKey
        provider = 'openai'
        break
      case 'gemini_api':
        baseUrl = config.value.gemini.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
        apiKey = config.value.gemini.apiKey
        provider = 'gemini'
        break
    }

    if (!apiKey) {
      connectionStatus.value = { type: 'warning', message: 'Please enter an API key first' }
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
      connectionStatus.value = { type: 'error', message: 'HTTP proxy not available - please restart the app' }
    } else if (result.ok) {
      connectionStatus.value = { type: 'success', message: 'Connection successful!' }
    } else {
      connectionStatus.value = { type: 'error', message: `Connection failed (${result.status}): ${result.error || 'Unknown error'}` }
    }
  } catch (error) {
    connectionStatus.value = { type: 'error', message: error instanceof Error ? error.message : 'Network error' }
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
        baseUrl = config.value.anthropic.baseUrl || 'https://api.anthropic.com'
        apiKey = config.value.anthropic.apiKey
        provider = 'anthropic'
        break
      case 'openai_compatible':
        baseUrl = config.value.openai.baseUrl || 'https://api.openai.com/v1'
        apiKey = config.value.openai.apiKey
        provider = 'openai'
        break
      case 'gemini_api':
        baseUrl = config.value.gemini.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
        apiKey = config.value.gemini.apiKey
        provider = 'gemini'
        break
    }

    if (!apiKey) {
      connectionStatus.value = { type: 'warning', message: 'Please enter an API key first' }
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
      connectionStatus.value = { type: 'error', message: 'HTTP proxy not available - please restart the app' }
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
        connectionStatus.value = { type: 'success', message: `Fetched ${models.length} models successfully!` }
      } else {
        connectionStatus.value = { type: 'warning', message: 'No models found from this endpoint' }
      }
    } else {
      connectionStatus.value = { type: 'error', message: `Failed to fetch models (${result.status}): ${result.error || 'Unknown error'}` }
    }
  } catch (error) {
    connectionStatus.value = { type: 'error', message: error instanceof Error ? error.message : 'Network error' }
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
  display: flex;
  flex-direction: column;
  max-width: 780px;
  gap: 20px;

  /* Allow preset dropdown to overflow panel boundaries */
  .s-panel {
    overflow: visible;
  }
}

/* ── Base URL Preset Dropdown ── */
.baseurl-wrapper {
  position: relative;
}

.baseurl-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.baseurl-selected-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border: 1.5px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  transition: all var(--transition-fast);

  &:hover {
    border-color: var(--accent-primary);
  }

  .baseurl-icon-default {
    color: var(--text-muted);
  }
}

.baseurl-input {
  flex: 1;
}

.baseurl-preset-btn {
  flex-shrink: 0;
  padding: 8px 12px;
  font-size: 12.5px;

  &.active {
    background: var(--accent-primary-glow);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }
}

/* Provider logo (shared with BaseUrlPresets) */
.provider-logo {
  width: 28px;
  height: 28px;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--bg-elevated);
  color: var(--text-primary);
  flex-shrink: 0;

  .logo-svg {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;

    svg {
      width: 16px;
      height: 16px;
    }
  }

  .logo-img {
    width: 18px;
    height: 18px;
    object-fit: contain;
  }
}

/* Brand colors for currentColor-based SVG icons */
.brand-anthropic { color: #cc785c; }

.form-actions-row {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.oauth-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.oauth-icon-wrapper {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-tertiary);
  border-radius: 14px;
  color: var(--accent-primary);
}

.oauth-text {
  font-size: var(--font-size-base);
  color: var(--text-primary);
  margin: 0;
}

.oauth-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}

.oauth-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--success-glow);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-primary);

  .success-icon {
    color: var(--success);
  }

  .subscription-badge {
    margin-left: auto;
    padding: 2px 8px;
    background: var(--accent-primary);
    color: white;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
  }
}

.context-info-desc {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-muted);
}

.ctx-window-config {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.ctx-window-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ctx-window-label {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.ctx-window-model-tag {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;

  &.fast { background: rgba(138, 136, 128, 0.15); color: var(--text-muted); }
  &.recommended { background: rgba(217, 119, 87, 0.15); color: var(--accent-primary); }
  &.powerful { background: rgba(106, 155, 204, 0.15); color: var(--accent-secondary); }
}

.ctx-window-model-name {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-window-select {
  width: auto;
  min-width: 120px;
  padding: 5px 8px;
  font-size: 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  cursor: pointer;
  font-family: inherit;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
