/**
 * Computer-Use 相关 TypeScript 类型定义。
 *
 * 对齐 hermes-agent 的 computer_use 模块，SpaceCode 通过 cua-driver
 * 实现后台桌面控制。这些类型在 Electron 主进程和 Vue 渲染进程间共享。
 */

/** 健康检查项状态 */
export type HealthCheckStatus = 'pass' | 'fail' | 'skip'

/** 健康检查项 */
export interface HealthCheck {
  /** 检查项名称（如 binary_version, platform_supported, ax_capability） */
  label: string
  /** 检查结果状态 */
  status: HealthCheckStatus
  /** 检查结果描述消息 */
  message: string
  /** 修复建议（可选） */
  hint?: string
}

/** cua-driver 二进制状态 */
export interface CuaDriverStatus {
  /** 当前平台标识（darwin / win32 / linux） */
  platform: string
  /** 当前平台是否受支持 */
  platformSupported: boolean
  /** cua-driver 是否已安装（PATH 或内置） */
  installed: boolean
  /** 二进制路径（null 表示未安装） */
  binaryPath: string | null
  /** cua-driver 版本号（null 表示未知） */
  version: string | null
  /** 二进制来源：'bundled'（随应用内置）| 'system'（用户安装）| null */
  source: 'bundled' | 'system' | null
  /** 是否就绪（null 表示未知） */
  ready: boolean | null
  /** 是否支持权限请求（仅 macOS 有 TCC 权限模型） */
  canGrant: boolean
  /** 健康检查结果列表 */
  checks: HealthCheck[]
  /** 错误信息 */
  error: string | null
  /** macOS 辅助功能权限状态（null 表示非 macOS 或未知） */
  accessibility: boolean | null
  /** macOS 屏幕录制权限状态（null 表示非 macOS 或未知） */
  screenRecording: boolean | null
}

/** MCP 工具调用结果 */
export interface McpToolResult {
  /** 解析后的数据（JSON 对象、字符串或 null） */
  data: unknown
  /** base64 编码的图片数组 */
  images: string[]
  /** 对应图片的 MIME 类型数组（与 images 索引对齐） */
  imageMimeTypes: string[]
  /** 结构化内容（cua-driver 的 structuredContent 字段） */
  structuredContent: Record<string, unknown> | null
  /** 是否为错误响应 */
  isError: boolean
}

/** cua-driver 更新检查结果 */
export interface CuaDriverUpdateInfo {
  /** 是否有可用更新 */
  updateAvailable: boolean
  /** 最新版本号 */
  latestVersion: string | null
  /** 当前安装版本号 */
  currentVersion: string | null
}

/** 权限状态 */
export interface CuaDriverPermissions {
  /** 辅助功能权限（仅 macOS） */
  accessibility: boolean | null
  /** 屏幕录制权限（仅 macOS） */
  screenRecording: boolean | null
}
