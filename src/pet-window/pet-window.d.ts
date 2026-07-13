// src/pet-window/pet-window.d.ts
// 独立窗口 petWindowAPI 全局类型声明
// 注意：src/types/electron.d.ts 中已有更完整的声明（含 PetWindowAPI 接口和 Window.petWindowAPI），
// 此处通过接口合并保持一致，确保 typecheck 通过。

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
    petWindowAPI?: PetWindowAPI
  }
}
