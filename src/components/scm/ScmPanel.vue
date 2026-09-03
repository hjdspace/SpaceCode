<template>
  <div class="scm-panel">
    <ScmHeader />
    <ScmCommitSection />

    <!-- Changes section (resizable) -->
    <div class="changes-container" :style="{ flex: changesFlex + ' 1 0%' }">
      <ScmChangesSection />
    </div>

    <!-- Resize Handle (draggable splitter) -->
    <div class="resize-handle" :class="{ active: isResizing }" @mousedown="startResize"></div>

    <!-- Git Graph section (fills remaining space) -->
    <div class="graph-section" :style="{ flex: graphFlex + ' 1 0%' }">
      <ScmGraphSection />
    </div>

    <!-- Not a repo -->
    <div v-if="!scmStore.isRepo && !scmStore.isLoading" class="empty-scm">
      <div class="empty-icon">
        <GitBranch :size="28" />
      </div>
      <h4>{{ t('scm.scmTitle') }}</h4>
      <p>{{ t('scm.scmOpenFolder') }}</p>
    </div>

    <!-- Error -->
    <div v-if="scmStore.error" class="scm-error">
      <AlertCircle :size="14" />
      <span>{{ scmStore.error }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitBranch, AlertCircle } from 'lucide-vue-next'
import { useScmStore } from '@/stores/scm'
import { useAppStore } from '@/stores/app'
import { useScmSplit } from '@/composables/useScmSplit'
import ScmHeader from './ScmHeader.vue'
import ScmCommitSection from './ScmCommitSection.vue'
import ScmChangesSection from './ScmChangesSection.vue'
import ScmGraphSection from './ScmGraphSection.vue'

const scmStore = useScmStore()
const appStore = useAppStore()
const { t } = useI18n()
const { isResizing, changesFlex, graphFlex, startResize } = useScmSplit()

let refreshTimer: ReturnType<typeof setInterval> | null = null

watch(() => appStore.projectRoot, async () => {
  await scmStore.refresh()
  await scmStore.refreshBranches()
  await scmStore.refreshLog(50)
})

onMounted(async () => {
  await scmStore.refresh()
  await scmStore.refreshBranches()
  await scmStore.refreshLog(50)
  // Polling as fallback (event-driven refresh is primary via git:statusChanged)
  refreshTimer = setInterval(() => {
    scmStore.refresh()
  }, 60000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  scmStore.stopWatching()
})
</script>

<style lang="scss" scoped>
.scm-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

// --- Changes Container (upper resizable section) ---
.changes-container {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 80px;
}

// --- Resize Handle ---
.resize-handle {
  height: 4px;
  cursor: ns-resize;
  background: var(--surface-border);
  transition: background var(--transition-fast);
  flex-shrink: 0;
  position: relative;
  z-index: 10;

  &:hover, &.active {
    background: var(--accent-primary);
  }

  &::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 24px;
    height: 2px;
    background: var(--text-muted);
    border-radius: 1px;
    opacity: 0;
    transition: opacity var(--transition-fast);
  }

  &:hover::after, &.active::after {
    opacity: 1;
    background: white;
  }
}

// --- Git Graph Section (lower section, fills remaining space) ---
.graph-section {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 80px;
}

// --- Empty state ---
.empty-scm {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 32px 16px;
  text-align: center;

  .empty-icon {
    width: 48px; height: 48px;
    border-radius: var(--radius-lg);
    background: var(--surface-glass);
    border: 1px solid var(--surface-border);
    @include flex-center;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  h4 { font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary); }
  p  { font-size: 11px; color: var(--text-muted); line-height: 1.5; max-width: 200px; }
}

.scm-error {
  display: flex; align-items: center; gap: 5px;
  padding: 6px 10px;
  margin: 3px 6px;
  background: rgba(220,53,69,0.1);
  border-radius: var(--radius-sm);
  color: var(--error);
  font-size: 10px;
  span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
</style>
