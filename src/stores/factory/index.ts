/**
 * Factory（AI 流水线）renderer store — 状态、初始化向导与预检的薄编排层。
 *
 * 所有判定与落盘都在主进程完成；这里只保存 UI 需要的快照，
 * 并把「能不能进入下一步」委托给纯逻辑模块 setup.ts。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/services/electronAPI'
import type {
  FactoryConfig,
  FactoryGithubAuthResult,
  FactoryPreflightResult,
  FactorySetupContext,
  FactorySetupDraft,
} from '@/shared/factory'
import {
  canAdvance,
  defaultDraft,
  draftFromConfig,
  setupStepErrors,
  type SetupStep,
} from './setup'

export const useFactoryStore = defineStore('factory', () => {
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const configured = ref(false)
  const config = ref<FactoryConfig | null>(null)
  const configPath = ref('')
  const context = ref<FactorySetupContext | null>(null)
  const preflight = ref<FactoryPreflightResult | null>(null)

  const wizardOpen = ref(false)
  const step = ref<SetupStep>(1)
  const draft = ref<FactorySetupDraft>({})
  const saving = ref(false)
  const saveError = ref<string | null>(null)

  const tokenTesting = ref(false)
  const tokenResult = ref<FactoryGithubAuthResult | null>(null)

  const boardReady = computed(() => configured.value && config.value !== null)

  const stepErrors = computed(() => {
    if (!context.value) return []
    return setupStepErrors(step.value, draft.value, context.value)
  })

  const canGoNext = computed(() => {
    if (!context.value) return false
    return canAdvance(step.value, draft.value, context.value)
  })

  const blocking = computed(() => preflight.value?.blocking ?? true)

  async function loadState(root: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const state = await api.factory.state(root)
      configured.value = state.configured
      config.value = state.config
      configPath.value = state.configPath
      loaded.value = true
    } catch (err) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
  }

  async function loadContext(root: string): Promise<void> {
    try {
      context.value = await api.factory.context(root)
    } catch (err) {
      error.value = String(err)
    }
  }

  async function refresh(root: string): Promise<void> {
    await Promise.all([loadState(root), loadContext(root)])
  }

  async function openWizard(root: string): Promise<void> {
    saveError.value = null
    tokenResult.value = null
    preflight.value = null
    step.value = 1
    if (!context.value) await loadContext(root)
    const ctx = context.value
    if (!ctx) return
    draft.value = ctx.existingConfig ? draftFromConfig(ctx.existingConfig) : defaultDraft(ctx)
    wizardOpen.value = true
  }

  function closeWizard(): void {
    wizardOpen.value = false
    saveError.value = null
  }

  async function runPreflight(root: string): Promise<void> {
    preflight.value = await api.factory.preflight(root, draft.value)
  }

  async function next(root: string): Promise<void> {
    if (!canGoNext.value) return
    if (step.value < 4) {
      step.value = (step.value + 1) as SetupStep
      if (step.value === 4) await runPreflight(root)
    }
  }

  function back(): void {
    if (step.value > 1) step.value = (step.value - 1) as SetupStep
  }

  async function save(root: string): Promise<boolean> {
    saving.value = true
    saveError.value = null
    try {
      const result = await api.factory.save(root, draft.value)
      if (!result.ok) {
        saveError.value = result.error ?? 'write-failed'
        if (result.preflight) preflight.value = result.preflight
        return false
      }
      wizardOpen.value = false
      await loadState(root)
      return true
    } finally {
      saving.value = false
    }
  }

  async function testToken(root: string, token: string, repo: string): Promise<void> {
    tokenTesting.value = true
    try {
      tokenResult.value = await api.factory.testGithubToken(root, token, repo)
      if (tokenResult.value.ok) await storeToken(token)
    } finally {
      tokenTesting.value = false
    }
  }

  async function storeToken(token: string): Promise<boolean> {
    const result = await api.factory.saveGithubToken(token)
    if (!result.ok) {
      saveError.value = result.reason
      return false
    }
    return true
  }

  async function checkGhAuth(): Promise<boolean> {
    const result = await api.factory.checkGhAuth()
    if (context.value) context.value = { ...context.value, ghLoggedIn: result.ok }
    return result.ok
  }

  function reset(): void {
    loading.value = false
    loaded.value = false
    error.value = null
    configured.value = false
    config.value = null
    configPath.value = ''
    context.value = null
    preflight.value = null
    wizardOpen.value = false
    step.value = 1
    draft.value = {}
    saving.value = false
    saveError.value = null
    tokenTesting.value = false
    tokenResult.value = null
  }

  return {
    loading,
    loaded,
    error,
    configured,
    config,
    configPath,
    context,
    preflight,
    wizardOpen,
    step,
    draft,
    saving,
    saveError,
    tokenTesting,
    tokenResult,
    boardReady,
    stepErrors,
    canGoNext,
    blocking,
    loadState,
    loadContext,
    refresh,
    openWizard,
    closeWizard,
    runPreflight,
    next,
    back,
    save,
    testToken,
    storeToken,
    checkGhAuth,
    reset,
  }
})
