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
