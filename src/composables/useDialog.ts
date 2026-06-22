import { ref } from 'vue'

// 单例状态：故意定义在模块作用域，使所有 useDialog() 调用共享同一份状态。
// DialogProvider 通过 useDialog() 读取状态渲染弹窗，其他组件通过 useDialog() 调用 showAlert/showConfirm 触发弹窗。
// 若将状态移入 useDialog() 内部，各组件将持有独立状态，DialogProvider 无法响应其他组件触发的弹窗。
const alertDialogState = ref<{
  visible: boolean
  message: string
  title?: string
  resolve?: (value: void) => void
}>({ visible: false, message: '' })

const confirmDialogState = ref<{
  visible: boolean
  message: string
  title?: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'default'
  resolve?: (value: boolean) => void
}>({ visible: false, message: '' })

export function useDialog() {
  function showAlert(message: string, title?: string): Promise<void> {
    return new Promise((resolve) => {
      alertDialogState.value = {
        visible: true,
        message,
        title,
        resolve,
      }
    })
  }

  function showConfirm(message: string, options?: {
    title?: string
    confirmText?: string
    cancelText?: string
    variant?: 'danger' | 'warning' | 'default'
  }): Promise<boolean> {
    return new Promise((resolve) => {
      confirmDialogState.value = {
        visible: true,
        message,
        ...options,
        resolve,
      }
    })
  }

  function closeAlert() {
    const resolve = alertDialogState.value.resolve
    alertDialogState.value.visible = false
    resolve?.()
  }

  function closeConfirm(result: boolean) {
    const resolve = confirmDialogState.value.resolve
    confirmDialogState.value.visible = false
    resolve?.(result)
  }

  return {
    alertDialogState,
    confirmDialogState,
    showAlert,
    showConfirm,
    closeAlert,
    closeConfirm,
  }
}
