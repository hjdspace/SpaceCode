<template>
  <Teleport to="body">
    <Transition name="scm-context-menu">
      <div
        v-if="visible && file"
        ref="menuRef"
        class="scm-context-menu"
        :style="menuStyle"
        @click.stop
        @contextmenu.prevent
      >
        <button class="menu-item" @click="handleOpenFile">
          <FileText :size="13" />
          <span class="menu-label">{{ t('scm.openFile') }}</span>
        </button>
        <button class="menu-item" @click="handleOpenDiff">
          <GitCompare :size="13" />
          <span class="menu-label">{{ t('scm.openDiff') }}</span>
        </button>

        <div class="menu-separator"></div>

        <button v-if="isStaged" class="menu-item" @click="handleUnstage">
          <Undo2 :size="13" />
          <span class="menu-label">{{ t('scm.unstage') }}</span>
        </button>
        <button v-else class="menu-item" @click="handleStage">
          <Plus :size="13" />
          <span class="menu-label">{{ t('scm.stage') }}</span>
        </button>
        <button
          v-if="!isStaged && file.status !== 'untracked'"
          class="menu-item danger"
          @click="handleDiscard"
        >
          <Trash2 :size="13" />
          <span class="menu-label">{{ t('scm.discardChanges') }}</span>
        </button>

        <div class="menu-separator"></div>

        <button class="menu-item" @click="handleCopyPath">
          <Copy :size="13" />
          <span class="menu-label">{{ t('scm.copyPath') }}</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, FileText, GitCompare, Plus, Trash2, Undo2 } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useScmActions } from '@/composables/useScmActions'
import type { ScmFile } from '@/stores/scm'

const props = defineProps<{
  visible: boolean
  file: ScmFile | null
  isStaged: boolean
  x: number
  y: number
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const actions = useScmActions()

const menuRef = ref<HTMLElement>()
const MENU_WIDTH = 180
const MENU_HEIGHT_ESTIMATE = 190

const menuStyle = computed(() => ({
  left: `${Math.min(props.x, window.innerWidth - MENU_WIDTH - 8)}px`,
  top: `${Math.min(props.y, window.innerHeight - MENU_HEIGHT_ESTIMATE - 8)}px`,
}))

function close(): void {
  emit('close')
}

function handleOpenFile(): void {
  if (props.file) api.openInEditor('vscode', props.file.path)
  close()
}

function handleOpenDiff(): void {
  if (props.file) actions.openFileDiff(props.file, props.isStaged)
  close()
}

function handleStage(): void {
  if (props.file) actions.stageFile(props.file)
  close()
}

function handleUnstage(): void {
  if (props.file) actions.unstageFile(props.file)
  close()
}

async function handleDiscard(): Promise<void> {
  if (props.file) await actions.discardFile(props.file)
  close()
}

function handleCopyPath(): void {
  if (props.file) actions.copyPath(props.file)
  close()
}

function handleClickOutside(e: MouseEvent): void {
  if (props.visible && menuRef.value && !menuRef.value.contains(e.target as Node)) {
    emit('close')
  }
}

function handleEscape(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.visible) {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
  document.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  document.removeEventListener('keydown', handleEscape)
})
</script>

<style lang="scss" scoped>
.scm-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 170px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  padding: 3px;
  box-shadow: var(--shadow-lg);
  user-select: none;
}

.menu-item {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 10px;
  border-radius: var(--radius-xs);
  font-size: 12px;
  color: var(--text-primary);
  text-align: left;
  transition: background var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); }
  &.danger { color: var(--error); &:hover { background: rgba(220,53,69,0.08); } }

  svg { flex-shrink: 0; color: var(--text-muted); }
  &.danger svg { color: var(--error); opacity: 0.8; }
}

.menu-separator {
  height: 1px;
  background: var(--surface-border);
  margin: 3px 4px;
}

.scm-context-menu-enter-active,
.scm-context-menu-leave-active {
  transition: all 0.12s ease;
}

.scm-context-menu-enter-from,
.scm-context-menu-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
