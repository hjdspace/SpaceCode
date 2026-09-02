<template>
  <div class="commit-section">
    <div class="commit-input-wrapper">
      <textarea
        ref="commitTextarea"
        v-model="scmStore.commitMessage"
        class="commit-input"
        :placeholder="t('scm.messagePlaceholder', { branch: scmStore.branch || 'HEAD' })"
        :rows="rows"
        @input="autoResize"
        @keydown.ctrl.enter="handleCommit"
      ></textarea>
      <button
        class="ai-commit-btn"
        :title="t('scm.aiCommitMessage')"
        @click="handleGenerateCommitMessage"
        :class="{ generating: scmStore.isGeneratingCommitMessage }"
      >
        <Sparkles :size="14" :class="{ spin: scmStore.isGeneratingCommitMessage }" />
      </button>
    </div>
    <div class="commit-actions">
      <button class="commit-btn primary" @click="handleCommit()">
        <Check :size="14" /> {{ t('scm.commitButton') }}
      </button>
      <div class="dropdown-wrapper">
        <button class="commit-btn dropdown" @click.stop="showCommitMenu = !showCommitMenu">
          <ChevronDown :size="14" />
        </button>
        <div v-if="showCommitMenu" class="commit-dropdown-menu" @click.stop>
          <button class="commit-menu-item" @click="runMenuAction(actions.commit())">
            {{ t('scm.commit') }}
          </button>
          <button class="commit-menu-item" @click="runMenuAction(actions.commitAmend())">
            {{ t('scm.commitAmend') }}
          </button>
          <div class="commit-menu-divider"></div>
          <button class="commit-menu-item" @click="runMenuAction(actions.commitAndPush())">
            {{ t('scm.commitAndPush') }}
          </button>
          <button class="commit-menu-item" @click="runMenuAction(actions.commitAndSync())">
            {{ t('scm.commitAndSync') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, Sparkles } from 'lucide-vue-next'
import { useScmStore } from '@/stores/scm'
import { useScmActions } from '@/composables/useScmActions'

const scmStore = useScmStore()
const { t } = useI18n()
const actions = useScmActions()

const showCommitMenu = ref(false)
const commitTextarea = ref<HTMLTextAreaElement | null>(null)
const rows = ref(2)

const MIN_ROWS = 2
const MAX_ROWS = 12

function autoResize(): void {
  const el = commitTextarea.value
  if (!el) return
  const text = el.value
  const lineCount = text.split('\n').length
  const wrappedLines = text.split('\n').reduce((acc, line) => {
    if (!line) return acc + 1
    const charWidth = el.clientWidth > 0 ? el.clientWidth / (parseFloat(getComputedStyle(el).fontSize) * 0.6) : 80
    return acc + Math.max(1, Math.ceil(line.length / charWidth))
  }, 0)
  rows.value = Math.min(Math.max(wrappedLines, MIN_ROWS, lineCount), MAX_ROWS)
}

async function handleCommit(): Promise<void> {
  await actions.commit()
  nextTick(() => autoResize())
}

async function handleGenerateCommitMessage(): Promise<void> {
  await actions.generateCommitMessage()
  nextTick(() => autoResize())
}

async function runMenuAction(action: Promise<void>): Promise<void> {
  showCommitMenu.value = false
  await action
}

// Click outside to close the commit dropdown menu
function handleClickOutside(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (!target.closest('.commit-dropdown-menu') && !target.closest('.commit-btn.dropdown')) {
    showCommitMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style lang="scss" scoped>
.commit-section {
  padding: 6px 8px;
  border-bottom: 1px solid var(--surface-border);
}

.commit-input-wrapper {
  position: relative;
}

.commit-input {
  width: 100%;
  padding: 6px 36px 6px 8px; /* right padding to avoid overlap with Sparkles button */
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 11px;
  resize: vertical;
  min-height: 40px;
  outline: none;
  transition: border-color var(--transition-fast);
  line-height: 1.4;

  &:focus { border-color: var(--accent-primary); }
  &::placeholder { color: var(--text-muted); opacity: 0.7; }
}

.commit-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
  gap: 2px;
}

.ai-commit-btn {
  @include reset-button;
  position: absolute;
  bottom: 6px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  transition: all var(--transition-fast);
  cursor: pointer;
  z-index: 1;

  &:hover {
    background: rgba(var(--accent-primary-rgb, 59,130,246), 0.1);
    color: var(--accent-primary);
  }

  &.generating {
    color: var(--accent-primary);
    animation: ai-pulse 1.2s ease-in-out infinite;

    .spin {
      animation: spin 1s linear infinite;
    }
  }
}

@keyframes ai-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.commit-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 30px;
  font-size: 12px;
  font-weight: 500;
  transition: all var(--transition-fast);
  cursor: pointer;

  &.primary {
    flex: 1;
    background: var(--success);
    color: white;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
    &:hover { background: #5bc48e; }
  }

  &.dropdown {
    width: 32px;
    padding: 0;
    background: var(--success);
    color: white;
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    &:hover { background: #5bc48e; }
  }
}

.dropdown-wrapper {
  position: relative;
  display: inline-block;
}

.commit-dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 150;
  min-width: 140px;
  padding: 3px;
}

.commit-menu-item {
  @include reset-button;
  display: block;
  width: 100%;
  padding: 6px 10px;
  border-radius: var(--radius-xs);
  font-size: 12px;
  color: var(--text-primary);
  text-align: left;

  &:hover { background: var(--surface-glass-hover); }
}

.commit-menu-divider {
  height: 1px;
  background: var(--surface-border);
  margin: 2px 4px;
}
</style>
