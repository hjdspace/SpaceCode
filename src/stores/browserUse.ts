/**
 * Browser-Use Pinia store。
 *
 * 管理 browser-use Python 运行时的状态：安装、版本、健康检查、
 * LLM 配置、实时浏览器预览。
 *
 * 对齐 computerUse store 的设计模式。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import type {
  BrowserUseStatus,
  BrowserUseUpdateInfo,
  BrowserUseHealthCheck,
  BrowserUseInstallProgress,
  BrowserUseLiveSnapshot,
  BrowserUseAgentConfig,
} from '@/types/browserUse'

export const useBrowserUseStore = defineStore('browserUse', () => {
  const status = ref<BrowserUseStatus | null>(null)
  const loading = ref(false)
  const installing = ref(false)
  const checkingUpdate = ref(false)
  const runningDoctor = ref(false)
  const error = ref<string | null>(null)
  const updateInfo = ref<BrowserUseUpdateInfo | null>(null)
  const doctorResult = ref<{ ok: boolean; checks: BrowserUseHealthCheck[] } | null>(null)
  const installProgress = ref<BrowserUseInstallProgress | null>(null)
  const agentConfig = ref<BrowserUseAgentConfig>({
    provider: 'ChatBrowserUse',
    model: 'bu-2-0',
    apiKeyMasked: false,
    maxSteps: 50,
    temperature: 0.1,
    useVision: true,
    headless: true,
    allowedDomains: [],
    userDataDir: null,
    downloadsPath: null,
  })

  // 实时浏览器预览
  const liveSnapshot = ref<BrowserUseLiveSnapshot | null>(null)

  let installProgressUnsub: (() => void) | null = null
  let liveSnapshotUnsub: (() => void) | null = null

  /** 刷新完整状态 */
  async function refreshStatus() {
    loading.value = true
    error.value = null
    try {
      status.value = await api.browserUse.getStatus()
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  /** 安装/升级 browser-use */
  async function install(options?: { useMirror: boolean; mirrorType: 'tsinghua' | 'aliyun' | 'npmmirror' }) {
    installing.value = true
    error.value = null
    installProgress.value = { stage: 'detecting', message: 'Starting...', percent: 0 }

    // 订阅安装进度
    installProgressUnsub?.()
    installProgressUnsub = api.browserUse.onInstallProgress((progress) => {
      installProgress.value = progress
    })

    try {
      const result = await api.browserUse.install(options)
      if (result.success) {
        await refreshStatus()
      } else {
        error.value = result.error ?? 'Installation failed'
      }
      return result
    } catch (e) {
      error.value = String(e)
      return { success: false, error: String(e) }
    } finally {
      installing.value = false
      installProgressUnsub?.()
      installProgressUnsub = null
    }
  }

  /** 运行健康检查 */
  async function runDoctor() {
    runningDoctor.value = true
    try {
      const result = await api.browserUse.doctor()
      doctorResult.value = result
      return result
    } catch (e) {
      return { ok: false, checks: [] }
    } finally {
      runningDoctor.value = false
    }
  }

  /** 检查更新 */
  async function checkUpdate() {
    checkingUpdate.value = true
    try {
      updateInfo.value = await api.browserUse.checkUpdate()
      return updateInfo.value
    } catch (e) {
      return { updateAvailable: false, latestVersion: null, currentVersion: null }
    } finally {
      checkingUpdate.value = false
    }
  }

  /** 更新 Agent 配置 */
  async function updateConfig(config: Partial<BrowserUseAgentConfig>) {
    try {
      const updated = await api.browserUse.config(config)
      if (updated) {
        agentConfig.value = updated
      }
      return updated
    } catch (e) {
      error.value = String(e)
      return null
    }
  }

  /** 调用 browser-use 工具 */
  async function callTool(name: string, args: Record<string, unknown> = {}) {
    try {
      return await api.browserUse.callTool(name, args)
    } catch (e) {
      error.value = String(e)
      return null
    }
  }

  /** 开始监听实时快照 */
  function startLiveView() {
    stopLiveView()
    liveSnapshotUnsub = api.browserUse.onLiveSnapshot((snapshot) => {
      liveSnapshot.value = snapshot
    })
  }

  /** 停止监听实时快照 */
  function stopLiveView() {
    liveSnapshotUnsub?.()
    liveSnapshotUnsub = null
  }

  /** 获取当前实时快照 */
  async function refreshLiveSnapshot() {
    try {
      liveSnapshot.value = await api.browserUse.getLiveSnapshot()
    } catch {
      // ignore
    }
  }

  // ── Computed ──

  /** 是否已就绪 */
  const isReady = computed(() => status.value?.ready === true)
  /** 是否已安装 */
  const isInstalled = computed(() => status.value?.installed === true)
  /** 是否支持当前平台 */
  const isPlatformSupported = computed(() => status.value?.platformSupported === true)
  /** Python 运行时 */
  const pythonPath = computed(() => status.value?.pythonPath ?? null)
  /** browser-use 版本 */
  const browserUseVersion = computed(() => status.value?.browserUseVersion ?? null)
  /** Chromium 已安装 */
  const chromiumInstalled = computed(() => status.value?.chromiumInstalled === true)
  /** LLM 已配置 */
  const llmConfigured = computed(() => status.value?.llmConfigured === true)
  /** Agent 是否正在运行（从实时快照判断） */
  const isAgentRunning = computed(() => liveSnapshot.value?.agentStatus === 'running')

  return {
    // State
    status,
    loading,
    installing,
    checkingUpdate,
    runningDoctor,
    error,
    updateInfo,
    doctorResult,
    installProgress,
    agentConfig,
    liveSnapshot,

    // Computed
    isReady,
    isInstalled,
    isPlatformSupported,
    pythonPath,
    browserUseVersion,
    chromiumInstalled,
    llmConfigured,
    isAgentRunning,

    // Actions
    refreshStatus,
    install,
    runDoctor,
    checkUpdate,
    updateConfig,
    callTool,
    startLiveView,
    stopLiveView,
    refreshLiveSnapshot,
  }
})