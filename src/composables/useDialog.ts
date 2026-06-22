import { ref } from 'vue'

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
