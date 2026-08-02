// src/stores/pet.ts
// 桌面宠物 Pinia store。职责：偏好管理 + 任务状态聚合 + IPC 推送。
// 参考 cc-haha 重构：丢弃旧的 SVG/反应气泡/AI 反应模型，改为
// sprite atlas 渲染 + 任务状态监控。本 store 只负责数据收集与同步，
// 渲染由独立桌面窗口（petWindowManager）完成。

import { defineStore } from 'pinia'
import { ref, computed, watch, watchEffect } from 'vue'
import { api } from '@/services/electronAPI'
import { findBuiltinPet } from '@/lib/builtinPets'
import {
  buildPetSessionActivities,
  pickPrimaryPetActivity,
  petStatusAnimation,
} from '@/lib/petSessionModel'
import type { PetSessionInput, PetSessionActivity } from '@/lib/petSessionModel'
import type { PetAnimationState } from '@/lib/petAnimation'
import {
  createDefaultPetConfig,
  DEFAULT_PET_PREFERENCES,
  DEFAULT_PET_WINDOW_STATE,
} from '@/types/pet'
import type {
  PetConfig,
  PetPreferences,
  PetWindowState,
  PetSyncPayload,
  BuiltinPetDescriptor,
} from '@/types/pet'
import type { Session } from '@/types'
import { useChatSessionStore } from './chatSession'
import { useTurnStore } from '@/stores/turn'

// 任务状态聚合节流间隔。流式响应期间 loadingSessions/streamingContents 频繁变化，
// 节流避免每个 text_delta 都重建活动列表。
const AGGREGATION_THROTTLE_MS = 500
// IPC 推送节流间隔。activities/preferences/selectedPet 变化时合并发送。
const SYNC_THROTTLE_MS = 150
// 聚合的最近会话数量上限（与 PetSyncPayload 语义一致）。
const AGGREGATION_SESSION_LIMIT = 9

export const usePetStore = defineStore('pet', () => {
  // ── 持久化配置 + 派生状态 ──
  const config = ref<PetConfig | null>(null)
  const isInitialized = ref(false)
  const activities = ref<PetSessionActivity[]>([])

  const preferences = computed<PetPreferences>(
    () => config.value?.preferences ?? DEFAULT_PET_PREFERENCES,
  )
  const windowState = computed<PetWindowState>(
    () => config.value?.windowState ?? DEFAULT_PET_WINDOW_STATE,
  )
  const selectedPet = computed<BuiltinPetDescriptor>(() =>
    findBuiltinPet(preferences.value.selectedPetId),
  )
  const primaryActivity = computed<PetSessionActivity | null>(() =>
    pickPrimaryPetActivity(activities.value),
  )
  const animationState = computed<PetAnimationState>(() => {
    const status = primaryActivity.value?.status
    return status ? petStatusAnimation(status) : 'idle'
  })

  // ── locale ──
  function getLocale(): 'zh-CN' | 'en-US' {
    try {
      const saved = localStorage.getItem('claude_desktop_settings')
      if (saved) {
        const parsed = JSON.parse(saved) as { language?: string }
        return parsed.language === 'en-US' ? 'en-US' : 'zh-CN'
      }
    } catch {
      // ignore parse errors
    }
    return 'zh-CN'
  }

  // ── 任务状态聚合 ──
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let refreshPending = false

  function scheduleRefresh(): void {
    if (refreshTimer) {
      refreshPending = true
      return
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      refreshActivities()
      if (refreshPending) {
        refreshPending = false
        scheduleRefresh()
      }
    }, AGGREGATION_THROTTLE_MS)
  }

  function countRunningTeammates(session: Session): number {
    const teammates = session.teamContext?.teammates
    if (!teammates) return 0
    let count = 0
    for (const teammate of Object.values(teammates)) {
      if (teammate.status === 'running') count += 1
    }
    return count
  }

  function refreshActivities(): void {
    const chatSessionStore = useChatSessionStore()
    const turnStore = useTurnStore()
    const sessions = chatSessionStore.sessions
    const recent = [...sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, AGGREGATION_SESSION_LIMIT)

    const inputs: PetSessionInput[] = recent.map((session) => {
      const messages = session.messages
      const last = messages.length > 0 ? messages[messages.length - 1] : null
      return {
        sessionId: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        processStatus: session.processStatus,
        isLoading: turnStore.getIsLoading(session.id),
        streamingText: turnStore.getStreamingContent(session.id),
        hasPendingPermission: turnStore.pendingPermissions.has(session.id),
        lastMessage: last
          ? {
              role: last.role,
              content: last.content,
              hasError: !!last.metadata?.error,
            }
          : null,
        runningTeammatesCount: countRunningTeammates(session),
      }
    })

    activities.value = buildPetSessionActivities(inputs, AGGREGATION_SESSION_LIMIT)
  }

  // ── IPC 推送（主应用 → 独立窗口） ──
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let syncPending = false

  function performSync(): void {
    if (!preferences.value.enabled) return
    const payload: PetSyncPayload = {
      pet: selectedPet.value,
      preferences: preferences.value,
      activities: activities.value,
      primaryActivity: primaryActivity.value,
      animationState: animationState.value,
      locale: getLocale(),
    }
    api.pet.syncPetState(payload)
  }

  function syncToDesktopWindow(): void {
    if (!preferences.value.enabled) return
    if (syncTimer) {
      syncPending = true
      return
    }
    syncTimer = setTimeout(() => {
      syncTimer = null
      performSync()
      if (syncPending) {
        syncPending = false
        syncToDesktopWindow()
      }
    }, SYNC_THROTTLE_MS)
  }

  // activities/preferences/selectedPet 变化时自动推送（节流）
  watch([activities, selectedPet, preferences], () => {
    syncToDesktopWindow()
  })

  // ── 持久化 ──
  async function persist(): Promise<void> {
    if (!config.value) return
    await api.pet.writeConfig(config.value)
  }

  async function updatePreferences(patch: Partial<PetPreferences>): Promise<void> {
    if (!config.value) {
      config.value = createDefaultPetConfig()
    }
    const prevEnabled = config.value.preferences.enabled
    config.value.preferences = { ...config.value.preferences, ...patch }
    await persist()

    // enabled 切换：true → 创建桌面窗口；false → 销毁
    if (patch.enabled !== undefined && patch.enabled !== prevEnabled) {
      try {
        if (patch.enabled) {
          await api.pet.createDesktopWindow()
        } else {
          await api.pet.destroyDesktopWindow()
        }
      } catch (error) {
        console.error('[Pet] Failed to toggle desktop window:', error)
      }
    }
    syncToDesktopWindow()
  }

  // ── 任务状态聚合：监听 chatSession + turn store 变化 ──
  let aggregationStarted = false
  function startAggregation(): void {
    if (aggregationStarted) return
    aggregationStarted = true
    watchEffect(() => {
      if (!isInitialized.value) return
      const chatSessionStore = useChatSessionStore()
      const turnStore = useTurnStore()
      const sessions = chatSessionStore.sessions
      // 建立响应式依赖：会话元数据 + 每个 session 在 turn store 中的状态。
      // 不读取消息正文（流式期间体积大），仅触发节流后的重建。
      for (const session of sessions) {
        void session.updatedAt
        void session.processStatus
        void session.messages.length
        void turnStore.loadingSessions.get(session.id)
        void turnStore.streamingContents.get(session.id)
        void turnStore.pendingPermissions.has(session.id)
      }
      scheduleRefresh()
    })
  }

  // ── 接收独立窗口事件（独立窗口 → 主应用） ──
  let listenersRegistered = false
  function registerIpcListeners(): void {
    if (listenersRegistered) return
    listenersRegistered = true
    // 独立窗口改了偏好（如展开/收起任务面板）后同步回主应用
    api.pet.onPreferencesChanged((patch) => {
      void updatePreferences(patch)
    })
    // 宠物点击任务行跳转对应会话
    api.pet.onNavigateSession((sessionId) => {
      useChatSessionStore().selectSession(sessionId)
    })
  }

  // ── 初始化 ──
  async function init(): Promise<void> {
    if (isInitialized.value) return

    let loaded: PetConfig | null = null
    try {
      loaded = await api.pet.readConfig()
    } catch (error) {
      console.error('[Pet] Failed to read pet config:', error)
    }
    config.value = loaded ?? createDefaultPetConfig()
    isInitialized.value = true

    registerIpcListeners()

    // 启用状态下恢复桌面窗口
    if (config.value.preferences.enabled) {
      try {
        await api.pet.createDesktopWindow()
      } catch (error) {
        console.error('[Pet] Failed to create desktop window:', error)
      }
    }

    refreshActivities()
    syncToDesktopWindow()
    startAggregation()
  }

  return {
    config,
    preferences,
    windowState,
    selectedPet,
    isInitialized,
    activities,
    primaryActivity,
    animationState,
    init,
    persist,
    updatePreferences,
    syncToDesktopWindow,
  }
})
