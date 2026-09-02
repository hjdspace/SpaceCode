<template>
  <div class="scm-header">
    <div class="branch-info" @click="showBranchDropdown = !showBranchDropdown">
      <GitBranch :size="14" />
      <span class="branch-name">{{ scmStore.branch || t('scm.noBranch') }}</span>
      <ChevronDown :size="12" />
    </div>
    <div class="scm-actions">
      <button class="scm-action-btn" @click="actions.refresh()" :title="t('scm.refresh')" :aria-label="t('scm.refreshAria')">
        <RefreshCw :size="14" :class="{ spinning: scmStore.isLoading }" />
      </button>
      <button class="scm-action-btn" @click="actions.pull()" :title="t('scm.pull')" :aria-label="t('scm.pullAria')">
        <ArrowDown :size="14" />
      </button>
      <button class="scm-action-btn" @click="actions.push()" :title="t('scm.push')" :aria-label="t('scm.pushAria')">
        <ArrowUp :size="14" />
      </button>
      <button class="scm-action-btn" @click="actions.toggleStash()" :title="t('scm.stash')" :aria-label="t('scm.stashAria')">
        <Archive :size="14" />
      </button>
    </div>
  </div>

  <!-- Branch dropdown -->
  <div v-if="showBranchDropdown" class="branch-dropdown" @click.stop>
    <div class="branch-dropdown-header">
      <span>{{ t('scm.branches') }}</span>
      <button class="branch-create-btn" @click="showCreateBranch = true" :aria-label="t('scm.newBranchAria')">
        <Plus :size="12" />
      </button>
    </div>
    <div class="branch-list">
      <button
        v-for="b in localBranches"
        :key="b.name"
        class="branch-item"
        :class="{ active: b.current }"
        @click="handleCheckout(b.name)"
      >
        <GitBranch :size="12" />
        <span>{{ b.name }}</span>
        <Check v-if="b.current" :size="12" />
      </button>
    </div>
    <div v-if="remoteBranches.length > 0" class="branch-section-title">{{ t('scm.remote').toUpperCase() }}</div>
    <div class="branch-list">
      <button
        v-for="b in remoteBranches"
        :key="b.name"
        class="branch-item"
        @click="handleCheckout(b.name)"
      >
        <GitBranch :size="12" />
        <span>{{ b.name.replace('remotes/', '') }}</span>
      </button>
    </div>
  </div>

  <!-- Create branch dialog -->
  <CreateBranchDialog
    v-if="showCreateBranch"
    @close="showCreateBranch = false"
    @created="onBranchCreated"
  />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitBranch, Plus, Check, ChevronDown, RefreshCw, ArrowUp, ArrowDown, Archive } from 'lucide-vue-next'
import { useScmStore } from '@/stores/scm'
import { useScmActions } from '@/composables/useScmActions'
import CreateBranchDialog from './CreateBranchDialog.vue'

const scmStore = useScmStore()
const { t } = useI18n()
const actions = useScmActions()

const showBranchDropdown = ref(false)
const showCreateBranch = ref(false)

const localBranches = computed(() => scmStore.branches.filter(b => !b.isRemote))
const remoteBranches = computed(() => scmStore.branches.filter(b => b.isRemote))

async function handleCheckout(refName: string): Promise<void> {
  await actions.checkout(refName)
  showBranchDropdown.value = false
}

function onBranchCreated(): void {
  showCreateBranch.value = false
  showBranchDropdown.value = false
}
</script>

<style lang="scss" scoped>
// --- Header ---
.scm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-bottom: 1px solid var(--surface-border);
  gap: 4px;
  min-height: 34px;
}

.branch-info {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 11px;
  color: var(--text-primary);
  transition: background var(--transition-fast);

  &:hover { background: var(--surface-glass-hover); }

  .branch-name {
    font-weight: 500;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.scm-actions {
  display: flex;
  gap: 1px;
}

.scm-action-btn {
  @include reset-button;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  transition: all var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--accent-primary);
  }

  .spinning { animation: spin 1s linear infinite; }
}

@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

// --- Branch Dropdown ---
.branch-dropdown {
  position: absolute;
  top: 38px;
  left: 4px;
  right: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 100;
  max-height: 280px;
  overflow-y: auto;
  @include scrollbar-thin;
}

.branch-dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px;
  border-bottom: 1px solid var(--surface-border);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.branch-create-btn {
  @include reset-button;
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-xs);
  color: var(--text-muted);
  &:hover { background: var(--accent-primary); color: white; }
}

.branch-list { padding: 3px; }

.branch-section-title {
  padding: 5px 10px 3px;
  font-size: 9px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.branch-item {
  @include reset-button;
  display: flex; align-items: center; gap: 5px;
  width: 100%; padding: 5px 7px;
  border-radius: var(--radius-sm);
  font-size: 11px; color: var(--text-primary);
  text-align: left;

  &:hover { background: var(--surface-glass-hover); }
  &.active { color: var(--accent-primary); }
  span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
</style>
