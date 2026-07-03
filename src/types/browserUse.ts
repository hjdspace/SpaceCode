/**
 * Browser-Use 相关 TypeScript 类型定义。
 *
 * Browser Use 是一个基于 AI 的浏览器操控框架，让 LLM Agent 可以像人一样
 * 浏览网页、填写表单、提取数据。SpaceCode 通过子进程管理 browser-use
 * Python 运行时，以 MCP over stdio 方式通信。
 *
 * 这些类型在 Electron 主进程和 Vue 渲染进程间共享。
 */

/** 健康检查项状态 */
export type HealthCheckStatus = 'pass' | 'fail' | 'skip'

/** 健康检查项 */
export interface BrowserUseHealthCheck {
  /** 检查项名称 */
  label: string
  /** 检查结果状态 */
  status: HealthCheckStatus
  /** 检查结果描述消息 */
  message: string
  /** 修复建议（可选） */
  hint?: string
}

/** Browser-Use 整体状态 */
export interface BrowserUseStatus {
  /** 当前平台标识（darwin / win32 / linux） */
  platform: string
  /** 当前平台是否受支持 */
  platformSupported: boolean
  /** browser-use Python 包是否已安装（pip list 检测） */
  installed: boolean
  /** Python 运行时路径（null 表示未找到） */
  pythonPath: string | null
  /** Python 版本（如 "3.11.9"，null 表示未知） */
  pythonVersion: string | null
  /** browser-use 版本号（null 表示未知） */
  browserUseVersion: string | null
  /** Playwright Chromium 是否已安装 */
  chromiumInstalled: boolean
  /** 安装来源：'system' | 'venv' | null */
  source: 'system' | 'venv' | null
  /** LLM 配置状态 */
  llmConfigured: boolean
  /** LLM Provider 名称 */
  llmProvider: string | null
  /** LLM 模型名称 */
  llmModel: string | null
  /** LLM 凭证来源：desktop（复用桌面配置）| env（系统环境变量）| null（未配置） */
  llmSource?: 'desktop' | 'env' | null
  /** 是否就绪（所有检查通过） */
  ready: boolean | null
  /** 健康检查结果列表 */
  checks: BrowserUseHealthCheck[]
  /** 错误信息 */
  error: string | null
}

/** MCP 工具调用结果 */
export interface BrowserUseToolResult {
  /** 解析后的数据 */
  data: unknown
  /** base64 编码的截图数组 */
  screenshots: string[]
  /** 浏览器当前 URL */
  currentUrl: string | null
  /** 页面标题 */
  pageTitle: string | null
  /** 是否为错误响应 */
  isError: boolean
  /** 执行步骤数 */
  stepsUsed: number
}

/** Browser-Use 更新检查结果 */
export interface BrowserUseUpdateInfo {
  /** 是否有可用更新 */
  updateAvailable: boolean
  /** 最新版本号 */
  latestVersion: string | null
  /** 当前安装版本号 */
  currentVersion: string | null
}

/** Browser-Use Agent 配置 */
export interface BrowserUseAgentConfig {
  /** LLM Provider */
  provider: string
  /** LLM 模型名称 */
  model: string
  /** API Key（仅用于显示掩码，不持久化明文） */
  apiKeyMasked: boolean
  /** 最大执行步数 */
  maxSteps: number
  /** Temperature */
  temperature: number
  /** 是否使用 Vision */
  useVision: boolean
  /** 是否无头模式 */
  headless: boolean
  /** 允许的域名白名单 */
  allowedDomains: string[]
  /** 用户数据目录（复用 Chrome 登录态） */
  userDataDir: string | null
  /** 下载目录 */
  downloadsPath: string | null
}

/** Browser-Use 安装进度 */
export interface BrowserUseInstallProgress {
  /** 当前阶段：detecting | installing_python | installing_pip | installing_playwright | done | error */
  stage: string
  /** 进度消息 */
  message: string
  /** 百分比 0-100 */
  percent: number
}

/** 安装选项（镜像源选择） */
export interface BrowserUseInstallOptions {
  /** 是否使用中国镜像源加速 */
  useMirror: boolean
  /** 镜像类型：tsinghua (清华) | aliyun (阿里) | npmmirror (npmmirror CDN) */
  mirrorType: 'tsinghua' | 'aliyun' | 'npmmirror'
}

/** 实时浏览器预览快照 */
export interface BrowserUseLiveSnapshot {
  /** base64 编码的页面截图 */
  screenshot: string | null
  /** 当前页面 URL */
  url: string
  /** 页面标题 */
  title: string
  /** 当前步骤数 */
  currentStep: number
  /** 总步骤数 */
  totalSteps: number
  /** Agent 状态：idle | running | waiting_input | error */
  agentStatus: 'idle' | 'running' | 'waiting_input' | 'error'
  /** 最后动作描述 */
  lastAction: string | null
}