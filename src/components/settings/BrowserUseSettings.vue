<template>
  <div class="browser-use-settings">
    <!-- Masthead -->
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">Settings</div>
      <h1 class="s-masthead-title">{{ t('browserUse.title') }}</h1>
      <p class="s-masthead-desc">{{ t('browserUse.description') }}</p>
    </div>

    <!-- 安装状态 -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon" :class="store.isInstalled ? 'success' : 'warning'">
            <Globe :size="14" />
          </div>
          <span class="s-panel-title">{{ t('browserUse.installStatus') }}</span>
          <span v-if="store.browserUseVersion" class="s-panel-badge">v{{ store.browserUseVersion }}</span>
        </div>
        <button class="s-btn s-btn-secondary" :disabled="store.loading" @click="store.refreshStatus()">
          <RefreshCw :size="14" :class="{ spinning: store.loading }" />
          {{ t('browserUse.refresh') }}
        </button>
      </div>
      <div class="s-panel-body">
        <template v-if="store.isPlatformSupported">
          <!-- Python -->
          <div class="cu-status-row">
            <div class="cu-status-label">{{ t('browserUse.python') }}</div>
            <div class="cu-status-value">
              <span v-if="store.pythonPath" class="cu-badge cu-badge-success">
                <CheckCircle :size="14" />
                {{ store.status?.pythonVersion || 'OK' }}
              </span>
              <span v-else class="cu-badge cu-badge-danger">
                <XCircle :size="14" />
                {{ t('browserUse.notFound') }}
              </span>
            </div>
          </div>

          <!-- Browser-Use 包 -->
          <div class="cu-status-row">
            <div class="cu-status-label">browser-use</div>
            <div class="cu-status-value">
              <span v-if="store.isInstalled" class="cu-badge cu-badge-success">
                <CheckCircle :size="14" />
                {{ t('browserUse.installed') }}
              </span>
              <span v-else class="cu-badge cu-badge-danger">
                <XCircle :size="14" />
                {{ t('browserUse.notInstalled') }}
              </span>
            </div>
          </div>

          <!-- Playwright Chromium -->
          <div class="cu-status-row">
            <div class="cu-status-label">Playwright Chromium</div>
            <div class="cu-status-value">
              <span v-if="store.chromiumInstalled" class="cu-badge cu-badge-success">
                <CheckCircle :size="14" />
                {{ t('browserUse.installed') }}
              </span>
              <span v-else class="cu-badge cu-badge-yellow">
                <AlertCircle :size="14" />
                {{ t('browserUse.notInstalled') }}
              </span>
            </div>
          </div>

          <!-- LLM -->
          <div class="cu-status-row">
            <div class="cu-status-label">LLM</div>
            <div class="cu-status-value">
              <span v-if="store.llmConfigured" class="cu-badge cu-badge-success">
                <CheckCircle :size="14" />
                {{ store.status?.llmProvider || 'OK' }}
              </span>
              <span v-else class="cu-badge cu-badge-warning">
                <AlertCircle :size="14" />
                {{ t('browserUse.llmNotConfigured') }}
              </span>
            </div>
          </div>

          <!-- Python 路径 -->
          <div v-if="store.pythonPath" class="cu-status-row">
            <div class="cu-status-label">{{ t('browserUse.pythonPath') }}</div>
            <div class="cu-status-value cu-mono">{{ store.pythonPath }}</div>
          </div>

          <!-- 操作按钮 -->
          <div class="cu-actions">
            <button
              v-if="!store.isInstalled || !store.chromiumInstalled"
              class="s-btn s-btn-primary"
              :disabled="store.installing"
              @click="handleInstall"
            >
              <Download :size="14" />
              {{ store.installing ? t('browserUse.installing') : t('browserUse.install') }}
            </button>
            <button
              class="s-btn s-btn-secondary"
              :disabled="store.checkingUpdate"
              @click="store.checkUpdate()"
            >
              <RefreshCw :size="14" :class="{ spinning: store.checkingUpdate }" />
              {{ store.checkingUpdate ? t('browserUse.checkingUpdate') : t('browserUse.checkUpdate') }}
            </button>
            <button
              v-if="store.isInstalled"
              class="s-btn s-btn-secondary"
              :disabled="store.runningDoctor"
              @click="store.runDoctor()"
            >
              <Activity :size="14" />
              {{ t('browserUse.runDoctor') }}
            </button>
          </div>

          <!-- 安装进度 -->
          <div v-if="store.installing && store.installProgress" class="cu-install-progress">
            <div class="cu-progress-bar">
              <div
                class="cu-progress-fill"
                :class="{ error: store.installProgress.stage === 'error' }"
                :style="{ width: `${store.installProgress.percent}%` }"
              />
            </div>
            <span class="cu-progress-msg">{{ store.installProgress.message }}</span>
          </div>

          <!-- 就绪提示 -->
          <div v-if="store.isReady" class="cu-ready-notice">
            <CheckCircle :size="16" />
            <span>{{ t('browserUse.ready') }}</span>
          </div>
        </template>
        <div v-else class="cu-warning">
          <AlertCircle :size="16" />
          <span>{{ t('browserUse.platformNotSupported') }}</span>
        </div>
      </div>
    </div>

    <!-- LLM 配置 -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon">
            <Key :size="14" />
          </div>
          <span class="s-panel-title">{{ t('browserUse.llmConfig') }}</span>
          <span v-if="store.llmConfigured" class="s-panel-badge success">{{ t('browserUse.configured') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <p class="cu-hint">{{ t('browserUse.llmHint') }}</p>

        <div class="bu-form-grid">
          <div class="s-form-group">
            <label class="s-form-label">{{ t('browserUse.provider') }}</label>
            <select v-model="form.provider" class="s-form-select" @change="saveConfig">
              <option value="ChatBrowserUse">ChatBrowserUse (推荐)</option>
              <option value="Anthropic">Anthropic</option>
              <option value="OpenAI">OpenAI</option>
              <option value="Google">Google Gemini</option>
              <option value="Ollama">Ollama (本地)</option>
            </select>
          </div>
          <div class="s-form-group">
            <label class="s-form-label">{{ t('browserUse.model') }}</label>
            <select v-model="form.model" class="s-form-select" @change="saveConfig">
              <option value="bu-2-0">bu-2-0 (ChatBrowserUse)</option>
              <option value="claude-opus-4-8">claude-opus-4-8</option>
              <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
              <option value="gpt-5.5">gpt-5.5</option>
              <option value="gemini-3-pro">gemini-3-pro</option>
            </select>
          </div>
        </div>
        <div class="bu-form-grid">
          <div class="s-form-group">
            <label class="s-form-label">{{ t('browserUse.maxSteps') }}</label>
            <input v-model.number="form.maxSteps" class="s-form-input" type="number" min="1" max="200" @change="saveConfig">
          </div>
          <div class="s-form-group">
            <label class="s-form-label">Temperature</label>
            <input v-model.number="form.temperature" class="s-form-input" type="number" min="0" max="2" step="0.1" @change="saveConfig">
          </div>
        </div>

        <div class="bu-checkbox-group">
          <label class="bu-checkbox">
            <input v-model="form.useVision" type="checkbox" @change="saveConfig">
            {{ t('browserUse.useVision') }}
          </label>
          <label class="bu-checkbox">
            <input v-model="form.headless" type="checkbox" @change="saveConfig">
            {{ t('browserUse.headless') }}
          </label>
        </div>
      </div>
    </div>

    <!-- 浏览器配置 -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon">
            <Eye :size="14" />
          </div>
          <span class="s-panel-title">{{ t('browserUse.browserConfig') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="s-form-group">
          <label class="s-form-label">{{ t('browserUse.allowedDomains') }}</label>
          <input v-model="form.allowedDomainsStr" class="s-form-input" type="text" :placeholder="t('browserUse.allowedDomainsHint')" @change="saveConfig">
        </div>
        <div class="bu-form-grid">
          <div class="s-form-group">
            <label class="s-form-label">{{ t('browserUse.userDataDir') }}</label>
            <input v-model="form.userDataDir" class="s-form-input" type="text" :placeholder="t('browserUse.userDataDirHint')" @change="saveConfig">
          </div>
          <div class="s-form-group">
            <label class="s-form-label">{{ t('browserUse.downloadsPath') }}</label>
            <input v-model="form.downloadsPath" class="s-form-input" type="text" :placeholder="t('browserUse.downloadsPathHint')" @change="saveConfig">
          </div>
        </div>
      </div>
    </div>

    <!-- 健康检查结果 -->
    <div v-if="store.doctorResult" class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon" :class="store.doctorResult.ok ? 'success' : 'warning'">
            <Activity :size="14" />
          </div>
          <span class="s-panel-title">{{ t('browserUse.diagnosis') }}</span>
          <span v-if="store.doctorResult.ok" class="s-panel-badge success">{{ t('browserUse.allPassed') }}</span>
          <span v-else class="s-panel-badge warning">{{ t('browserUse.issuesFound') }}</span>
        </div>
        <button class="s-btn s-btn-secondary" @click="hideDoctorResult">
          <X :size="14" />
        </button>
      </div>
      <div class="s-panel-body">
        <div v-for="check in store.doctorResult.checks" :key="check.label" class="cu-permission-row">
          <span class="cu-permission-info">
            <span class="cu-permission-name">{{ check.label }}</span>
          </span>
          <span class="cu-badge" :class="checkBadgeClass(check.status)">
            <CheckCircle v-if="check.status === 'pass'" :size="14" />
            <XCircle v-else-if="check.status === 'fail'" :size="14" />
            <MinusCircle v-else :size="14" />
            {{ check.message }}
          </span>
          <div v-if="check.hint" class="cu-hint">{{ check.hint }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Globe, RefreshCw, CheckCircle, XCircle, AlertCircle,
  Download, Activity, Key, Eye, X, MinusCircle,
} from 'lucide-vue-next'
import { useBrowserUseStore } from '@/stores/browserUse'
import type { BrowserUseAgentConfig } from '@/types/browserUse'

const { t } = useI18n()
const store = useBrowserUseStore()

const form = reactive({
  provider: store.agentConfig.provider,
  model: store.agentConfig.model,
  maxSteps: store.agentConfig.maxSteps,
  temperature: store.agentConfig.temperature,
  useVision: store.agentConfig.useVision,
  headless: store.agentConfig.headless,
  allowedDomainsStr: (store.agentConfig.allowedDomains || []).join(', '),
  userDataDir: store.agentConfig.userDataDir || '',
  downloadsPath: store.agentConfig.downloadsPath || '',
})

onMounted(() => {
  store.refreshStatus()
})

async function handleInstall() {
  await store.install()
  if (store.isInstalled) {
    store.refreshStatus()
  }
}

async function saveConfig() {
  const config: Partial<BrowserUseAgentConfig> = {
    provider: form.provider,
    model: form.model,
    maxSteps: form.maxSteps,
    temperature: form.temperature,
    useVision: form.useVision,
    headless: form.headless,
    allowedDomains: form.allowedDomainsStr.split(',').map((d: string) => d.trim()).filter(Boolean),
    userDataDir: form.userDataDir || null,
    downloadsPath: form.downloadsPath || null,
  }
  await store.updateConfig(config)
}

function hideDoctorResult() {
  store.doctorResult = null
}

function checkBadgeClass(status: string): Record<string, boolean> {
  return {
    'cu-badge-success': status === 'pass',
    'cu-badge-danger': status === 'fail',
    'cu-badge-warning': status === 'skip',
  }
}
</script>

<style scoped>
.browser-use-settings { max-width: 720px; }

.bu-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}

.bu-checkbox-group {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.bu-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-primary);
}

/** ── 面板图标状态修饰符（与 ComputerUseSettings 对齐）── */
.s-panel-icon {
  &.success { background: var(--success-glow); color: var(--success); }
  &.warning { background: var(--warning-glow); color: var(--warning); }
  &.danger { background: var(--error-glow); color: var(--error); }
  &.info { background: var(--accent-primary-glow); color: var(--accent-primary); }
}

/** ── 安装状态行 ── */
.cu-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.cu-status-row:last-child { border-bottom: none; }
.cu-status-label { font-size: 13.5px; font-weight: 500; color: var(--text-muted); }
.cu-status-value {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}
.cu-status-value.cu-mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
}

/** ── 状态徽章 ── */
.cu-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
}
.cu-badge-success { background: var(--success-glow); color: var(--success); }
.cu-badge-danger { background: var(--error-glow); color: var(--error); }
.cu-badge-warning { background: var(--warning-glow); color: var(--warning); }
.cu-badge-yellow { background: var(--warning-glow); color: var(--warning); }
.cu-badge-info { background: var(--accent-primary-glow); color: var(--accent-primary); }

/** ── 面板徽章修饰符 ── */
.s-panel-badge.success {
  background: var(--success-glow);
  color: var(--success);
}
.s-panel-badge.warning {
  background: var(--warning-glow);
  color: var(--warning);
}

/** ── 操作按钮区 ── */
.cu-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  flex-wrap: wrap;
}

/** ── 安装进度条 ── */
.cu-install-progress { margin-top: 14px; }

.cu-progress-bar {
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
}

.cu-progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 2px;
  transition: width .3s;
}

.cu-progress-fill.error { background: var(--error); }

.cu-progress-msg {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 6px;
  display: block;
}

/** ── 就绪 / 警告提示 ── */
.cu-ready-notice {
  margin-top: 12px;
  padding: 8px 10px;
  background: var(--success-glow);
  border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--success);
}

.cu-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--warning-glow);
  border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--warning);
}

.cu-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 12px;
  line-height: 1.5;
}

/** ── 诊断结果行 ── */
.cu-permission-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.cu-permission-row:last-child { border-bottom: none; }
.cu-permission-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.cu-permission-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>