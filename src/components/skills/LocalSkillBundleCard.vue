<template>
  <div class="bundle-card" :class="{ installed: bundle.isInstalled }">
    <div class="bundle-header" @click="expanded = !expanded">
      <div class="icon-wrapper">
        <Package :size="22" />
      </div>

      <div class="bundle-info">
        <div class="title-row">
          <h3 class="bundle-name">{{ bundle.name }}</h3>
          <span v-if="bundle.version" class="version-badge">v{{ bundle.version }}</span>
          <span v-if="bundle.isInstalled" class="installed-badge">
            <CheckCircle :size="10" />
            {{ scopeLabel }}
          </span>
        </div>
        <p v-if="bundle.description" class="bundle-desc">{{ bundle.description }}</p>
        <div class="meta-row">
          <span v-if="bundle.author" class="meta-item">
            <User :size="11" /> {{ bundle.author }}
          </span>
          <span class="meta-item">
            <Layers :size="11" /> {{ bundle.skillCount }} {{ t('skills.bundle.skills') }}
          </span>
          <span v-if="bundle.hasHooks" class="meta-chip">hooks</span>
          <span v-if="bundle.hasCommands" class="meta-chip">commands</span>
          <span v-if="bundle.hasAgents" class="meta-chip">agents</span>
        </div>
      </div>

      <div class="actions" @click.stop>
        <a
          v-if="bundle.homepage"
          :href="bundle.homepage"
          target="_blank"
          rel="noopener noreferrer"
          class="icon-btn"
          :title="bundle.homepage"
        >
          <ExternalLink :size="14" />
        </a>
        <button
          v-if="!bundle.isInstalled"
          class="action-btn primary"
          :disabled="installing"
          @click="$emit('install', bundle)"
        >
          <Loader2 v-if="installing" :size="14" class="spin" />
          <Download v-else :size="14" />
          {{ t('skills.bundle.installAll') }}
        </button>
        <button
          v-else
          class="action-btn danger"
          @click="$emit('uninstall', bundle)"
        >
          <Trash2 :size="14" />
          {{ t('skills.uninstall') }}
        </button>
        <button class="icon-btn" :title="expanded ? t('common.collapse') : t('common.expand')" @click="expanded = !expanded">
          <ChevronDown :size="16" :class="{ rotated: expanded }" />
        </button>
      </div>
    </div>

    <div v-if="expanded" class="bundle-body">
      <div v-if="skills.length === 0" class="empty">
        {{ t('skills.bundle.noSkills') }}
      </div>
      <div v-else class="skills-list">
        <div
          v-for="s in skills"
          :key="s.skillPath"
          class="bundle-skill-row"
          @click="$emit('selectSkill', s)"
        >
          <FileText :size="14" class="row-icon" />
          <div class="row-main">
            <span class="row-name">{{ s.name }}</span>
            <span class="row-desc">{{ truncate(s.description, 110) }}</span>
          </div>
          <span v-if="s.isInstalled" class="row-status installed">
            <CheckCircle :size="12" /> {{ t('skills.installed') }}
          </span>
          <span v-else class="row-status">—</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Package, CheckCircle, User, Layers, ChevronDown,
  ExternalLink, Download, Trash2, Loader2, FileText
} from 'lucide-vue-next'
import type { LocalSkill, LocalSkillBundle } from '../../stores/localSkills'

const props = defineProps<{
  bundle: LocalSkillBundle
  skills: LocalSkill[]
  installing: boolean
}>()

defineEmits<{
  (e: 'install', bundle: LocalSkillBundle): void
  (e: 'uninstall', bundle: LocalSkillBundle): void
  (e: 'selectSkill', skill: LocalSkill): void
}>()

const { t } = useI18n()
const expanded = ref(false)

const scopeLabel = computed(() => {
  const scope = props.bundle.installedScope
  if (scope === 'global') return t('skills.installedGlobal')
  if (scope === 'project') return t('skills.installedProject')
  if (scope === 'mixed') return t('skills.installedMixed')
  return t('skills.installed')
})

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '...' : s
}
</script>

<style scoped lang="scss">
.bundle-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--accent-primary);
  }

  &.installed {
    border-left: 3px solid var(--success, #10b981);
  }
}

.bundle-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
}

.icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--bg-tertiary);
  color: var(--accent-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bundle-info {
  flex: 1;
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.bundle-name {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.version-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
}

.installed-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  border: 1px solid #10b981;
  color: #10b981;
}

.bundle-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 4px 0 6px;
  line-height: 1.5;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-tertiary);
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.meta-chip {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 10px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  svg.rotated {
    transform: rotate(180deg);
    transition: transform 0.15s;
  }

  svg {
    transition: transform 0.15s;
  }
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &.primary {
    background: var(--accent-primary);
    color: white;

    &:hover:not(:disabled) { opacity: 0.9; }
  }

  &.danger {
    background: transparent;
    color: var(--error, #dc3545);
    border: 1px solid var(--error, #dc3545);

    &:hover {
      background: var(--error, #dc3545);
      color: white;
    }
  }
}

.bundle-body {
  border-top: 1px solid var(--border-color);
  background: var(--bg-primary);
  padding: 8px 12px 12px;
}

.empty {
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
  padding: 14px;
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bundle-skill-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: var(--bg-tertiary);
  }
}

.row-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.row-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-status {
  font-size: 11px;
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;

  &.installed {
    color: #10b981;
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
