<template>
  <div class="marketplace-skill-detail">
    <!-- Header -->
    <div class="detail-header">
      <div class="header-content">
        <div class="skill-icon-wrapper">
          <Zap :size="20" class="skill-icon" />
        </div>
        <div class="skill-info">
          <div class="skill-title-row">
            <h3 class="skill-name">{{ skill.name }}</h3>
            <span v-if="skill.isInstalled" class="installed-badge">
              <CheckCircle :size="10" />
              Installed
            </span>
          </div>
          <div class="skill-meta">
            <span class="skill-source">{{ skill.source }}</span>
            <a
              v-if="githubUrl"
              :href="githubUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="github-link"
            >
              <ExternalLink :size="14" />
            </a>
            <span v-if="skill.installs > 0" class="install-count">
              <Download :size="12" />
              {{ skill.installs.toLocaleString() }}
            </span>
          </div>
        </div>
        <div class="skill-actions">
          <button
            v-if="skill.isInstalled"
            class="btn btn-danger"
            @click="handleUninstall"
          >
            <Trash2 :size="14" />
            Uninstall
          </button>
          <button
            v-else
            class="btn btn-primary"
            @click="handleInstall"
          >
            <Download :size="14" />
            Install
          </button>
        </div>
      </div>
    </div>

    <!-- Body — SKILL.md content -->
    <div class="detail-body">
      <div v-if="readmeLoading" class="readme-loading">
        <Loader2 :size="20" class="spin" />
      </div>
      <div
        v-else-if="displayContent"
        class="readme-content"
        v-html="renderedReadme"
      />
      <div v-else class="readme-empty">
        <p>No README available</p>
      </div>
    </div>

    <!-- Install Progress Dialog -->
    <InstallProgressDialog
      v-model:open="showProgress"
      :action="progressAction"
      :source="skill.source"
      :skill-id="skill.skillId"
      :skill-name="skill.name"
      @complete="handleInstallComplete"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  Zap, CheckCircle, Download, Trash2, ExternalLink, Loader2
} from 'lucide-vue-next'
import { useSkillsStore, type MarketplaceSkill } from '@/stores/skills'
import { marked } from 'marked'
import InstallProgressDialog from './InstallProgressDialog.vue'

interface Props {
  skill: MarketplaceSkill
}

const props = defineProps<Props>()
const emit = defineEmits<{
  installComplete: []
}>()

const skillsStore = useSkillsStore()

const showProgress = ref(false)
const progressAction = ref<'install' | 'uninstall'>('install')
const readme = ref<string | null>(null)
const readmeLoading = ref(true)

const githubUrl = computed(() => {
  if (props.skill.source.includes('/')) {
    return `https://github.com/${props.skill.source}`
  }
  return null
})

const displayContent = computed(() => {
  if (!readme.value) return null
  return readme.value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
})

const renderedReadme = computed(() => {
  return marked(displayContent.value || '', { gfm: true })
})

async function fetchReadme() {
  readmeLoading.value = true
  readme.value = null
  try {
    const result = await skillsStore.fetchMarketplaceReadme(
      props.skill.source,
      props.skill.skillId
    )
    readme.value = result?.content || null
  } finally {
    readmeLoading.value = false
  }
}

function handleInstall() {
  progressAction.value = 'install'
  showProgress.value = true
}

function handleUninstall() {
  progressAction.value = 'uninstall'
  showProgress.value = true
}

function handleInstallComplete() {
  emit('installComplete')
}

watch(() => props.skill, () => {
  fetchReadme()
}, { immediate: true })
</script>

<style lang="scss" scoped>
.marketplace-skill-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.detail-header {
  flex-shrink: 0;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.header-content {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.skill-icon-wrapper {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--bg-tertiary);
  flex-shrink: 0;
}

.skill-icon {
  color: var(--text-muted);
}

.skill-info {
  flex: 1;
  min-width: 0;
}

.skill-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  flex-shrink: 0;
}

.skill-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.skill-source {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.github-link {
  color: var(--text-muted);
  transition: color 0.15s;
  flex-shrink: 0;

  &:hover {
    color: var(--text-primary);
  }
}

.install-count {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.skill-actions {
  flex-shrink: 0;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }

  &.btn-danger {
    background: #dc3545;
    color: white;

    &:hover {
      background: #c82333;
    }
  }
}

.detail-body {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

.readme-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
}

.spin {
  animation: spin 1s linear infinite;
  color: var(--text-muted);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.readme-content {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);

  :deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
    margin-top: 24px;
    margin-bottom: 12px;
    font-weight: 600;
  }

  :deep(p) {
    margin-bottom: 16px;
  }

  :deep(ul), :deep(ol) {
    margin-bottom: 16px;
    padding-left: 24px;
  }

  :deep(code) {
    padding: 2px 6px;
    background: var(--bg-secondary);
    border-radius: 4px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
  }

  :deep(pre) {
    padding: 16px;
    background: var(--bg-secondary);
    border-radius: 8px;
    overflow: auto;
    margin-bottom: 16px;

    code {
      padding: 0;
      background: transparent;
    }
  }

  :deep(a) {
    color: var(--accent-primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}

.readme-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: var(--text-muted);

  p {
    font-size: 14px;
    margin: 0;
  }
}
</style>
