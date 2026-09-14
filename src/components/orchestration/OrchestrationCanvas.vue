<template>
  <div class="orchestration-canvas">
    <!-- 工具栏 -->
    <div class="orchestration-toolbar">
      <button
        class="toolbar-btn"
        :class="{ active: showMinimap }"
        @click="toggleMinimap"
        :title="t('orchestration.toggleMinimap')"
      >
        <MapIcon :size="16" />
        <span>{{ t('orchestration.minimap') }}</span>
      </button>
    </div>

    <!-- Vue Flow 画布 -->
    <div class="orchestration-flow-wrapper">
      <VueFlow
        :default-viewport="{ zoom: 1, x: 0, y: 0 }"
        :min-zoom="0.2"
        :max-zoom="4"
        :delete-key-code="null"
        fit-view-on-init
      >
        <Background v-if="showBackground" />
        <MiniMap v-if="showMinimap" pannable zoomable />
      </VueFlow>

      <!-- 空画布引导提示 -->
      <div class="orchestration-empty-guide">
        <div class="empty-guide-icon">
          <Workflow :size="48" />
        </div>
        <h3>{{ t('orchestration.emptyTitle') }}</h3>
        <p>{{ t('orchestration.emptyDesc') }}</p>
        <button class="empty-guide-btn" @click="handleCreateFirstNode">
          <Plus :size="16" />
          {{ t('orchestration.createFirstNode') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { Background } from '@vue-flow/background'
import { Map as MapIcon, Workflow, Plus } from 'lucide-vue-next'
import { useOrchestrationCanvas } from '@/composables/useOrchestrationCanvas'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'

const { t } = useI18n()
const { showMinimap, toggleMinimap } = useOrchestrationCanvas()

const showBackground = ref(true)

function handleCreateFirstNode() {
  // 本票不含节点创建 — 预留入口
}
</script>

<style lang="scss" scoped>
.orchestration-canvas {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-secondary, #1a1a2e);
}

.orchestration-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-glass);
  flex-shrink: 0;
  z-index: 10;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;

  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }

  &.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }
}

.orchestration-flow-wrapper {
  flex: 1;
  min-height: 0;
  position: relative;
}

// Vue Flow 需要明确宽高
.orchestration-flow-wrapper :deep(.vue-flow) {
  width: 100%;
  height: 100%;
}

.orchestration-empty-guide {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  pointer-events: none;
  z-index: 5;

  .empty-guide-icon {
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-lg);
    background: var(--surface-glass);
    border: 1px solid var(--surface-border);
    color: var(--accent-primary);
    margin-bottom: 8px;
  }

  h3 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  p {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
    max-width: 260px;
    line-height: 1.5;
  }

  .empty-guide-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    margin-top: 6px;
    font-size: 13px;
    font-weight: 500;
    color: white;
    background: var(--accent-primary);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.15s ease;
    pointer-events: auto;
    font-family: inherit;

    &:hover {
      background: var(--accent-primary-hover);
      transform: scale(1.03);
      box-shadow: 0 0 12px var(--accent-primary-glow);
    }

    &:active {
      transform: scale(0.98);
    }
  }
}
</style>
