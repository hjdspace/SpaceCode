// src/services/h5Bootstrap.ts
// H5 模式启动引导 — 在 Vue 应用挂载前拉取桌面端配置并注入

import { getH5Config } from './h5ApiClient'

export interface H5DesktopConfig {
  guiSettings: string | null
  mirrorSessionId: string | null
  mirrorProjectPath: string | null
  activeSessions: Array<{
    sessionId: string
    engineSessionId: string | null
    status: string
    isRunning: boolean
  }>
}

let cachedConfig: H5DesktopConfig | null = null

/** 拉取桌面端配置（同步等待，在 app mount 前完成） */
export async function fetchDesktopConfig(): Promise<H5DesktopConfig | null> {
  const h5Config = getH5Config()
  if (!h5Config) return null

  try {
    const res = await fetch(`${h5Config.baseUrl}/api/desktop-config`, {
      headers: { Authorization: `Bearer ${h5Config.token}` },
    })
    if (!res.ok) {
      console.error('[H5Bootstrap] Failed to fetch desktop config:', res.status)
      return null
    }
    const config: H5DesktopConfig = await res.json()
    cachedConfig = config

    // 将 GUI 设置注入 localStorage，让 settingsStore.loadFromGuiSettingsFile() 能读到
    if (config.guiSettings) {
      localStorage.setItem('claude_desktop_settings', config.guiSettings)
      console.log('[H5Bootstrap] Injected desktop GUI settings into localStorage')
    }

    return config
  } catch (err) {
    console.error('[H5Bootstrap] Error fetching desktop config:', err)
    return null
  }
}

/** 获取缓存的桌面端配置 */
export function getCachedDesktopConfig(): H5DesktopConfig | null {
  return cachedConfig
}

/** 获取镜像会话信息 */
export function getMirrorSession(): { sessionId: string | null; projectPath: string | null } {
  if (cachedConfig) {
    return {
      sessionId: cachedConfig.mirrorSessionId,
      projectPath: cachedConfig.mirrorProjectPath,
    }
  }
  return { sessionId: null, projectPath: null }
}
