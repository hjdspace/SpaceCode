/**
 * Config — IM Adapter configuration loading
 *
 * Priority: environment variables > ~/.claude/adapters.json > defaults
 *
 * Supports 5 platform configurations: telegram, feishu, dingtalk, wechat, whatsapp.
 * Each platform has its own allowedUsers, pairedUsers, and defaultWorkDir.
 */

import * as path from 'path'
import * as fs from 'fs'

export type PlatformName = 'telegram' | 'feishu' | 'dingtalk' | 'wechat' | 'whatsapp'

export interface PlatformConfig {
  allowedUsers: string[]
  pairedUsers: Array<{ userId: string; displayName?: string; pairedAt: number }>
  defaultWorkDir: string
}

export interface TelegramConfig extends PlatformConfig {
  botToken: string
}

export interface FeishuConfig extends PlatformConfig {
  appId: string
  appSecret: string
  encryptKey?: string
  verificationToken?: string
  streamingCard: boolean
}

export interface DingTalkConfig extends PlatformConfig {
  clientId: string
  clientSecret: string
  endpoint: string
  permissionCardTemplateId: string
}

export interface WeChatConfig extends PlatformConfig {
  accountId: string
  botToken: string
  baseUrl: string
  userId: string
}

export interface WhatsAppConfig extends PlatformConfig {
  accountJid: string
  authDir: string
}

export interface AdapterConfig {
  serverUrl: string
  defaultProjectDir: string
  pairing: {
    code: string | null
    expiresAt: number | null
    createdAt: number | null
  }
  telegram: TelegramConfig
  feishu: FeishuConfig
  dingtalk: DingTalkConfig
  wechat: WeChatConfig
  whatsapp: WhatsAppConfig
}

const DEFAULT_SERVER_URL = 'ws://127.0.0.1:3456'

/** Strip UNC prefix \\?\ from Windows paths. */
function stripUncPrefix(p: string): string {
  if (p.startsWith('\\\\?\\')) {
    return p.slice(4)
  }
  return p
}

/** Get the Claude config directory. */
export function getClaudeConfigDir(): string {
  const env = process.env.CLAUDE_CONFIG_DIR
  if (env) return stripUncPrefix(path.normalize(env))

  const home = process.env.HOME || process.env.USERPROFILE || ''
  return stripUncPrefix(path.join(home, '.claude'))
}

/** Get the adapters.json config file path. */
export function getAdaptersConfigPath(): string {
  return path.join(getClaudeConfigDir(), 'adapters.json')
}

/** Resolve the default work directory using 5-level fallback. */
export function resolveUserDefaultWorkDir(): string {
  // 1. CLAUDE_ADAPTER_DEFAULT_WORK_DIR env
  const envWorkDir = process.env.CLAUDE_ADAPTER_DEFAULT_WORK_DIR
  if (envWorkDir) return envWorkDir

  // 2. ADAPTER_DEFAULT_PROJECT_DIR env
  const envProjectDir = process.env.ADAPTER_DEFAULT_PROJECT_DIR
  if (envProjectDir) return envProjectDir

  // 3. User home directory
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (home) return home

  // 4. OS temp directory
  const tmp = process.env.TMPDIR || process.env.TEMP || '/tmp'
  return tmp
}

/** Default empty platform config. */
function defaultPlatformConfig(): PlatformConfig {
  return {
    allowedUsers: [],
    pairedUsers: [],
    defaultWorkDir: '',
  }
}

/** Get default config. */
export function getDefaultConfig(): AdapterConfig {
  return {
    serverUrl: process.env.ADAPTER_SERVER_URL ?? DEFAULT_SERVER_URL,
    defaultProjectDir: resolveUserDefaultWorkDir(),
    pairing: {
      code: null,
      expiresAt: null,
      createdAt: null,
    },
    telegram: {
      ...defaultPlatformConfig(),
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    },
    feishu: {
      ...defaultPlatformConfig(),
      appId: process.env.FEISHU_APP_ID ?? '',
      appSecret: process.env.FEISHU_APP_SECRET ?? '',
      encryptKey: process.env.FEISHU_ENCRYPT_KEY,
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
      streamingCard: false,
    },
    dingtalk: {
      ...defaultPlatformConfig(),
      clientId: process.env.DINGTALK_CLIENT_ID ?? '',
      clientSecret: process.env.DINGTALK_CLIENT_SECRET ?? '',
      endpoint: process.env.DINGTALK_STREAM_ENDPOINT ?? 'https://api.dingtalk.com',
      permissionCardTemplateId: process.env.DINGTALK_PERMISSION_CARD_TEMPLATE_ID ?? '',
    },
    wechat: {
      ...defaultPlatformConfig(),
      accountId: process.env.WECHAT_ACCOUNT_ID ?? '',
      botToken: process.env.WECHAT_BOT_TOKEN ?? '',
      baseUrl: process.env.WECHAT_BASE_URL ?? 'https://ilinkai.weixin.qq.com',
      userId: process.env.WECHAT_USER_ID ?? '',
    },
    whatsapp: {
      ...defaultPlatformConfig(),
      accountJid: process.env.WHATSAPP_ACCOUNT_JID ?? '',
      authDir: process.env.WHATSAPP_AUTH_DIR ?? path.join(getClaudeConfigDir(), 'whatsapp-auth', 'default'),
    },
  }
}

/**
 * Load config from adapters.json, merging with defaults.
 * Environment variables take priority over file values.
 */
export function loadConfig(filePath?: string): AdapterConfig {
  const configPath = filePath ?? getAdaptersConfigPath()
  const defaults = getDefaultConfig()

  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const fileConfig = JSON.parse(raw) as Partial<AdapterConfig>

    // Merge file config over defaults (shallow merge per platform)
    return {
      ...defaults,
      ...fileConfig,
      pairing: {
        ...defaults.pairing,
        ...fileConfig.pairing,
      },
      telegram: { ...defaults.telegram, ...fileConfig.telegram },
      feishu: { ...defaults.feishu, ...fileConfig.feishu },
      dingtalk: { ...defaults.dingtalk, ...fileConfig.dingtalk },
      wechat: { ...defaults.wechat, ...fileConfig.wechat },
      whatsapp: { ...defaults.whatsapp, ...fileConfig.whatsapp },
    }
  } catch {
    // File doesn't exist or is corrupted — use defaults
    return defaults
  }
}

/**
 * Save config to adapters.json atomically (tmp + rename).
 */
export function saveConfig(config: AdapterConfig, filePath?: string): void {
  const configPath = filePath ?? getAdaptersConfigPath()
  const dir = path.dirname(configPath)

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const tmpPath = configPath + '.tmp'
  const content = JSON.stringify(config, null, 2)

  fs.writeFileSync(tmpPath, content, {
    encoding: 'utf-8',
    mode: 0o600,
  })

  fs.renameSync(tmpPath, configPath)
}

/**
 * Desensitize sensitive fields for API responses.
 * Replaces botToken, appSecret, clientSecret, botToken (wechat) with '******'.
 */
export function desensitizeConfig(config: AdapterConfig): AdapterConfig {
  return {
    ...config,
    telegram: { ...config.telegram, botToken: config.telegram.botToken ? '******' : '' },
    feishu: {
      ...config.feishu,
      appSecret: config.feishu.appSecret ? '******' : '',
      encryptKey: config.feishu.encryptKey ? '******' : undefined,
      verificationToken: config.feishu.verificationToken ? '******' : undefined,
    },
    dingtalk: { ...config.dingtalk, clientSecret: config.dingtalk.clientSecret ? '******' : '' },
    wechat: { ...config.wechat, botToken: config.wechat.botToken ? '******' : '' },
  }
}
