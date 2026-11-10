// src/composables/useGlobalKeydown.ts
// 页面级快捷键：Ctrl/Cmd+P 呼出快速打开、Esc 退出右侧面板全屏。

import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'

export function useGlobalKeydown() {
  const appStore = useAppStore()

  function onGlobalKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey && !e.altKey) {
      // 仅在有项目时拦截
      if (appStore.projectRoot) {
        e.preventDefault()
        e.stopPropagation()
        appStore.showFileQuickOpen = true
      }
    }
    // Esc 退出右侧面板全屏（面板处于全屏态时输入框/下拉等通常无 Esc 消费方）
    if (e.key === 'Escape' && appStore.infoPanelFullscreen) {
      e.preventDefault()
      e.stopPropagation()
      appStore.exitInfoPanelFullscreen()
    }
  }

  onMounted(() => document.addEventListener('keydown', onGlobalKeydown, true))
  onUnmounted(() => document.removeEventListener('keydown', onGlobalKeydown, true))
}
