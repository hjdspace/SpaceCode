<template>
  <div class="settings-overlay" @click.self="handleClose">
    <div class="settings-panel">
      <div class="settings-header">
        <h2>Settings</h2>
        <button class="close-btn" @click="handleClose">
          <X :size="18" />
        </button>
      </div>

      <div class="settings-content">
        <!-- Auth Method Selection -->
        <div class="settings-section">
          <h3>Login Method</h3>
          <div class="auth-methods">
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
            </div>
          </div>
        </div>

        <!-- Anthropic Compatible Config -->
        <div v-if="authMethod === 'anthropic_compatible'" class="settings-section">
          <h3>Anthropic Compatible</h3>
          <div class="form-group">
            <label>Base URL</label>
            <input
              type="text"
              v-model="anthropicConfig.baseUrl"
              placeholder="https://api.anthropic.com"
            />
            <span class="hint">Leave empty for default Anthropic endpoint</span>
          </div>
          <div class="form-group">
            <label>API Key</label>
            <div class="api-key-input">
              <input
                :type="showApiKeys.anthropic ? 'text' : 'password'"
                v-model="anthropicConfig.apiKey"
                placeholder="sk-ant-..."
              />
              <button class="toggle-btn" @click="showApiKeys.anthropic = !showApiKeys.anthropic">
                <Eye v-if="!showApiKeys.anthropic" :size="16" />
                <EyeOff v-else :size="16" />
              </button>
            </div>
          </div>
          <div class="form-group">
            <label>Haiku Model</label>
            <input
              type="text"
              v-model="anthropicConfig.haikuModel"
              placeholder="claude-haiku-4-20250514"
            />
          </div>
          <div class="form-group">
            <label>Sonnet Model</label>
            <input
              type="text"
              v-model="anthropicConfig.sonnetModel"
              placeholder="claude-sonnet-4-20250514"
            />
          </div>
          <div class="form-group">
            <label>Opus Model</label>
            <input
              type="text"
              v-model="anthropicConfig.opusModel"
              placeholder="claude-opus-4-20250514"
            />
          </div>
        </div>

        <!-- OpenAI Compatible Config -->
        <div v-if="authMethod === 'openai_compatible'" class="settings-section">
          <h3>OpenAI Compatible</h3>
          <span class="section-desc">Ollama, DeepSeek, vLLM, One API, etc.</span>
          <div class="form-group">
            <label>Base URL</label>
            <input
              type="text"
              v-model="openaiConfig.baseUrl"
              placeholder="https://api.openai.com/v1 or https://openrouter.ai/api/v1"
            />
          </div>
          <div class="form-group">
            <label>API Key</label>
            <div class="api-key-input">
              <input
                :type="showApiKeys.openai ? 'text' : 'password'"
                v-model="openaiConfig.apiKey"
                placeholder="sk-..."
              />
              <button class="toggle-btn" @click="showApiKeys.openai = !showApiKeys.openai">
                <Eye v-if="!showApiKeys.openai" :size="16" />
                <EyeOff v-else :size="16" />
              </button>
            </div>
          </div>
          <div class="form-group">
            <label>Haiku Model</label>
            <input
              type="text"
              v-model="openaiConfig.haikuModel"
              placeholder="e.g., meta-llama/llama-4-scout:free"
            />
          </div>
          <div class="form-group">
            <label>Sonnet Model</label>
            <input
              type="text"
              v-model="openaiConfig.sonnetModel"
              placeholder="e.g., openai/gpt-4o"
            />
          </div>
          <div class="form-group">
            <label>Opus Model</label>
            <input
              type="text"
              v-model="openaiConfig.opusModel"
              placeholder="e.g., anthropic/claude-opus-4"
            />
          </div>
          <div class="form-group model-fetch-group">
            <label>Fetch Models</label>
            <div class="model-select">
              <input
                type="text"
                v-model="modelSearch"
                @focus="showModelDropdown = true"
                @input="filterModels"
                placeholder="Search or enter model name..."
                class="model-input"
              />
              <button class="refresh-btn" @click="fetchModels" :disabled="loadingModels">
                <RefreshCw :size="14" :class="{ spinning: loadingModels }" />
              </button>
              <div v-if="showModelDropdown && filteredModels.length > 0" class="model-dropdown">
                <div
                  v-for="model in filteredModels"
                  :key="model.id"
                  class="model-option"
                  @mousedown.prevent="selectModel(model.id)"
                >
                  <span class="model-name">{{ model.name || model.id }}</span>
                  <span class="model-id">{{ model.id }}</span>
                </div>
              </div>
            </div>
            <div v-if="modelError" class="model-error">{{ modelError }}</div>
          </div>
        </div>

        <!-- Gemini API Config -->
        <div v-if="authMethod === 'gemini_api'" class="settings-section">
          <h3>Gemini API</h3>
          <span class="section-desc">Google Gemini native REST/SSE</span>
          <div class="form-group">
            <label>Base URL</label>
            <input
              type="text"
              v-model="geminiConfig.baseUrl"
              placeholder="https://generativelanguage.googleapis.com/v1beta"
            />
            <span class="hint">Leave empty for Google's default v1beta API</span>
          </div>
          <div class="form-group">
            <label>API Key</label>
            <div class="api-key-input">
              <input
                :type="showApiKeys.gemini ? 'text' : 'password'"
                v-model="geminiConfig.apiKey"
                placeholder="AIza..."
              />
              <button class="toggle-btn" @click="showApiKeys.gemini = !showApiKeys.gemini">
                <Eye v-if="!showApiKeys.gemini" :size="16" />
                <EyeOff v-else :size="16" />
              </button>
            </div>
          </div>
          <div class="form-group">
            <label>Haiku Model</label>
            <input
              type="text"
              v-model="geminiConfig.haikuModel"
              placeholder="gemini-2.0-flash"
            />
          </div>
          <div class="form-group">
            <label>Sonnet Model</label>
            <input
              type="text"
              v-model="geminiConfig.sonnetModel"
              placeholder="gemini-2.5-flash"
            />
          </div>
          <div class="form-group">
            <label>Opus Model</label>
            <input
              type="text"
              v-model="geminiConfig.opusModel"
              placeholder="gemini-2.5-pro"
            />
          </div>
        </div>

        <!-- Claude Account (OAuth) -->
        <div v-if="authMethod === 'claudeai'" class="settings-section">
          <h3>Claude Account with Subscription</h3>
          <span class="section-desc">Pro, Max, Team, or Enterprise</span>
          <div class="oauth-info">
            <div class="oauth-icon">
              <Crown :size="32" />
            </div>
            <p>Sign in with your Claude account to use your subscription plan.</p>
            <p class="hint">This will open a browser for OAuth authentication.</p>
            <button class="btn btn-primary btn-oauth" @click="startOAuthLogin(true)" :disabled="oauthLoading">
              <LogIn :size="16" />
              {{ oauthLoading ? 'Connecting...' : 'Sign in with Claude' }}
            </button>
            <div v-if="oauthAccount" class="oauth-account">
              <CheckCircle :size="16" class="success-icon" />
              <span>Logged in as <strong>{{ oauthAccount.email }}</strong></span>
              <span class="subscription-badge">{{ oauthAccount.subscription }}</span>
            </div>
          </div>
        </div>

        <!-- Anthropic Console (OAuth) -->
        <div v-if="authMethod === 'console'" class="settings-section">
          <h3>Anthropic Console Account</h3>
          <span class="section-desc">API usage billing</span>
          <div class="oauth-info">
            <div class="oauth-icon">
              <Key :size="32" />
            </div>
            <p>Sign in with your Anthropic Console account for API usage billing.</p>
            <p class="hint">This will open a browser for OAuth authentication.</p>
            <button class="btn btn-primary btn-oauth" @click="startOAuthLogin(false)" :disabled="oauthLoading">
              <LogIn :size="16" />
              {{ oauthLoading ? 'Connecting...' : 'Sign in with Console' }}
            </button>
            <div v-if="oauthAccount && authMethod === 'console'" class="oauth-account">
              <CheckCircle :size="16" class="success-icon" />
              <span>Logged in as <strong>{{ oauthAccount.email }}</strong></span>
            </div>
          </div>
        </div>

        <!-- Project Config -->
        <div class="settings-section">
          <h3>Project</h3>
          <div class="form-group">
            <label>Project Root</label>
            <input type="text" v-model="projectRoot" placeholder="D:\AI\claude-code-python" />
          </div>
        </div>
      </div>

      <div class="settings-footer">
        <button class="btn btn-secondary" @click="handleClose">Cancel</button>
        <button class="btn btn-primary" @click="handleSave">Save</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import {
  X, Eye, EyeOff, RefreshCw,
  Server, Bot, Sparkles, Crown, Key, LogIn, CheckCircle
} from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useSettingsStore, type AuthMethod, type AuthSettings, type OAuthAccountInfo } from '@/stores/settings'

const settingsStore = useSettingsStore()

const emit = defineEmits<{
  close: []
  save: [settings: AuthSettings]
}>()

interface ModelInfo {
  id: string
  name?: string
}

const authMethods = [
  {
    id: 'anthropic_compatible' as AuthMethod,
    title: 'Anthropic Compatible',
    desc: 'Configure your own API endpoint',
    icon: Server
  },
  {
    id: 'openai_compatible' as AuthMethod,
    title: 'OpenAI Compatible',
    desc: 'Ollama, DeepSeek, vLLM, One API, etc.',
    icon: Bot
  },
  {
    id: 'gemini_api' as AuthMethod,
    title: 'Gemini API',
    desc: 'Google Gemini native REST/SSE',
    icon: Sparkles
  },
  {
    id: 'claudeai' as AuthMethod,
    title: 'Claude Account with Subscription',
    desc: 'Pro, Max, Team, or Enterprise',
    icon: Crown
  },
  {
    id: 'console' as AuthMethod,
    title: 'Anthropic Console Account',
    desc: 'API usage billing',
    icon: Key
  }
]

// Auth method state — init from store
const authMethod = ref<AuthMethod>(settingsStore.authMethod)

// Config states — init from store
const anthropicConfig = reactive({ ...settingsStore.anthropicConfig })
const openaiConfig = reactive({ ...settingsStore.openaiConfig })
const geminiConfig = reactive({ ...settingsStore.geminiConfig })

// Show/hide API keys
const showApiKeys = reactive({
  anthropic: false,
  openai: false,
  gemini: false
})

// Project root
const projectRoot = ref(settingsStore.projectRoot || '')

// OAuth state
const oauthLoading = ref(false)
const oauthAccount = ref<OAuthAccountInfo | null>(settingsStore.oauthAccount)

// Model list for OpenAI
const modelList = ref<ModelInfo[]>([])
const loadingModels = ref(false)
const modelSearch = ref('')
const showModelDropdown = ref(false)
const searchQuery = ref('')
const modelError = ref('')

const filteredModels = ref<ModelInfo[]>([])

function selectAuthMethod(method: AuthMethod) {
  authMethod.value = method
}

function selectModel(modelId: string) {
  openaiConfig.sonnetModel = modelId
  modelSearch.value = modelId
  showModelDropdown.value = false
}

function filterModels() {
  searchQuery.value = modelSearch.value
  const search = searchQuery.value.toLowerCase()
  filteredModels.value = search
    ? modelList.value.filter(m =>
        m.id.toLowerCase().includes(search) ||
        (m.name && m.name.toLowerCase().includes(search))
      )
    : modelList.value
  showModelDropdown.value = true
}

async function fetchModels() {
  modelError.value = ''
  if (!openaiConfig.baseUrl) {
    modelError.value = 'Please enter Base URL first'
    return
  }
  if (!openaiConfig.apiKey) {
    modelError.value = 'Please enter API Key first'
    return
  }
  loadingModels.value = true
  modelList.value = []
  filteredModels.value = []

  try {
    const url = `${openaiConfig.baseUrl.replace(/\/+$/, '')}/models`
    const result = await api.httpFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${openaiConfig.apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!result) {
      modelError.value = 'HTTP proxy not available - please restart the app'
      return
    }

    if (result.ok) {
      const data = JSON.parse(result.data)
      let models: any[] = []
      if (Array.isArray(data)) {
        models = data
      } else if (data.data && Array.isArray(data.data)) {
        models = data.data
      } else if (data.models && Array.isArray(data.models)) {
        models = data.models
      }

      if (models.length === 0) {
        modelError.value = 'No models found from this endpoint'
      } else {
        modelList.value = models.map((m: any) => ({
          id: m.id || m.name || String(m),
          name: m.name || m.id || String(m)
        }))
        filteredModels.value = modelList.value
        showModelDropdown.value = true
      }
    } else {
      modelError.value = `Request failed (${result.status}): ${(result.error || result.data || '').slice(0, 200)}`
    }
  } catch (error) {
    modelError.value = error instanceof Error ? error.message : 'Network error - unable to connect to the endpoint'
  } finally {
    loadingModels.value = false
  }
}

function handleClickOutside(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.model-select')) {
    showModelDropdown.value = false
  }
}

async function startOAuthLogin(loginWithClaudeAi: boolean) {
  oauthLoading.value = true
  try {
    // Open the OAuth URL in the default browser
    const baseUrl = loginWithClaudeAi
      ? 'https://claude.com/cai/oauth/authorize'
      : 'https://platform.claude.com/oauth/authorize'

    const clientId = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
    const redirectUri = 'https://platform.claude.com/oauth/code/callback'
    const scopes = loginWithClaudeAi
      ? 'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
      : 'org:create_api_key user:profile'
    const state = crypto.randomUUID()

    const authUrl = `${baseUrl}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}`

    await api.openExternal(authUrl)

    // For now, we show a hint that the user needs to complete auth in the browser
    // In a full implementation, we'd start a local server to receive the callback
    oauthAccount.value = {
      email: 'Completing login in browser...',
      subscription: loginWithClaudeAi ? 'Subscription' : 'Console'
    }
  } catch (error) {
    console.error('[Settings] OAuth login failed:', error)
  } finally {
    oauthLoading.value = false
  }
}

async function loadSettings() {
  // Load from settings store (which handles localStorage + env)
  authMethod.value = settingsStore.authMethod
  Object.assign(anthropicConfig, settingsStore.anthropicConfig)
  Object.assign(openaiConfig, settingsStore.openaiConfig)
  Object.assign(geminiConfig, settingsStore.geminiConfig)
  projectRoot.value = settingsStore.projectRoot || ''
  oauthAccount.value = settingsStore.oauthAccount
}

function handleClose() {
  emit('close')
}

function buildSettingsPayload(): AuthSettings {
  const settings: AuthSettings = {
    authMethod: authMethod.value,
    anthropicConfig: { ...anthropicConfig },
    openaiConfig: { ...openaiConfig },
    geminiConfig: { ...geminiConfig },
    oauthAccount: oauthAccount.value,
    projectRoot: projectRoot.value
  }
  return settings
}

async function handleSave() {
  const settings = buildSettingsPayload()

  // Update the settings store
  settingsStore.updateFromSettingsPanel(settings)

  emit('save', settings)
  emit('close')
}

onMounted(async () => {
  await loadSettings()
  document.addEventListener('mousedown', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})
</script>

<style lang="scss" scoped>
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.settings-panel {
  width: 600px;
  max-height: 85vh;
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--surface-border);
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--surface-border);

  h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }
}

.close-btn {
  @include reset-button;
  color: var(--text-muted);
  padding: 4px;
  border-radius: var(--radius-sm);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  @include scrollbar;
}

.settings-section {
  margin-bottom: 24px;

  &:last-child {
    margin-bottom: 0;
  }

  h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .section-desc {
    display: block;
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 16px;
    margin-top: -8px;
  }
}

.auth-methods {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.auth-method-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }

  &.active {
    border-color: var(--accent-primary);
    background: var(--bg-tertiary);
    box-shadow: 0 0 0 1px var(--accent-primary);
  }

  .method-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-secondary);
    color: var(--text-muted);
    flex-shrink: 0;

    .auth-method-card.active & {
      color: var(--accent-primary);
      background: var(--accent-primary-glow);
    }
  }

  .method-info {
    flex: 1;
    min-width: 0;
  }

  .method-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .method-desc {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }
}

.form-group {
  margin-bottom: 16px;

  label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    margin-bottom: 6px;
  }

  input, select {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: 13px;

    &:focus {
      outline: none;
      border-color: var(--accent-primary);
    }

    &::placeholder {
      color: var(--text-muted);
    }
  }

  select {
    cursor: pointer;
  }

  .hint {
    display: block;
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
  }
}

.api-key-input {
  display: flex;
  gap: 8px;

  input {
    flex: 1;
  }

  .toggle-btn {
    @include reset-button;
    padding: 8px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    color: var(--text-muted);

    &:hover {
      color: var(--text-primary);
    }
  }
}

.model-fetch-group {
  position: relative;
  overflow: visible;
}

.model-select {
  display: flex;
  gap: 8px;
  position: relative;

  .model-input {
    flex: 1;
  }

  .refresh-btn {
    @include reset-button;
    padding: 8px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--surface-border);
    border-radius: var(--radius-md);
    color: var(--text-muted);
    flex-shrink: 0;

    &:hover:not(:disabled) {
      color: var(--text-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .spinning {
      animation: spin 1s linear infinite;
    }
  }
}

.model-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 48px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  margin-top: 4px;
}

.model-option {
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.15s;
  display: flex;
  flex-direction: column;
  gap: 2px;

  &:hover {
    background: var(--bg-hover);
  }

  .model-name {
    font-size: 12px;
    color: var(--text-primary);
  }

  .model-id {
    font-size: 10px;
    color: var(--text-muted);
  }
}

.model-error {
  margin-top: 4px;
  padding: 6px 10px;
  font-size: 11px;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
  border-radius: var(--radius-sm);
}

.oauth-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 16px;
  gap: 12px;

  .oauth-icon {
    width: 56px;
    height: 56px;
    border-radius: var(--radius-lg);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-tertiary);
    color: var(--accent-primary);
    margin-bottom: 4px;
  }

  p {
    font-size: 13px;
    color: var(--text-secondary);
    max-width: 360px;
    line-height: 1.5;

    &.hint {
      font-size: 11px;
      color: var(--text-muted);
    }
  }
}

.btn-oauth {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 12px 24px;
  font-size: 14px;
}

.oauth-account {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  font-size: 12px;
  color: var(--text-secondary);

  .success-icon {
    color: var(--success, #22c55e);
  }

  .subscription-badge {
    padding: 2px 8px;
    background: var(--accent-primary);
    color: white;
    border-radius: var(--radius-sm);
    font-size: 10px;
    font-weight: 600;
  }
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--surface-border);
}

.btn {
  padding: 10px 20px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;
    border: none;

    &:hover {
      opacity: 0.9;
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &.btn-secondary {
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--surface-border);

    &:hover {
      background: var(--bg-hover);
    }
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
