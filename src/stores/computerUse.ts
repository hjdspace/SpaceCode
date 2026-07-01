/**
 * Computer-Use Pinia store。
 *
 * 管理 cua-driver 的状态：安装状态、版本、权限、健康检查。
 * 对齐 hermes-agent 的 computer_use_status 概念。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import type {
  CuaDriverStatus,
  CuaDriverUpdateInfo,
  HealthCheck,
} from '@/types/computerUse'

export const useComputerUseStore = defineStore('computerUse', () => {
  const status = ref<CuaDriverStatus | null>(null)
  const loading = ref(false)
  const installing = ref(false)
  const granting = ref(false)
  const checkingUpdate = ref(false)
  const runningDoctor = ref(false)
  const error = ref<string | null>(null)
  const updateInfo = ref<CuaDriverUpdateInfo | null>(null)
  const doctorResult = ref<{ ok: boolean; checks: HealthCheck[] } | null>(null)
  const installProgress = ref<{ stage: string; message: string; percent: number } | null>(null)
  let installProgressUnsub: (() => void) | null = null

  /** 刷新完整状态 */
  async function refreshStatus() {
    loading.value = true
    error.value = null
    try {
      status.value = await api.computerUse.getStatus()
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  /** 安装/升级 cua-driver */
  async function install() {
    installing.value = true
    error.value = null
    installProgress.value = { stage: 'downloading', message: 'Starting...', percent: 0 }

    // 订阅安装进度
    installProgressUnsub?.()
    installProgressUnsub = api.computerUse.onInstallProgress((progress) => {
      installProgress.value = progress
    })

    try {
      const result = await api.computerUse.install()
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

  /** 请求 macOS TCC 权限 */
  async function grantPermissions() {
    granting.value = true
    error.value = null
    try {
      const result = await api.computerUse.grantPermissions()
      if (result.success) {
        await refreshStatus()
      } else {
        error.value = result.error ?? 'Permission request failed'
      }
      return result
    } catch (e) {
      error.value = String(e)
      return { success: false, error: String(e) }
    } finally {
      granting.value = false
    }
  }

  /** 运行健康检查 */
  async function runDoctor() {
    runningDoctor.value = true
    try {
      const result = await api.computerUse.doctor()
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
      updateInfo.value = await api.computerUse.checkUpdate()
      return updateInfo.value
    } catch (e) {
      return { updateAvailable: false, latestVersion: null, currentVersion: null }
    } finally {
      checkingUpdate.value = false
    }
  }

  /** 是否已就绪 */
  const isReady = computed(() => status.value?.ready === true)
  /** 是否已安装 */
  const isInstalled = computed(() => status.value?.installed === true)
  /** 是否支持当前平台 */
  const isPlatformSupported = computed(() => status.value?.platformSupported === true)
  /** 是否为 macOS（需要 TCC 权限） */
  const isMacOS = computed(() => status.value?.platform === 'darwin')
  /** 二进制来源 */
  const binarySource = computed(() => status.value?.source ?? null)
  /** 是否使用内置版本 */
  const isBundled = computed(() => status.value?.source === 'bundled')
  /** 是否有可用更新 */
  const hasUpdate = computed(() => updateInfo.value?.updateAvailable === true)

  return {
    status,
    loading,
    installing,
    granting,
    checkingUpdate,
    runningDoctor,
    error,
    updateInfo,
    doctorResult,
    installProgress,
    isReady,
    isInstalled,
    isPlatformSupported,
    isMacOS,
    binarySource,
    isBundled,
    hasUpdate,
    refreshStatus,
    install,
    grantPermissions,
    runDoctor,
    checkUpdate,
  }
})
