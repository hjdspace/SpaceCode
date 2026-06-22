<template>
  <AlertDialog
    :visible="alertDialogState.visible"
    :message="alertDialogState.message"
    :title="alertDialogState.title"
    @close="closeAlert"
  />
  <ConfirmDialog
    :visible="confirmDialogState.visible"
    :message="confirmDialogState.message"
    :title="confirmDialogState.title"
    :confirm-text="confirmDialogState.confirmText"
    :cancel-text="confirmDialogState.cancelText"
    :variant="confirmDialogState.variant"
    @confirm="closeConfirm(true)"
    @cancel="closeConfirm(false)"
  />
</template>

<script setup lang="ts">
import AlertDialog from './AlertDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { useDialog } from '@/composables/useDialog'

const { alertDialogState, confirmDialogState, closeAlert, closeConfirm } = useDialog()
</script>
