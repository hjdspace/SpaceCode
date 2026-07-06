import { ref } from 'vue'
import { api } from '@/services/electronAPI'

/**
 * RTK 下载状态 composable —— 使用模块级共享状态。
 *
 * 将 `downloading`、`downloadPercent`、`busy` 提升为模块级 ref，
 * 使得 RtkSettings 组件在卸载/重新挂载（切换设置页面）时状态不丢失。
 *
 * IPC 进度监听器也仅在模块加载时注册一次，组件卸载不会取消订阅。
 */

// 模块级共享状态（跨组件挂载/卸载周期持久存在）
const downloading = ref(false)
const downloadPercent = ref(0)
const busy = ref(false)

// 确保进度监听器只注册一次
let listenerInitialized = false
function ensureProgressListener(): void {
  if (listenerInitialized) return
  listenerInitialized = true
  api.rtk.onDownloadProgress((progress) => {
    downloadPercent.value = progress.percent
  })
}

export function useRtkDownloadState() {
  ensureProgressListener()
  return { downloading, downloadPercent, busy }
}
