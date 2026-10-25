/**
 * 卡片动作的平台落地（票 03 第 2、4 条）。
 *
 * 桥只负责「这条动作被批准了」，真正碰剪贴板与外链的是这里：
 * 桌面走 preload 暴露的 Electron 桥（主进程 clipboard / shell.openExternal），
 * H5 走浏览器 Clipboard API 与带 `noopener` 的新窗口。
 *
 * 平台差异集中在一处，适配器可注入假环境，失败路径（桥缺失、弹窗被拦）因此能单测；
 * 宿主拿到 reject 后给用户可见错误，而不是静默吞掉。
 */
export type CardActionPort = {
  copyText: (text: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
}

export type CardActionEnv = {
  electronAPI?: {
    shell?: { openExternal?: (url: string) => Promise<void> }
    clipboard?: { writeText?: (text: string) => Promise<void> }
  } | null
  navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } }
  open?: (url: string, target: string, features?: string) => unknown
}

/** 桌面：剪贴板与外链都经主进程，卡片自身拿不到这些能力。 */
export function createDesktopCardActionPort(env: CardActionEnv): CardActionPort {
  return {
    async copyText(text: string): Promise<void> {
      const writeText = env.electronAPI?.clipboard?.writeText
      if (!writeText) throw new Error('electron clipboard unavailable')
      await writeText(text)
    },

    async openExternal(url: string): Promise<void> {
      const openExternal = env.electronAPI?.shell?.openExternal
      if (!openExternal) throw new Error('electron shell unavailable')
      await openExternal(url)
    },
  }
}

/** H5：没有 IPC，复制用浏览器剪贴板，外链用 `noopener` 新窗口。 */
export function createH5CardActionPort(env: CardActionEnv): CardActionPort {
  return {
    async copyText(text: string): Promise<void> {
      const writeText = env.navigator?.clipboard?.writeText
      if (!writeText) throw new Error('clipboard unavailable')
      await writeText.call(env.navigator?.clipboard, text)
    },

    async openExternal(url: string): Promise<void> {
      if (!env.open) throw new Error('window.open unavailable')
      // 带 noopener 时规范要求返回 null，返回值不能用来判断弹窗是否被拦截
      env.open(url, '_blank', 'noopener')
    },
  }
}

/** 按当前宿主选择适配器：有 Electron 桥即桌面，否则按 H5 浏览器处理。 */
export function resolveCardActionPort(
  env: CardActionEnv = window as unknown as CardActionEnv,
): CardActionPort {
  return env.electronAPI ? createDesktopCardActionPort(env) : createH5CardActionPort(env)
}
