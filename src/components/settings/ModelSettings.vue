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
          <input
            type="text"
            v-model="config.anthropic.baseUrl"
            placeholder="https://api.anthropic.com"
            class="s-form-input"
          />
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
          <input
            type="text"
            v-model="config.openai.baseUrl"
            placeholder="https://api.openai.com/v1"
            class="s-form-input"
          />
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
          <input
            type="text"
            v-model="config.gemini.baseUrl"
            placeholder="https://generativelanguage.googleapis.com/v1beta"
            class="s-form-input"
          />
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
  XCircle, AlertCircle, BarChart3
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import { useSettingsStore } from '@/stores/settings'
import type { AuthMethod, OAuthAccountInfo } from '@/stores/settings'
import SearchableSelect from './SearchableSelect.vue'
import ContextUsagePreview from './ContextUsagePreview.vue'

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

const availableModels = ref<{ id: string; name?: string }[]>([])

const previewModelId = computed(
  () => settingsStore.config.model || config.value.sonnetModel || 'claude-sonnet-4-6',
)

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
}

.model-config-panel {
  overflow: visible;
}

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

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
