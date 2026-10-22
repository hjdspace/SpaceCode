export interface ProxyConfig {
  host: string
  port: number
  upstreamProvider: 'openai' | 'openai_compatible' | 'anthropic'
  upstreamBaseUrl: string
  upstreamApiKey: string
  modelMapping: ModelMappingConfig
}

export interface ModelMappingConfig {
  defaultModel?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
}

export interface AdapterStatus {
  running: boolean
  port: number
  requestsProcessed: number
  errorsCount: number
  lastError?: string
}

export interface CliDetectionResult {
  available: boolean
  path: string | null
  version: string | null
  versionCompatible?: boolean
}

export interface CliUpdateCheck {
  installed: boolean
  installedVersion: string | null
  latestVersion: string | null
  hasUpdate: boolean
  /**
   * 二进制在 PATH 上但 `claude --version` 跑不出版本号 —— 安装已损坏（典型是
   * npm wrapper 升上去了、~290MB 的原生平台包没下来，bin 只剩报错占位脚本）。
   * 这是可自救状态，必须给重装修复入口，不能并进 checkFailed 把按钮藏掉。
   */
  unusable: boolean
  /** 已装但没能问到最新版（无网络 / npm 不可用）。不能把它当成「已是最新」。 */
  checkFailed: boolean
}

export interface EnvironmentCheck {
  node: EnvItemStatus
  npm: EnvItemStatus
  git: EnvItemStatus
}

export interface EnvItemStatus {
  available: boolean
  version: string | null
  path: string | null
}

export interface InstallProgress {
  stage: 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
  message: string
  percent?: number
}

export type EngineSource = 'bundled' | 'installed'
