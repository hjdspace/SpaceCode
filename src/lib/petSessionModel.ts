// src/lib/petSessionModel.ts
// 宠物会话状态模型。从 SpaceCode 的 chatSession + turn store 字段派生 cc-haha 风格的 5 态，
// 并映射到宠物动画状态。纯函数设计，由 pet store 收集数据后传入，避免直接依赖 store。

import type { PetAnimationState } from './petAnimation'

// 宠物观察到的会话状态（cc-haha 风格 5 态）
export type PetSessionStatus = 'waiting' | 'failed' | 'running' | 'idle'

// 单个会话的输入数据（由 pet store 从 chatSession + turn store 收集）
export interface PetSessionInput {
  sessionId: string
  title: string
  updatedAt: number
  // 进程级状态：'none' | 'starting' | 'active' | 'idle' | 'suspended' | 'exited'
  processStatus: string
  // turn store: 是否正在加载/运行（loadingSessions.get(sessionId)）
  isLoading: boolean
  // turn store: 当前流式文本（streamingContents.get(sessionId)）
  streamingText: string
  // turn store: 是否有等待权限审批（pendingPermissions.has(sessionId)）
  hasPendingPermission: boolean
  // 最后一条消息（用于错误检测和预览）
  lastMessage?: {
    role: 'user' | 'assistant' | 'system'
    content: string
    hasError: boolean
  } | null
  // teamContext.teammates 中 status === 'running' 的数量（后台 Agent 任务）
  runningTeammatesCount: number
}

// 宠物观察到的会话活动（用于任务面板显示）
export interface PetSessionActivity {
  sessionId: string
  title: string
  status: PetSessionStatus
  preview: string
  updatedAt: number
}

// 状态优先级：等待最靠前，idle 最后
const STATUS_PRIORITY: Record<PetSessionStatus, number> = {
  waiting: 0,
  failed: 1,
  running: 2,
  idle: 3,
}

// 从输入数据派生会话状态（参考 cc-haha resolvePetSessionStatus，适配 SpaceCode 数据源）
export function resolvePetSessionStatus(input: PetSessionInput): PetSessionStatus {
  // 1. 等待权限审批 → waiting
  if (input.hasPendingPermission) return 'waiting'
  // 2. 正在加载/运行（turn 进行中）→ running
  if (input.isLoading) return 'running'
  // 3. 进程级运行状态 → running
  if (input.processStatus === 'active' || input.processStatus === 'starting') return 'running'
  // 4. 后台 Agent 任务在跑 → running
  if (input.runningTeammatesCount > 0) return 'running'
  // 5. 最后一条消息是错误 → failed
  if (input.lastMessage?.hasError) return 'failed'
  // 6. 进程异常退出 → failed
  if (input.processStatus === 'exited') return 'failed'
  // 7. 其他 → idle
  return 'idle'
}

// 会话状态 → 宠物动画状态
export function petStatusAnimation(status: PetSessionStatus): PetAnimationState {
  switch (status) {
    case 'waiting': return 'waiting'    // 东张西望
    case 'failed':   return 'failed'    // 垂头丧气
    case 'running':  return 'running'   // 低头忙碌
    case 'idle':     return 'idle'      // 站着呼吸
  }
}

// 生成会话预览文本（优先流式文本，其次最后一条 assistant 消息）
export function buildPetSessionPreview(input: PetSessionInput, maxLength = 120): string {
  const live = input.streamingText?.trim()
  if (live) {
    const normalized = live.replace(/\s+/g, ' ')
    return normalized.length > maxLength
      ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
      : normalized
  }

  // 找最后一条 assistant 消息
  if (input.lastMessage?.role === 'assistant' && input.lastMessage.content) {
    const normalized = input.lastMessage.content.replace(/\s+/g, ' ').trim()
    if (normalized) {
      return normalized.length > maxLength
        ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
        : normalized
    }
  }

  return ''
}

// 构建任务活动列表：按状态优先级 + 更新时间排序，取前 limit 个
export function buildPetSessionActivities(
  inputs: readonly PetSessionInput[],
  limit = 9,
): PetSessionActivity[] {
  return inputs
    .map((input) => ({
      sessionId: input.sessionId,
      title: input.title,
      status: resolvePetSessionStatus(input),
      preview: buildPetSessionPreview(input),
      updatedAt: input.updatedAt,
    }))
    .sort((left, right) => {
      const priority = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status]
      if (priority !== 0) return priority
      return right.updatedAt - left.updatedAt
    })
    .slice(0, Math.max(0, limit))
}

// 从活动列表中选出主导活动（决定宠物动画状态）
// 优先级：waiting > failed > running > 无（全部 idle 时返回 null）
export function pickPrimaryPetActivity(
  activities: readonly PetSessionActivity[],
): PetSessionActivity | null {
  // 已经按优先级排序，取第一个非 idle 的
  for (const activity of activities) {
    if (activity.status !== 'idle') return activity
  }
  return null
}
