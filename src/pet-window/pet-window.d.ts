// src/pet-window/pet-window.d.ts
// 独立窗口 petWindowAPI 全局类型声明
// 注意：任务 26 会在 src/types/electron.d.ts 中添加更完整的声明，
// 此处为独立窗口本地类型，确保 typecheck 通过。

export {}

declare global {
  interface PetWindowAPI {
    getInitialState: () => Promise<any>
    onStateUpdate: (handler: (state: any) => void) => () => void
    emitWindowEvent: (event: any) => void
    requestReaction: (req: any) => Promise<string | null>
    getLocale: () => Promise<'zh-CN' | 'en-US'>
  }

  interface Window {
    petWindowAPI: PetWindowAPI
  }
}
