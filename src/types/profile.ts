import type { AuthMethod, ProviderConfig } from '@/stores/settings'

/** 用户自定义模型能力覆盖（按 modelId 索引） */
export interface ModelCapabilityOverride {
  contextWindow?: number
  supportsImages?: boolean
}

/**
 * 一套完整的模型配置快照。
 * 切换 Profile 时，这些字段整体替换当前生效配置。
 */
export interface ModelProfile {
  /** UUID v4，唯一标识 */
  id: string
  /** 用户可编辑的名称，如"工作"/"个人"。允许重名（id 才是唯一键） */
  name: string
  /** 5 种认证方式之一 */
  authMethod: AuthMethod
  anthropicConfig: ProviderConfig
  openaiConfig: ProviderConfig
  geminiConfig: ProviderConfig
  /** 每个模型的上下文窗口大小（字节） */
  modelContextWindows: Record<string, number>
  /** 每个模型的自定义能力覆盖（contextWindow / supportsImages） */
  modelCapabilities?: Record<string, ModelCapabilityOverride>
  /** ISO 8601 创建时间 */
  createdAt: string
  /** ISO 8601 最后更新时间 */
  updatedAt: string
}

/**
 * profiles.json 的整体结构。
 * activeProfileId 为 null 表示首次迁移前的暂态（正常运行时始终指向一个有效 Profile）。
 */
export interface ProfilesFile {
  version: 1
  activeProfileId: string | null
  profiles: ModelProfile[]
}

/**
 * applyProfile 的失败类别，挂在抛出的 Error 上（`profileApplyFailure`）。
 * "切换失败"有三种成因，界面按它选文案：配置没写进主进程、本地代理没对齐、
 * 还是方案文件没落盘。
 */
export type ProfileApplyFailure = 'settings_save_failed' | 'proxy_not_aligned' | 'profiles_save_failed'
