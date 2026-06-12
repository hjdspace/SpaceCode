<template>
  <div class="no-project-home">
    <div class="welcome-card">
      <div class="card-icon card-icon--folder">
        <Folder :size="22" />
      </div>
      <h3 class="card-title">{{ t('welcomeNoProject.projectChatTitle') }}</h3>
      <p class="card-desc">{{ t('welcomeNoProject.projectChatDesc') }}</p>
      <button type="button" class="primary-btn" @click="onSelectFolder">
        <FolderOpen :size="16" />
        {{ t('welcomeNoProject.selectFolder') }}
      </button>
    </div>

    <p class="hint-text">{{ t('welcomeNoProject.hint') }}</p>

    <div class="recent-section">
      <h4 class="recent-heading">{{ t('welcomeNoProject.recentHeading') }}</h4>
      <div v-if="sortedRecentPaths.length > 0" class="recent-tags" role="list">
        <button
          v-for="path in sortedRecentPaths"
          :key="path"
          type="button"
          class="recent-pill"
          role="listitem"
          :title="path"
          @click="openProjectByPath(path)"
        >
          {{ displayName(path) }}
        </button>
      </div>
      <p v-else class="recent-empty">{{ t('welcomeNoProject.recentEmpty') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Folder, FolderOpen } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import { useOpenProjectWorkflow } from '@/composables/useOpenProjectWorkflow'
import { getRecentProjectRoots, normalizeProjectPathKey } from '@/utils/recentProjectRoots'

const { t } = useI18n()
const chatStore = useChatStore()
const { openProjectFromPicker, openProjectByPath } = useOpenProjectWorkflow()

function displayName(path: string): string {
  const base = path.split(/[/\\]/).filter(Boolean).pop()
  return base || path
}

function maxSessionActivityForPath(path: string): number {
  const relevant = chatStore.sessions.filter((s) => (s.workingDirectory || '') === path)
  if (relevant.length === 0) return 0
  return Math.max(...relevant.map((s) => s.updatedAt || s.createdAt || 0))
}

const sortedRecentPaths = computed(() => {
  const stored = getRecentProjectRoots()
  const fromStore = [...new Set(chatStore.allProjects.filter(Boolean))]
  const seen = new Set<string>()
  const merged: string[] = []

  const pushUnique = (p: string) => {
    const k = normalizeProjectPathKey(p)
    if (!p.trim() || seen.has(k)) return
    seen.add(k)
    merged.push(p)
  }

  stored.forEach(pushUnique)

  const rest = fromStore.filter((p) => !seen.has(normalizeProjectPathKey(p)))
  rest.sort((a, b) => maxSessionActivityForPath(b) - maxSessionActivityForPath(a))
  rest.forEach(pushUnique)

  return merged
})

async function onSelectFolder() {
  await openProjectFromPicker()
}
</script>

<style lang="scss" scoped>
.no-project-home {
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 20px 32px;
  gap: 20px;
}

.welcome-card {
  width: 100%;
  max-width: 420px;
  padding: 22px 22px 20px;
  border: 1px solid var(--border-default, rgba(0, 0, 0, 0.08));
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-secondary, #fafafa);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.card-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md, 8px);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  color: var(--accent-primary, #2563eb);
  background: color-mix(in srgb, var(--accent-primary, #2563eb) 12%, transparent);
}

.card-title {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-desc {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.primary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  border-radius: var(--radius-md, 8px);
  font-size: var(--font-size-base);
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  color: #fff;
  background: var(--accent-primary, #2563eb);
  transition: opacity 0.15s ease, filter 0.15s ease;

  &:hover {
    filter: brightness(1.05);
  }

  &:active {
    opacity: 0.92;
  }
}

.hint-text {
  margin: 0;
  max-width: 480px;
  text-align: center;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}

.recent-section {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.recent-heading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.recent-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.recent-pill {
  padding: 6px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full, 999px);
  background: var(--bg-primary);
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;

  &:hover {
    background: var(--surface-glass-hover, rgba(0, 0, 0, 0.04));
    border-color: var(--accent-primary);
  }
}

.recent-empty {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
}
</style>
