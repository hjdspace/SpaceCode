<template>
  <div class="artifact-summary-card">
    <div class="card-header">
      <span class="card-icon" aria-hidden="true">
        <PackageCheck :size="14" :stroke-width="2" />
      </span>
      <h3 class="title">{{ t('artifacts.summaryTitle') }}</h3>
      <span class="count">{{ t('artifacts.summaryCount', { count: artifacts.length }) }}</span>
    </div>

    <ul class="file-list">
      <li
        v-for="f in artifacts"
        :key="f.path"
        class="file-item"
        @click="openArtifact(f)"
      >
        <span class="file-icon">{{ iconFor(f.ext) }}</span>
        <div class="file-meta">
          <div class="file-name" :title="f.name">{{ f.name }}</div>
          <div class="file-sub">{{ formatSize(f.size) }} · {{ f.ext.toUpperCase() || 'FILE' }}</div>
        </div>
        <div class="file-actions">
          <button class="act-btn" :title="t('artifacts.open')" @click.stop="openArtifact(f)">
            <ExternalLink :size="13" />
          </button>
          <button class="act-btn" :title="t('artifacts.reveal')" @click.stop="reveal(f)">
            <FolderOpen :size="13" />
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { PackageCheck, ExternalLink, FolderOpen } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import { iconFor, formatSize } from '@/utils/artifactFormat'
import type { ArtifactSummaryEntry } from '@/types'

defineProps<{
  artifacts: ArtifactSummaryEntry[]
}>()

const { t } = useI18n()
const appStore = useAppStore()

const PREVIEWABLE = new Set(['html', 'htm'])

async function openArtifact(f: ArtifactSummaryEntry) {
  if (PREVIEWABLE.has(f.ext)) {
    appStore.openFileInWebview(f.path)
  } else {
    await api.artifacts.open(f.path)
  }
}

async function reveal(f: ArtifactSummaryEntry) {
  await api.artifacts.reveal(f.path)
}
</script>

<style lang="scss" scoped>
.artifact-summary-card {
  background: var(--bg-elevated, #2a2928);
  border: 1px solid var(--border-default, rgba(255, 255, 255, 0.09));
  border-left: 3px solid var(--accent-primary, #d97757);
  border-radius: var(--radius-lg, 10px);
  margin: 16px 0;
  overflow: hidden;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.2));
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05));

  .card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: rgba(217, 119, 87, 0.12);
    color: var(--accent-primary, #d97757);
    flex-shrink: 0;
  }

  .title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #faf9f5);
    line-height: 1.3;
  }

  .count {
    font-size: 11px;
    color: var(--text-muted, rgba(255, 255, 255, 0.5));
  }
}

.file-list { list-style: none; margin: 0; padding: 4px; }

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 150ms ease;

  &:hover {
    background: var(--surface-glass-hover, rgba(255, 255, 255, 0.07));
    .file-actions { opacity: 1; }
  }
}

.file-icon { font-size: 20px; flex-shrink: 0; }

.file-meta { flex: 1; min-width: 0; }
.file-name {
  font-size: 13px;
  color: var(--text-primary, #faf9f5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-sub { font-size: 11px; color: var(--text-muted, rgba(255, 255, 255, 0.5)); margin-top: 2px; }

.file-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 150ms ease; }

.act-btn {
  display: flex;
  background: none;
  border: none;
  color: var(--text-muted, rgba(255, 255, 255, 0.5));
  cursor: pointer;
  padding: 5px;
  border-radius: var(--radius-sm, 4px);
  &:hover { color: var(--accent-primary, #d97757); background: var(--surface-glass, rgba(255, 255, 255, 0.04)); }
}
</style>
