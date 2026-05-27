<template>
  <div class="settings-section">
    <h2 class="section-title">{{ $t('settings.modelSettings') }}</h2>

    <div class="section-content">
      <!-- Login Method Selection -->
      <div class="form-group">
        <label class="form-label">{{ $t('settings.loginMethod') }}</label>
        <div class="auth-methods-grid">
          <div
            v-for="method in authMethods"
            :key="method.id"
            class="auth-method-card"
            :class="{ active: authMethod === method.id }"
            @click="selectAuthMethod(method.id)"
          >
            <div class="method-icon">
              <component :is="method.icon" :size="20" />
            </div>
            <div class="method-info">
              <div class="method-title">{{ method.title }}</div>
              <div class="method-desc">{{ method.desc }}</div>
            </div>
            <div v-if="authMethod === method.id" class="method-check">
              <Check :size="16" />
            </div>
          </div>
        </div>
      </div>

      <!-- Dynamic Configuration Based on Auth Method -->
      <div class="divider"></div>

      <!-- Anthropic Compatible Config -->
      <template v-if="authMethod === 'anthropic_compatible'">
        <h3 class="subsection-title">{{ $t('auth.anthropicConfig') }}</h3>
        <div class="form-group">
          <label class="form-label">{{ $t('auth.baseUrl') }}</label>
          <input
            type="text"
            v-model="config.anthropic.baseUrl"
            placeholder="https://api.anthropic.com"
            class="form-input"
          />
          <span class="form-hint">{{ $t('auth.leaveEmptyDefault') }}</span>
        </div>
        <div class="form-group">
          <label class="form-label">{{ $t('auth.apiKey') }}</label>
          <div class="input-with-action">
            <input
              :type="showApiKey ? 'text' : 'password'"
              v-model="config.anthropic.apiKey"
              placeholder="sk-ant-..."
              class="form-input"
            />
            <button class="input-action-btn" @click="showApiKey = !showApiKey">
              <Eye v-if="!showApiKey" :size="16" />
              <EyeOff v-else :size="16" />
            </button>
          </div>
        </div>
      </template>

      <!-- OpenAI Compatible Config -->
      <template v-else-if="authMethod === 'openai_compatible'">
        <h3 class="subsection-title">{{ $t('auth.openaiConfig') }}</h3>
        <div class="form-group">
          <label class="form-label">{{ $t('auth.baseUrl') }}</label>
          <input
            type="text"
            v-model="config.openai.baseUrl"
            placeholder="https://api.openai.com/v1"
            class="form-input"
          />
        </div>
        <div class="form-group">
          <label class="form-label">{{ $t('auth.apiKey') }}</label>
          <div class="input-with-action">
            <input
              :type="showApiKey ? 'text' : 'password'"
              v-model="config.openai.apiKey"
              placeholder="sk-..."
              class="form-input"
            />
            <button class="input-action-btn" @click="showApiKey = !showApiKey">
              <Eye v-if="!showApiKey" :size="16" />
              <EyeOff v-else :size="16" />
            </button>
          </div>
        </div>
        <div class="form-actions-row">
          <button class="btn btn-secondary" @click="testConnection" :disabled="testing">
            <Loader2 v-if="testing" :size="14" class="spin" />
            <Plug v-else :size="14" />
            {{ testing ? $t('auth.testing') : $t('auth.testConnection') }}
          </button>
          <button class="btn btn-secondary" @click="fetchModels" :disabled="fetchingModels">
            <RefreshCw v-if="fetchingModels" :size="14" class="spin" />
            <Download v-else :size="14" />
            {{ fetchingModels ? $t('auth.fetching') : $t('auth.fetchModels') }}
          </button>
        </div>

        <!-- Connection Status -->
        <div v-if="connectionStatus" class="connection-status" :class="connectionStatus.type">
          <CheckCircle v-if="connectionStatus.type === 'success'" :size="16" />
          <XCircle v-if="connectionStatus.type === 'error'" :size="16" />
          <AlertCircle v-if="connectionStatus.type === 'warning'" :size="16" />
          <span>{{ connectionStatus.message }}</span>
        </div>
      </template>

      <!-- Gemini API Config -->
      <template v-else-if="authMethod === 'gemini_api'">
        <h3 class="subsection-title">{{ $t('auth.geminiConfig') }}</h3>
        <div class="form-group">
          <label class="form-label">{{ $t('auth.baseUrl') }}</label>
          <input
            type="text"
            v-model="config.gemini.baseUrl"
            placeholder="https://generativelanguage.googleapis.com/v1beta"
            class="form-input"
          />
          <span class="form-hint">{{ $t('auth.leaveEmptyGoogleDefault') }}</span>
        </div>
        <div class="form-group">
          <label class="form-label">{{ $t('auth.apiKey') }}</label>
          <div class="input-with-action">
            <input
              :type="showApiKey ? 'text' : 'password'"
              v-model="config.gemini.apiKey"
              placeholder="AIza..."
              class="form-input"
            />
            <button class="input-action-btn" @click="showApiKey = !showApiKey">
              <Eye v-if="!showApiKey" :size="16" />
              <EyeOff v-else :size="16" />
            </button>
          </div>
        </div>
      </template>

      <!-- Claude Account OAuth -->
      <template v-else-if="authMethod === 'claudeai'">
        <h3 class="subsection-title">{{ $t('auth.claudeAccount') }}</h3>
        <div class="oauth-section">
          <div class="oauth-icon">
            <Crown :size="32" />
          </div>
          <p class="oauth-text">{{ $t('auth.signInClaudeDesc') }}</p>
          <p class="oauth-hint">{{ $t('auth.oauthHint') }}</p>
          <button class="btn btn-primary btn-oauth" @click="startOAuthLogin(true)" :disabled="oauthLoading">
            <LogIn :size="16" />
            {{ oauthLoading ? $t('auth.connecting') : $t('auth.signInWithClaude') }}
          </button>
          <div v-if="oauthAccount" class="oauth-status">
            <CheckCircle :size="16" class="success-icon" />
            <span>{{ $t('auth.loggedInAs') }} <strong>{{ oauthAccount.email }}</strong></span>
            <span class="subscription-badge">{{ oauthAccount.subscription }}</span>
          </div>
        </div>
      </template>

      <!-- Console Account OAuth -->
      <template v-else-if="authMethod === 'console'">
        <h3 class="subsection-title">{{ $t('auth.anthropicConsole') }}</h3>
        <div class="oauth-section">
          <div class="oauth-icon">
            <Key :size="32" />
          </div>
          <p class="oauth-text">{{ $t('auth.signInConsoleDesc') }}</p>
          <p class="oauth-hint">{{ $t('auth.oauthHint') }}</p>
          <button class="btn btn-primary btn-oauth" @click="startOAuthLogin(false)" :disabled="oauthLoading">
            <LogIn :size="16" />
            {{ oauthLoading ? $t('auth.connecting') : $t('auth.signInWithConsole') }}
          </button>
          <div v-if="oauthAccount" class="oauth-status">
            <CheckCircle :size="16" class="success-icon" />
            <span>{{ $t('auth.loggedInAs') }} <strong>{{ oauthAccount.email }}</strong></span>
          </div>
        </div>
      </template>

      <!-- Model Configuration -->
      <div class="divider"></div>
      <h3 class="subsection-title">{{ $t('model.configuration') }}</h3>

      <div class="form-group">
        <label class="form-label">{{ $t('model.haikuModel') }} <span class="model-tag">{{ $t('model.fast') }}</span></label>
        <SearchableSelect
          v-model="config.haikuModel"
          :options="availableModels"
          :placeholder="$t('model.selectModel')"
        />
      </div>

      <div class="form-group">
        <label class="form-label">{{ $t('model.sonnetModel') }} <span class="model-tag recommended">{{ $t('model.balanced') }}</span></label>
        <SearchableSelect
          v-model="config.sonnetModel"
          :options="availableModels"
          :placeholder="$t('model.selectModel')"
        />
      </div>

      <div class="form-group">
        <label class="form-label">{{ $t('model.opusModel') }} <span class="model-tag powerful">{{ $t('model.powerful') }}</span></label>
        <SearchableSelect
          v-model="config.opusModel"
          :options="availableModels"
          :placeholder="$t('model.selectModel')"
        />
      </div>

      <div class="context-info-box">
        <h3 class="subsection-title">{{ $t('contextUsage.modelContextTitle') }}</h3>
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
  XCircle, AlertCircle
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

// 根据当前认证方式获取默认模型
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

    switch (authMethod.value) {
      case 'anthropic_compatible':
        baseUrl = config.value.anthropic.baseUrl || 'https://api.anthropic.com'
        apiKey = config.value.anthropic.apiKey
        break
      case 'openai_compatible':
        baseUrl = config.value.openai.baseUrl || 'https://api.openai.com/v1'
        apiKey = config.value.openai.apiKey
        break
      case 'gemini_api':
        baseUrl = config.value.gemini.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
        apiKey = config.value.gemini.apiKey
        break
    }

    if (!apiKey) {
      connectionStatus.value = { type: 'warning', message: 'Please enter an API key first' }
      testing.value = false
      return
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/models`
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

    switch (authMethod.value) {
      case 'anthropic_compatible':
        baseUrl = config.value.anthropic.baseUrl || 'https://api.anthropic.com'
        apiKey = config.value.anthropic.apiKey
        break
      case 'openai_compatible':
        baseUrl = config.value.openai.baseUrl || 'https://api.openai.com/v1'
        apiKey = config.value.openai.apiKey
        break
      case 'gemini_api':
        baseUrl = config.value.gemini.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
        apiKey = config.value.gemini.apiKey
        break
    }

    if (!apiKey) {
      connectionStatus.value = { type: 'warning', message: 'Please enter an API key first' }
      fetchingModels.value = false
      return
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/models`
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
.settings-section {
  max-width: 720px;
}

.section-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 24px;
}

.section-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.subsection-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-muted);
  font-weight: 500;

  &.recommended {
    background: rgba(var(--accent-primary-rgb), 0.1);
    color: var(--accent-primary);
  }

  &.powerful {
    background: var(--accent-tertiary-glow);
    color: var(--accent-tertiary);
  }
}

.form-input,
.form-select {
  padding: 10px 12px;
  background: var(--surface-soft);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 13px;
  transition: all 0.2s;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }

  &::placeholder {
    color: var(--text-muted);
  }
}

.form-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.input-with-action {
  display: flex;
  gap: 8px;

  .form-input {
    flex: 1;
  }
}

.input-action-btn {
  @include reset-button;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-soft);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  color: var(--text-muted);
  transition: all 0.2s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }
}

.auth-methods-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.auth-method-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 12px;
  background: var(--surface-card);
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;

  &:hover {
    background: var(--surface-soft);
    border-color: var(--border-default);
  }

  &.active {
    background: rgba(var(--accent-primary-rgb), 0.05);
    border-color: var(--accent-primary);
  }

  .method-icon {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-tertiary);
    border-radius: 10px;
    color: var(--text-muted);

    .auth-method-card.active & {
      background: var(--accent-primary);
      color: white;
    }
  }

  .method-info {
    text-align: center;
  }

  .method-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .method-desc {
    font-size: 11px;
    color: var(--text-muted);
  }

  .method-check {
    position: absolute;
    top: 8px;
    right: 8px;
    color: var(--accent-primary);
  }
}

.divider {
  height: 1px;
  background: var(--border-default);
  margin: 8px 0;
}

.form-actions-row {
  display: flex;
  gap: 12px;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  animation: slideIn 0.2s ease;

  &.success {
    background: var(--success-glow);
    color: var(--success);
  }

  &.error {
    background: var(--error-glow);
    color: var(--error);
  }

  &.warning {
    background: var(--warning-glow);
    color: var(--warning);
  }
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.btn {
  @include reset-button;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover);
    }
  }

  &.btn-secondary {
    background: var(--surface-soft);
    border: 1px solid var(--border-default);
    color: var(--text-primary);

    &:hover:not(:disabled) {
      background: var(--bg-hover);
      border-color: var(--accent-primary);
    }
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.btn-oauth {
  width: fit-content;
}

.oauth-section {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 24px;
  background: var(--surface-soft);
  border-radius: 12px;

  .oauth-icon {
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
    font-size: 14px;
    color: var(--text-primary);
    margin: 0;
  }

  .oauth-hint {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
  }
}

.oauth-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--success-glow);
  border-radius: 8px;
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

.context-info-box {
  margin-top: 8px;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--surface-border);
  background: var(--bg-tertiary);
}

.context-info-desc {
  margin: 0;
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
