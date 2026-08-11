// src/types/pet.ts
// 桌面宠物类型定义。参考 cc-haha 重构：sprite atlas 渲染 + 任务状态监控。
// 丢弃旧的 SVG/反应气泡/AI 反应模型。

import type { PetSessionActivity, PetSessionStatus } from '@/lib/petSessionModel'
import type { PetAnimationState, PetLookDirection } from '@/lib/petAnimation'

// ── 内置宠物描述符 ──

export interface BuiltinPetDescriptor {
  source: 'builtin'
  id: string
  displayName: string
  description: string
  /** 设置页封面图 */
  imageUrl: string
  /** sprite atlas webp 图集 URL */
  spritesheetUrl: string
  spriteVersionNumber: number
  /** 主题色（任务面板/角标用） */
  accent: string
}

// ── 宠物偏好（持久化） ──

export interface PetPreferences {
  /** 是否显示桌面宠物 */
  enabled: boolean
  /** 当前选中的宠物 id */
  selectedPetId: string
  /** 宠物大小（96-192 像素） */
  size: number
  /** 是否播放动画（关闭后宠物静止） */
  motionEnabled: boolean
  /** 是否显示进行中的任务区域 */
  showTaskPanel: boolean
  /** 任务面板默认收起（仅显示角标） */
  panelCollapsed: boolean
}

export const DEFAULT_PET_PREFERENCES: PetPreferences = {
  enabled: false,
  selectedPetId: 'dada-code',
  size: 128,
  motionEnabled: true,
  showTaskPanel: true,
  panelCollapsed: false,
}

// ── 窗口位置持久化 ──

export interface PetWindowState {
  /** 窗口左上角 x（屏幕坐标）。-1 表示未初始化，由系统决定 */
  x: number
  /** 窗口左上角 y（屏幕坐标） */
  y: number
  /** 任务面板相对 mascots 的位置（贴顶翻转用） */
  panelPlacement: 'above' | 'below'
}

export const DEFAULT_PET_WINDOW_STATE: PetWindowState = {
  x: -1,
  y: -1,
  panelPlacement: 'above',
}

// ── 持久化配置（写入 ~/.claude/buddy-pets.json） ──

export interface PetConfig {
  version: number
  preferences: PetPreferences
  windowState: PetWindowState
}

export const PET_CONFIG_VERSION = 2

export function createDefaultPetConfig(): PetConfig {
  return {
    version: PET_CONFIG_VERSION,
    preferences: { ...DEFAULT_PET_PREFERENCES },
    windowState: { ...DEFAULT_PET_WINDOW_STATE },
  }
}

// ── 主应用 → 独立窗口的同步数据 ──

export interface PetSyncPayload {
  /** 当前选中的宠物描述符 */
  pet: BuiltinPetDescriptor
  /** 偏好 */
  preferences: PetPreferences
  /** 任务活动列表（按状态优先级排序，最多 9 个） */
  activities: PetSessionActivity[]
  /** 主导活动（决定宠物动画状态），全部 idle 时为 null */
  primaryActivity: PetSessionActivity | null
  /** 主导动画状态（由 primaryActivity 派生，idle 时为 'idle'） */
  animationState: PetAnimationState
  /** locale */
  locale: 'zh-CN' | 'en-US'
}

// ── 独立窗口 → 主进程的窗口事件 ──

export type PetWindowDragPhase = 'start' | 'move' | 'end'

export interface PetInteractiveRegion {
  x: number
  y: number
  width: number
  height: number
}

export type PetWindowEvent =
  | { type: 'drag'; phase: PetWindowDragPhase; x: number; y: number }
  | { type: 'click' }
  | { type: 'contextMenu' }
  | { type: 'focusMain' }
  | { type: 'focusSession'; sessionId: string }
  | { type: 'setIgnoreMouseEvents'; ignore: boolean }
  | { type: 'setInteractiveRegions'; regions: PetInteractiveRegion[] }
  | { type: 'panelPlacementChanged'; placement: 'above' | 'below' }
  | { type: 'preferencesChanged'; preferences: Partial<PetPreferences> }

// ── 主进程 → 独立窗口的推送事件 ──

export type PetMainWindowEvent =
  | { type: 'navigateSession'; sessionId: string }
  | { type: 'visibilityChanged'; visible: boolean }
  | { type: 'panelPlacementChanged'; placement: 'above' | 'below' }

// ── 视线跟踪辅助类型（渲染层用） ──

export type { PetAnimationState, PetLookDirection } from '@/lib/petAnimation'
export type { PetSessionActivity, PetSessionStatus } from '@/lib/petSessionModel'
