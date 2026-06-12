<template>
  <div v-if="skill" class="skill-detail">
    <div class="detail-header">
      <button class="back-btn" @click="$emit('close')">
        <ArrowLeft :size="18" />
      </button>
      <h2 class="skill-title">{{ skill.name }}</h2>
    </div>

    <div class="meta-info">
      <div class="meta-item">
        <MapPin :size="14" />
        <span>{{ t('skills.skillDetail.source') }}:</span>
        <strong>{{ sourceDirName }}</strong>
      </div>

      <div class="meta-item">
        <Tag :size="14" />
        <span>{{ t('skills.skillDetail.category') }}:</span>
        <strong>{{ categoryLabel }}</strong>
      </div>

      <div v-if="skill.tags?.length" class="meta-item tags-item">
        <Tags :size="14" />
        <span>{{ t('skills.skillDetail.tags') }}:</span>
        <div class="tags-list">
          <span v-for="tag in skill.tags" :key="tag" class="meta-tag">{{ tag }}</span>
        </div>
      </div>

      <div class="meta-item status-item">
        <CheckCircle2 v-if="skill.isInstalled" :size="14" class="installed-icon" />
        <Circle v-else :size="14" class="not-installed-icon" />
        <span>{{ skill.isInstalled ? t('skills.installed') : t('skills.notInstalled') }}</span>
        <span v-if="skill.installedScope" class="scope-badge">{{ skill.installedScope }}</span>
      </div>
    </div>

    <div class="preview-section">
      <div class="preview-toolbar">
        <h3 class="section-label">{{ t('skills.skillDetail.preview') }}</h3>
        <div class="toolbar-actions">
          <button
            class="toolbar-btn"
            :class="{ active: isTranslated }"
            @click="toggleTranslation"
            :disabled="isTranslating"
            :title="isTranslated ? t('skills.showOriginal') : t('skills.translateToChinese')"
          >
            <Loader2 v-if="isTranslating" :size="14" class="spin" />
            <Languages v-else :size="14" />
            {{ isTranslating ? '...' : isTranslated ? t('skills.showOriginal') : t('skills.translate') }}
          </button>
          <button
            class="toolbar-btn"
            :class="{ active: previewMode === 'source' }"
            @click="previewMode = previewMode === 'preview' ? 'source' : 'preview'"
            :title="previewMode === 'preview' ? t('skills.viewSource') : t('skills.viewPreview')"
          >
            <Code2 v-if="previewMode === 'preview'" :size="14" />
            <Eye v-else :size="14" />
          </button>
        </div>
      </div>
      <div class="preview-content">
        <MarkdownRenderer v-if="previewMode === 'preview'" :content="displayContent" />
        <pre v-else>{{ displayContent }}</pre>
      </div>
    </div>

    <div class="action-buttons">
      <template v-if="!skill.isInstalled">
        <button
          class="action-btn primary"
          :disabled="isInstalling"
          @click="$emit('install', skill.name, 'global')"
        >
          <Download :size="16" />
          {{ isInstalling ? '...' : t('skills.installToGlobal') }}
        </button>
        <button
          class="action-btn secondary"
          :disabled="isInstalling"
          @click="$emit('install', skill.name, 'project')"
        >
          <FolderOpen :size="16" />
          {{ isInstalling ? '...' : t('skills.installToProject') }}
        </button>
      </template>
      <button
        v-else
        class="action-btn danger"
        @click="$emit('uninstall', skill.name)"
      >
        <Trash2 :size="16" />
        {{ t('skills.uninstall') }}
      </button>
    </div>
  </div>

  <div v-else class="no-selection">
    <FileText :size="48" />
    <p>{{ t('skills.selectSkill') || 'Select a skill to view details' }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeft,
  MapPin,
  Tag,
  Tags,
  CheckCircle2,
  Circle,
  Download,
  FolderOpen,
  Trash2,
  FileText,
  Languages,
  Code2,
  Eye,
  Loader2
} from 'lucide-vue-next'
import type { LocalSkill } from '../../stores/localSkills'
import { CATEGORIES } from '../../stores/localSkills'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import { useSkillTranslation } from '@/composables/useSkillTranslation'

const props = defineProps<{
  skill: LocalSkill | null
  isInstalling: boolean
}>()

defineEmits<{
  (e: 'close'): void
  (e: 'install', name: string, scope: 'global' | 'project'): void
  (e: 'uninstall', name: string): void
}>()

const { t } = useI18n()

const previewMode = ref<'preview' | 'source'>('preview')

const {
  isTranslating,
  isTranslated,
  displayContent,
  resetTranslation,
  toggleTranslation,
} = useSkillTranslation(() => props.skill?.content ?? '')

const sourceDirName = computed(() => {
  if (!props.skill) return ''
  return props.skill.sourceDir.split(/[\\/]/).pop() || props.skill.sourceDir
})

const categoryLabel = computed(() => {
  if (!props.skill) return ''
  const cat = CATEGORIES.find(c => c.id === props.skill!.category)
  return cat ? t(cat.labelKey) : t('skills.categories.other')
})

watch(() => props.skill?.name, () => {
  resetTranslation()
  previewMode.value = 'preview'
})
</script>

<style scoped lang="scss">
.skill-detail {
  width: 380px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--surface-border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--surface-border);
}

.back-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s;

  &:hover {
    background: var(--bg-tertiary);
    color: var(--accent-primary);
  }
}

.skill-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-info {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);

  strong {
    color: var(--text-primary);
  }

  &.tags-item {
    align-items: flex-start;

    .tags-list {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
  }

  &.status-item {
    padding-top: 8px;
    border-top: 1px solid var(--surface-border);
  }
}

.meta-tag {
  padding: 2px 8px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  font-size: 11px;
}

.installed-icon {
  color: var(--success);
}

.not-installed-icon {
  color: var(--text-muted);
}

.scope-badge {
  margin-left: auto;
  padding: 2px 8px;
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
}

.preview-section {
  flex: 1;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px 0 8px 0;
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
}

.toolbar-actions {
  display: flex;
  gap: 4px;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid var(--surface-border);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  &.active {
    background: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.preview-content {
  flex: 1;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  padding: 12px;
  overflow: auto;

  pre {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--text-primary);
  }

  :deep(.markdown-renderer) {
    font-size: 13px;
    line-height: 1.6;

    .md-heading {
      margin: 12px 0 6px;
      &.md-h1 { font-size: 18px; }
      &.md-h2 { font-size: 16px; }
      &.md-h3 { font-size: 14px; }
    }

    .md-paragraph {
      margin: 6px 0;
    }

    .code-block {
      padding: 8px 12px;
      margin: 8px 0;
    }
  }
}

.action-buttons {
  padding: 16px;
  border-top: 1px solid var(--surface-border);
  display: flex;
  gap: 8px;
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &.primary {
    background: var(--accent-primary);
    color: white;

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover);
    }
  }

  &.secondary {
    background: transparent;
    color: var(--accent-primary);
    border: 1px solid var(--accent-primary);

    &:hover:not(:disabled) {
      background: var(--accent-primary-glow);
    }
  }

  &.danger {
    background: transparent;
    color: var(--error);
    border: 1px solid var(--error);

    &:hover {
      background: var(--error);
      color: white;
    }
  }
}

.no-selection {
  width: 380px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  gap: 12px;
  border-left: 1px solid var(--surface-border);

  p {
    font-size: var(--font-size-base);
    text-align: center;
    max-width: 200px;
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
