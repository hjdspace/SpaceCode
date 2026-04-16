<template>
  <div class="settings-section">
    <h2 class="section-title">General</h2>
    
    <div class="section-content">
      <!-- Login Method Selection -->
      <div class="form-group">
        <label class="form-label">Login Method</label>
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
        <h3 class="subsection-title">Anthropic Configuration</h3>
        <div class="form-group">
          <label class="form-label">Base URL</label>
          <input
            type="text"
            v-model="config.anthropic.baseUrl"
            placeholder="https://api.anthropic.com"
            class="form-input"
          />
          <span class="form-hint">Leave empty for default Anthropic endpoint</span>
        </div>
        <div class="form-group">
          <label class="form-label">API Key</label>
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
      <template v-if="authMethod === 'openai_compatible'">
        <h3 class="subsection-title">OpenAI Configuration</h3>
        <div class="form-group">
          <label class="form-label">Base URL</label>
          <input
            type="text"
            v-model="config.openai.baseUrl"
            placeholder="https://api.openai.com/v1"
            class="form-input"
          />
        </div>
        <div class="form-group">
          <label class="form-label">API Key</label>
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
            {{ testing ? 'Testing...' : 'Test Connection' }}
          </button>
          <button class="btn btn-secondary" @click="fetchModels" :disabled="fetchingModels">
            <RefreshCw v-if="fetchingModels" :size="14" class="spin" />
            <Download v-else :size="14" />
            {{ fetchingModels ? 'Fetching...' : 'Fetch Models' }}
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
      <template v-if="authMethod === 'gemini_api'">
        <h3 class="subsection-title">Gemini Configuration</h3>
        <div class="form-group">
          <label class="form-label">Base URL</label>
          <input
            type="text"
            v-model="config.gemini.baseUrl"
            placeholder="https://generativelanguage.googleapis.com/v1beta"
            class="form-input"
          />
          <span class="form-hint">Leave empty for Google's default v1beta API</span>
        </div>
        <div class="form-group">
          <label class="form-label">API Key</label>
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
      <template v-if="authMethod === 'claudeai'">
        <h3 class="subsection-title">Claude Account</h3>
        <div class="oauth-section">
          <div class="oauth-icon">
            <Crown :size="32" />
          </div>
          <p class="oauth-text">Sign in with your Claude account to use your subscription plan.</p>
          <p class="oauth-hint">This will open a browser for OAuth authentication.</p>
          <button class="btn btn-primary btn-oauth" @click="startOAuthLogin(true)" :disabled="oauthLoading">
            <LogIn :size="16" />
            {{ oauthLoading ? 'Connecting...' : 'Sign in with Claude' }}
          </button>
          <div v-if="oauthAccount" class="oauth-status">
            <CheckCircle :size="16" class="success-icon" />
            <span>Logged in as <strong>{{ oauthAccount.email }}</strong></span>
            <span class="subscription-badge">{{ oauthAccount.subscription }}</span>
          </div>
        </div>
      </template>

      <!-- Console Account OAuth -->
      <template v-if="authMethod === 'console'">
        <h3 class="subsection-title">Anthropic Console</h3>
        <div class="oauth-section">
          <div class="oauth-icon">
            <Key :size="32" />
          </div>
          <p class="oauth-text">Sign in with your Anthropic Console account for API usage billing.</p>
          <p class="oauth-hint">This will open a browser for OAuth authentication.</p>
          <button class="btn btn-primary btn-oauth" @click="startOAuthLogin(false)" :disabled="oauthLoading">
            <LogIn :size="16" />
            {{ oauthLoading ? 'Connecting...' : 'Sign in with Console' }}
          </button>
          <div v-if="oauthAccount" class="oauth-status">
            <CheckCircle :size="16" class="success-icon" />
            <span>Logged in as <strong>{{ oauthAccount.email }}</strong></span>
          </div>
        </div>
      </template>

      <!-- Model Configuration -->
      <div class="divider"></div>
      <h3 class="subsection-title">Model Configuration</h3>
      
      <div class="form-group">
        <label class="form-label">Haiku Model <span class="model-tag">Fast</span></label>
        <SearchableSelect
          v-model="config.haikuModel"
          :options="availableModels"
          placeholder="Select model..."
        />
      </div>

      <div class="form-group">
        <label class="form-label">Sonnet Model <span class="model-tag recommended">Balanced</span></label>
        <SearchableSelect
          v-model="config.sonnetModel"
          :options="availableModels"
          placeholder="Select model..."
        />
      </div>

      <div class="form-group">
        <label class="form-label">Opus Model <span class="model-tag powerful">Powerful</span></label>
        <SearchableSelect
          v-model="config.opusModel"
          :options="availableModels"
          placeholder="Select model..."
        />
      </div>

      <!-- Project Settings -->
      <div class="divider"></div>
      <h3 class="subsection-title">Project Settings</h3>
      
      <div class="form-group">
        <label class="form-label">Project Root</label>
        <div class="input-with-action">
          <input
            type="text"
            v-model="config.projectRoot"
            placeholder="D:\Projects\my-project"
            class="form-input"
          />
          <button class="input-action-btn" @click="browseProjectRoot" title="Select Folder">
            <FolderOpen :size="16" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import {
  Server, Bot, Sparkles, Crown, Key, LogIn, CheckCircle,
  Eye, EyeOff, RefreshCw, Plug, Loader2, Download, Check,
  FolderOpen, XCircle, AlertCircle
} from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useAppStore } from '@/stores/app'
import type { AuthMethod, OAuthAccountInfo } from '@/stores/settings'
import SearchableSelect from './SearchableSelect.vue'

const props = defineProps<{
  modelValue: {
    authMethod: AuthMethod
    anthropic: { baseUrl: string; apiKey: string }
    openai: { baseUrl: string; apiKey: string }
    gemini: { baseUrl: string; apiKey: string }
    haikuModel: string
    sonnetModel: string
    opusModel: string
    projectRoot: string
    oauthAccount: OAuthAccountInfo | null
  }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: typeof props.modelValue]
}>()

const appStore = useAppStore()

const authMethods = [
  { id: 'anthropic_compatible' as AuthMethod, title: 'Anthropic', desc: 'Compatible API', icon: Server },
  { id: 'openai_compatible' as AuthMethod, title: 'OpenAI', desc: 'Compatible API', icon: Bot },
  { id: 'gemini_api' as AuthMethod, title: 'Gemini', desc: 'Google API', icon: Sparkles },
  { id: 'claudeai' as AuthMethod, title: 'Claude', desc: 'Account OAuth', icon: Crown },
  { id: 'console' as AuthMethod, title: 'Console', desc: 'API Billing', icon: Key }
]

const config = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
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

// Default models as fallback
const defaultModels = [
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
  { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
]

onMounted(() => {
  // Initialize with default models
  availableModels.value = [...defaultModels]
  
  // Sync project root with app store
  if (appStore.projectRoot && !config.value.projectRoot) {
    config.value.projectRoot = appStore.projectRoot
  }
})

function selectAuthMethod(method: AuthMethod) {
  authMethod.value = method
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
    
    // Test connection by fetching models
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
    // Clear status after 5 seconds
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
    // Clear status after 5 seconds
    setTimeout(() => {
      connectionStatus.value = null
    }, 5000)
  }
}

async function startOAuthLogin(isClaudeAi: boolean) {
  oauthLoading.value = true
  // TODO: Implement OAuth
  await new Promise(r => setTimeout(r, 1000))
  oauthLoading.value = false
}

async function browseProjectRoot() {
  try {
    const result = await api.selectFolder()
    if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
      config.value.projectRoot = result.filePaths[0]
      // Also update app store
      appStore.setProjectRoot(result.filePaths[0])
    }
  } catch (error) {
    console.error('Failed to browse folder:', error)
    // Fallback: prompt user to enter path manually
    const path = prompt('Enter project root path:', config.value.projectRoot || appStore.projectRoot || '')
    if (path) {
      config.value.projectRoot = path
      appStore.setProjectRoot(path)
    }
  }
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
    background: rgba(245, 158, 11, 0.1);
    color: #f59e0b;
  }
}

.form-input,
.form-select {
  padding: 10px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 13px;
  transition: all 0.2s;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.1);
  }

  &::placeholder {
    color: var(--text-muted);
  }
}

.form-select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 36px;
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
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
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
  background: var(--bg-secondary);
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;

  &:hover {
    background: var(--bg-hover);
    border-color: var(--border-color);
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
  background: var(--border-color);
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
    background: rgba(34, 197, 94, 0.1);
    color: #16a34a;
  }

  &.error {
    background: rgba(239, 68, 68, 0.1);
    color: #dc2626;
  }

  &.warning {
    background: rgba(245, 158, 11, 0.1);
    color: #d97706;
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
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
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
  background: var(--bg-secondary);
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
  background: rgba(34, 197, 94, 0.1);
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-primary);

  .success-icon {
    color: #22c55e;
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

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
