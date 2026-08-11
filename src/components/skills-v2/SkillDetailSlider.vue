<script setup lang="ts">
/**
 * Skill Manager V2 — Skill Detail Slider
 *
 * Right-side slide-out panel showing full skill information.
 * Reference: AgentBro `src/components/skills-v2/SkillDetailSlider.tsx`
 */

import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { FileTreeNode } from '@/types/skillManagerV2'
import AgentIconBadge from './AgentIconBadge.vue'
import {
  STATUS_LABEL_KEYS,
  STATUS_CSS_CLASSES,
  SOURCE_LABEL_KEYS,
} from './skillLabels'

const { t } = useI18n()
const store = useSkillManagerStore()

// ── Computed ───────────────────────────────────────────────────────

const visible = computed(() => store.selectedSkillId !== null)
const detail = computed(() => store.selectedSkillDetail)
const loading = computed(() => store.detailLoading)

const frontmatter = computed<Record<string, unknown> | null>(() => {
  if (!detail.value?.frontmatterJson) return null
  try {
    return JSON.parse(detail.value.frontmatterJson) as Record<string, unknown>
  } catch {
    return null
  }
})

const sourceLabel = computed(() => {
  if (!detail.value?.source) return null
  return t(SOURCE_LABEL_KEYS[detail.value.source.sourceType])
})

// ── Handlers ───────────────────────────────────────────────────────

function handleClose(): void {
  store.clearSelectedSkill()
}

async function handleOpenPath(): Promise<void> {
  if (!detail.value) return
  await store.openPath(detail.value.centerPath)
}

async function handleDelete(): Promise<void> {
  if (!store.selectedSkillId) return
  // Trigger the preview dialog in SkillLibraryPage
  store.busyAction = 'preview-delete'
}

// ── File tree rendering ────────────────────────────────────────────

function renderFileTree(node: FileTreeNode | null, depth = 0): string {
  if (!node) return ''
  const indent = '  '.repeat(depth)
  const icon = node.nodeType === 'dir' ? '📁' : '📄'
  let result = `${indent}${icon} ${node.name}\n`
  if (node.children) {
    for (const child of node.children) {
      result += renderFileTree(child, depth + 1)
    }
  }
  return result
}

const fileTreeText = computed(() => renderFileTree(detail.value?.files ?? null))
</script>

<template>
  <Transition name="slide">
    <div v-if="visible" class="skill-detail-slider">
      <!-- Loading -->
      <div v-if="loading" class="sds-loading">
        {{ t('skillManagerV2.loading') }}
      </div>

      <!-- Content -->
      <div v-else-if="detail" class="sds-content">
        <!-- Header -->
        <header class="sds-header">
          <h2 class="sds-name">{{ detail.name }}</h2>
          <button class="sds-close" @click="handleClose">×</button>
        </header>

        <div class="sds-body">
          <!-- Description -->
          <section class="sds-section">
            <p class="sds-desc">{{ detail.description }}</p>
            <span
              class="sds-status"
              :class="STATUS_CSS_CLASSES[detail.targets.length > 0 ? 'ok' : 'ok']"
            >
              {{ t(STATUS_LABEL_KEYS['ok']) }}
            </span>
          </section>

          <!-- Path -->
          <section class="sds-section">
            <h3 class="sds-section-title">{{ t('skillManagerV2.detail.centerPath') }}</h3>
            <p class="sds-path">{{ detail.centerPath }}</p>
          </section>

          <!-- Source -->
          <section v-if="detail.source" class="sds-section">
            <h3 class="sds-section-title">{{ t('skillManagerV2.detail.source') }}</h3>
            <p>{{ sourceLabel }}</p>
            <p v-if="detail.source.sourceUri" class="sds-path">{{ detail.source.sourceUri }}</p>
          </section>

          <!-- Hash -->
          <section class="sds-section">
            <h3 class="sds-section-title">{{ t('skillManagerV2.detail.hash') }}</h3>
            <p class="sds-hash">{{ detail.currentHash.slice(0, 16) }}…</p>
          </section>

          <!-- Frontmatter -->
          <section v-if="frontmatter" class="sds-section">
            <h3 class="sds-section-title">{{ t('skillManagerV2.detail.frontmatter') }}</h3>
            <pre class="sds-frontmatter">{{ JSON.stringify(frontmatter, null, 2) }}</pre>
          </section>

          <!-- Installed Agents -->
          <section class="sds-section">
            <h3 class="sds-section-title">{{ t('skillManagerV2.detail.installedAgents') }}</h3>
            <div v-if="detail.targets.length === 0" class="sds-empty-list">
              {{ t('skillManagerV2.detail.noTargets') }}
            </div>
            <ul v-else class="sds-target-list">
              <li v-for="target in detail.targets" :key="target.id" class="sds-target-item">
                <AgentIconBadge :badge="{
                  agentId: target.agentId,
                  agentName: target.agentId,
                  mode: target.actualMode,
                  status: target.status,
                }" />
                <span class="sds-target-agent">{{ target.agentId }}</span>
                <span class="sds-target-mode">
                  {{ target.actualMode === 'link' ? t('skillManagerV2.settings.modeLink') : t('skillManagerV2.settings.modeCopy') }}
                </span>
                <span class="sds-target-path">{{ target.targetPath }}</span>
              </li>
            </ul>
          </section>

          <!-- Claims -->
          <section v-if="detail.claims.length > 0" class="sds-section">
            <h3 class="sds-section-title">{{ t('skillManagerV2.detail.claims') }}</h3>
            <ul class="sds-claim-list">
              <li v-for="claim in detail.claims" :key="claim.id" class="sds-claim-item">
                <span class="sds-claim-type">{{ claim.claimType }}</span>
                <span v-if="claim.packId" class="sds-claim-pack">pack: {{ claim.packId }}</span>
              </li>
            </ul>
          </section>

          <!-- File Tree -->
          <section v-if="fileTreeText" class="sds-section">
            <h3 class="sds-section-title">{{ t('skillManagerV2.detail.files') }}</h3>
            <pre class="sds-file-tree">{{ fileTreeText }}</pre>
          </section>
        </div>

        <!-- Actions -->
        <footer class="sds-footer">
          <button class="sds-btn" @click="handleOpenPath">
            {{ t('skillManagerV2.actions.openPath') }}
          </button>
          <button class="sds-btn sds-btn-danger" @click="handleDelete">
            {{ t('skillManagerV2.actions.delete') }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
.skill-detail-slider {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  height: 100vh;
  background: var(--bg-primary, #1e1e1e);
  border-left: 1px solid var(--border-color, #333);
  display: flex;
  flex-direction: column;
  z-index: 100;
  box-shadow: -4px 0 12px rgba(0, 0, 0, 0.3);
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

.sds-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  opacity: 0.7;
}

.sds-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sds-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #333);
  flex-shrink: 0;
}

.sds-name {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.sds-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 24px;
  cursor: pointer;
  padding: 0 4px;
}

.sds-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.sds-section {
  margin-bottom: 20px;
}

.sds-section-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  opacity: 0.6;
  margin: 0 0 6px;
}

.sds-desc {
  font-size: 14px;
  margin: 0 0 8px;
}

.sds-path,
.sds-hash {
  font-size: 12px;
  font-family: monospace;
  opacity: 0.8;
  margin: 0;
  word-break: break-all;
}

.sds-frontmatter,
.sds-file-tree {
  font-size: 12px;
  font-family: monospace;
  background: var(--bg-input, #252525);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0;
}

.sds-empty-list {
  font-size: 13px;
  opacity: 0.6;
}

.sds-target-list,
.sds-claim-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sds-target-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-color, #222);
  font-size: 12px;
  flex-wrap: wrap;
}

.sds-target-agent {
  font-weight: 600;
}

.sds-target-mode {
  opacity: 0.7;
}

.sds-target-path {
  font-family: monospace;
  opacity: 0.6;
  flex-basis: 100%;
}

.sds-claim-item {
  display: flex;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}

.sds-claim-type {
  font-weight: 600;
}

.sds-claim-pack {
  opacity: 0.7;
}

.sds-footer {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-color, #333);
  flex-shrink: 0;
}

.sds-btn {
  flex: 1;
  padding: 8px 16px;
  border: 1px solid var(--border-color, #555);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 13px;

  &:hover {
    background: var(--bg-hover, #2a2a2a);
  }
}

.sds-btn-danger {
  border-color: var(--error-color, #f48771);
  color: var(--error-color, #f48771);

  &:hover {
    background: rgba(244, 135, 113, 0.1);
  }
}

.sds-status {
  display: inline-block;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
}
</style>
