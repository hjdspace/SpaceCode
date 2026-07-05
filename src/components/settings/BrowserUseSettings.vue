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

          <!-- 镜像源选择（仅未安装或安装中显示） -->
          <div v-if="!store.isInstalled || !store.chromiumInstalled" class="bu-mirror-section">
            <label class="s-form-label">{{ t('browserUse.mirrorSource') }}</label>
            <div class="bu-mirror-options">
              <label class="bu-mirror-option" :class="{ active: !useMirror }">
                <input v-model="useMirror" :value="false" type="radio" name="buMirror" :disabled="store.installing">
                <span class="bu-mirror-name">{{ t('browserUse.mirrorOfficial') }}</span>
                <span class="bu-mirror-desc">pypi.org</span>
              </label>
              <label class="bu-mirror-option" :class="{ active: useMirror && mirrorType === 'tsinghua' }">
                <input v-model="useMirror" :value="true" type="radio" name="buMirror" :disabled="store.installing">
                <input v-model="mirrorType" value="tsinghua" type="radio" name="buMirrorType" class="bu-mirror-type-radio" :disabled="store.installing || !useMirror">
                <span class="bu-mirror-name">🇨🇳 {{ t('browserUse.mirrorTsinghua') }}</span>
                <span class="bu-mirror-desc">tuna.tsinghua</span>
              </label>
              <label class="bu-mirror-option" :class="{ active: useMirror && mirrorType === 'aliyun' }">
                <input v-model="useMirror" :value="true" type="radio" name="buMirror" :disabled="store.installing">
                <input v-model="mirrorType" value="aliyun" type="radio" name="buMirrorType" class="bu-mirror-type-radio" :disabled="store.installing || !useMirror">
                <span class="bu-mirror-name">🇨🇳 {{ t('browserUse.mirrorAliyun') }}</span>
                <span class="bu-mirror-desc">mirrors.aliyun</span>
              </label>
              <label class="bu-mirror-option" :class="{ active: useMirror && mirrorType === 'npmmirror' }">
                <input v-model="useMirror" :value="true" type="radio" name="buMirror" :disabled="store.installing">
                <input v-model="mirrorType" value="npmmirror" type="radio" name="buMirrorType" class="bu-mirror-type-radio" :disabled="store.installing || !useMirror">
                <span class="bu-mirror-name">🇨🇳 npmmirror</span>
                <span class="bu-mirror-desc">Chromium CDN</span>
              </label>
            </div>
            <p v-if="useMirror" class="bu-mirror-hint">{{ t('browserUse.mirrorHint') }}</p>
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
        <div v-if="store.llmConfigured" class="cu-reuse-notice cu-reuse-ok">
          <CheckCircle :size="14" />
          <span>{{ t('browserUse.llmReused') }}</span>
          <span v-if="store.status?.llmProvider" class="cu-reuse-meta">
            {{ store.status.llmProvider }}<template v-if="store.status?.llmModel"> · {{ store.status.llmModel }}</template>
          </span>
        </div>
        <div v-else class="cu-reuse-notice cu-reuse-warn">
          <AlertCircle :size="14" />
          <span>{{ t('browserUse.llmNotReused') }}</span>
        </div>
        <p class="cu-hint">{{ t('browserUse.llmReuseHint') }}</p>

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
              <option v-if="!PRESET_MODELS.includes(form.model)" :value="form.model">{{ form.model }}</option>
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
            <div class="bu-input-with-btn">
              <input v-model="form.userDataDir" class="s-form-input" type="text" :placeholder="t('browserUse.userDataDirHint')" @change="saveConfig">
              <button
                class="bu-browse-btn"
                type="button"
                :title="t('browserUse.browseFolder')"
                :aria-label="t('browserUse.browseFolder')"
                @click="pickFolder('userDataDir')"
              >
                <FolderOpen :size="14" />
              </button>
            </div>
          </div>
          <div class="s-form-group">
            <label class="s-form-label">{{ t('browserUse.downloadsPath') }}</label>
            <div class="bu-input-with-btn">
              <input v-model="form.downloadsPath" class="s-form-input" type="text" :placeholder="t('browserUse.downloadsPathHint')" @change="saveConfig">
              <button
                class="bu-browse-btn"
                type="button"
                :title="t('browserUse.browseFolder')"
                :aria-label="t('browserUse.browseFolder')"
                @click="pickFolder('downloadsPath')"
              >
                <FolderOpen :size="14" />
              </button>
            </div>
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
  Download, Activity, Key, Eye, X, MinusCircle, FolderOpen,
} from 'lucide-vue-next'
import { useBrowserUseStore } from '@/stores/browserUse'
import { api } from '@/services/electronAPI'
import type { BrowserUseAgentConfig } from '@/types/browserUse'

const { t } = useI18n()
const store = useBrowserUseStore()

// 镜像源选择（默认使用清华镜像，国内用户更友好）
const useMirror = ref(true)
const mirrorType = ref<'tsinghua' | 'aliyun' | 'npmmirror'>('tsinghua')

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

/** 预设模型列表（用于判断 model 下拉是否需要追加动态选项） */
const PRESET_MODELS = ['bu-2-0', 'claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-5.5', 'gemini-3-pro']

/** 首次加载时，若检测到桌面 LLM 配置，自动对齐 provider/model 以复用桌面凭证 */
function syncFromDesktop() {
  const status = store.status
  if (!status?.llmConfigured || status.llmSource !== 'desktop') return
  const provider = status.llmProvider
  const model = status.llmModel
  if (provider && ['Anthropic', 'OpenAI', 'Google'].includes(provider)) {
    let changed = false
    if (form.provider !== provider) {
      form.provider = provider
      changed = true
    }
    if (model && form.model !== model) {
      form.model = model
      changed = true
    }
    if (changed) void saveConfig()
  }
}

onMounted(async () => {
  await store.refreshStatus()
  syncFromDesktop()
})

async function handleInstall() {
  await store.install({
    useMirror: useMirror.value,
    mirrorType: mirrorType.value,
  })
  if (store.isInstalled) {
    store.refreshStatus()
  }
}

/** 打开系统目录选择器，将所选路径填入指定字段 */
async function pickFolder(field: 'userDataDir' | 'downloadsPath') {
  const result = await api.selectFolder()
  if (!result.canceled && result.filePaths.length > 0) {
    form[field] = result.filePaths[0]
    await saveConfig()
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

/** ── 镜像源选择 ── */
.bu-mirror-section {
  margin-top: 14px;
  padding: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.bu-mirror-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.bu-mirror-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1.5px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all .15s;
  background: var(--bg-elevated);
  position: relative;

  &:hover {
    border-color: var(--accent-primary);
  }

  &.active {
    border-color: var(--accent-primary);
    background: var(--accent-primary-glow);
  }

  input[type="radio"]:not(.bu-mirror-type-radio) {
    position: absolute;
    top: 8px;
    right: 8px;
    accent-color: var(--accent-primary);
  }

  .bu-mirror-type-radio {
    display: none;
  }
}

.bu-mirror-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.bu-mirror-desc {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.bu-mirror-hint {
  font-size: 11px;
  color: var(--accent-primary);
  margin-top: 8px;
  margin-bottom: 0;
  line-height: 1.4;
}

.bu-checkbox-group {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  flex-wrap: wrap;
}

/** ── 输入框 + 浏览按钮组合 ── */
.bu-input-with-btn {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.bu-input-with-btn .s-form-input {
  flex: 1;
  min-width: 0;
}

.bu-browse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 34px;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-muted);
  cursor: pointer;
  transition: background .15s, color .15s, border-color .15s;
}

.bu-browse-btn:hover {
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  border-color: color-mix(in srgb, var(--accent-primary) 40%, transparent);
}

.bu-browse-btn:active {
  transform: scale(0.96);
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

/** ── LLM 复用状态提示 ── */
.cu-reuse-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  margin-bottom: 10px;
}
.cu-reuse-ok {
  background: var(--success-glow);
  border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
  color: var(--success);
}
.cu-reuse-warn {
  background: var(--warning-glow);
  border: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
  color: var(--warning);
}
.cu-reuse-meta {
  font-family: var(--font-mono);
  font-size: 11.5px;
  opacity: 0.85;
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