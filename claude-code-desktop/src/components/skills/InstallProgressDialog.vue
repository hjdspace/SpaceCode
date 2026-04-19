<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-overlay">
        <div class="dialog-content">
          <div class="dialog-header">
            <div class="status-icon">
              <Loader2 v-if="phase === 'running'" :size="20" class="spin" />
              <CheckCircle v-else-if="phase === 'success'" :size="20" class="success" />
              <XCircle v-else :size="20" class="error" />
            </div>
            <h3 class="dialog-title">
              {{ phase === 'running' ? 'Installing...' : phase === 'success' ? 'Success!' : 'Failed' }}
            </h3>
          </div>

          <div class="logs-container">
            <div v-if="logs.length === 0 && phase === 'running'" class="logs-placeholder">
              Installing...
            </div>
            <div
              v-for="(line, i) in logs"
              :key="i"
              class="log-line"
            >
              {{ line }}
            </div>
            <div ref="logsEnd" />
          </div>

          <div class="dialog-footer">
            <button class="btn btn-primary" @click="handleClose">
              {{ phase === 'running' ? 'Cancel' : 'Close' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { Loader2, CheckCircle, XCircle } from 'lucide-vue-next'
import { useSkillsStore } from '@/stores/skills'

interface Props {
  open: boolean
  action: 'install' | 'uninstall'
  source: string
  skillId: string
  skillName: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  complete: []
}>()

const skillsStore = useSkillsStore()

type Phase = 'running' | 'success' | 'error'

const phase = ref<Phase>('running')
const logs = ref<string[]>([])
const logsEnd = ref<HTMLElement>()

async function startProcess() {
  phase.value = 'running'
  logs.value = []

  try {
    logs.value.push(`Starting ${props.action}...`)

    if (props.action === 'install') {
      const result = await skillsStore.installMarketplaceSkill(props.source, props.skillId, true)
      
      // Add all logs from the installation process
      if (result.logs && result.logs.length > 0) {
        logs.value.push(...result.logs)
      }
      
      if (result.success) {
        logs.value.push(`✓ Installation completed successfully`)
        phase.value = 'success'
      } else {
        logs.value.push(`✗ Installation failed: ${result.error || 'Unknown error'}`)
        phase.value = 'error'
      }
    } else {
      await skillsStore.uninstallMarketplaceSkill(props.skillName, true)
      logs.value.push(`Successfully uninstalled ${props.skillName}`)
      phase.value = 'success'
    }

    nextTick(() => {
      logsEnd.value?.scrollIntoView({ behavior: 'smooth' })
    })
  } catch (err) {
    phase.value = 'error'
    logs.value.push(`Error: ${(err as Error).message}`)
    nextTick(() => {
      logsEnd.value?.scrollIntoView({ behavior: 'smooth' })
    })
  }
}

function handleClose() {
  if (phase.value === 'success') {
    emit('complete')
  }
  emit('update:open', false)
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    startProcess()
  }
})
</script>

<style lang="scss" scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.dialog-content {
  width: 100%;
  max-width: 480px;
  background: var(--bg-primary);
  border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.status-icon {
  .spin {
    animation: spin 1s linear infinite;
    color: var(--accent-primary);
  }

  .success {
    color: #10b981;
  }

  .error {
    color: #dc3545;
  }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.logs-container {
  max-height: 240px;
  overflow-y: auto;
  padding: 12px 16px;
  background: var(--bg-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  line-height: 1.5;
}

.logs-placeholder {
  color: var(--text-muted);
}

.log-line {
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-primary);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }
}

.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}

.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>
