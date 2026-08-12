<script setup lang="ts">
/**
 * Skill Manager V2 — Skill Detail Slider
 *
 * Right-side slide-out panel showing full skill information.
 * Used as a fallback overlay when the inline inspector is not enough
 * (e.g. file tree viewing). The inline inspector lives in SkillLibraryPage.
 */

import { computed } from 'vue'
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

const visible = computed(() => store.selectedSkillId !== null && store.selectedSkillDetail !== null)
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
    <div v-if="visible && !loading" class="skill-detail-slider">
      <div class="sds-content" v-if="detail">
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
  width: 400px;
  height: 100vh;
  background: var(--bg-elevated);
  border-left: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  z-index: 100;
  box-shadow: var(--shadow-lg);
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.25s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
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
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.sds-name {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  font-family: var(--font-display);
}

.sds-close {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  background: none;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
}

.sds-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 18px;
}

.sds-section {
  margin-bottom: 18px;
}

.sds-section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin: 0 0 6px;
}

.sds-desc {
  font-size: 13px;
  margin: 0 0 8px;
}

.sds-path,
.sds-hash {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  margin: 0;
  word-break: break-all;
}

.sds-frontmatter,
.sds-file-tree {
  font-size: 12px;
  font-family: var(--font-mono);
  background: var(--surface-soft);
  padding: 8px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  margin: 0;
  line-height: 1.4;
}

.sds-empty-list {
  font-size: 13px;
  color: var(--text-muted);
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
  border-bottom: 1px solid var(--border-subtle);
  font-size: 12px;
  flex-wrap: wrap;
}

.sds-target-agent {
  font-weight: 600;
}

.sds-target-mode {
  color: var(--text-muted);
  font-size: 11px;
}

.sds-target-path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
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
  color: var(--text-muted);
}

.sds-footer {
  display: flex;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border-default);
  flex-shrink: 0;
}

.sds-btn {
  flex: 1;
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s;

  &:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }
}

.sds-btn-danger {
  border-color: rgba(220, 38, 38, 0.3);
  color: var(--error);
  background: rgba(220, 38, 38, 0.06);

  &:hover {
    background: rgba(220, 38, 38, 0.12);
  }
}

.sds-status {
  display: inline-block;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: var(--radius-full);
}
</style>
