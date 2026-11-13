<template>
  <div class="settings-section s-page-shell archive-settings">
    <!-- Masthead -->
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">Settings</div>
      <h1 class="s-masthead-title">{{ t('archive.title') }}</h1>
      <p class="s-masthead-desc">{{ t('archive.desc') }}</p>
    </div>

    <!-- Toolbar: count chip + bulk delete -->
    <div class="archive-toolbar">
      <span class="archive-chip" data-testid="archive-count">
        <Archive :size="14" />
        {{ t('archive.sessionsTab') }}
        <em>{{ archivedSessions.length }}</em>
      </span>
      <button
        class="archive-delete-all"
        data-testid="archive-delete-all"
        :disabled="visibleSessions.length === 0 || busy"
        @click="handleDeleteAll"
      >
        <Trash2 :size="14" />
        {{ t('archive.deleteAll') }}
      </button>
    </div>

    <!-- Filters -->
    <div class="archive-filters">
      <div class="archive-search">
        <Search :size="14" class="archive-search-icon" />
        <input
          v-model="query"
          type="text"
          class="archive-search-input"
          data-testid="archive-search"
          :placeholder="t('archive.searchPlaceholder')"
          :aria-label="t('archive.searchPlaceholder')"
        />
        <button
          v-if="query"
          class="archive-search-clear"
          :aria-label="t('common.cancel')"
          @click="query = ''"
        >
          <X :size="12" />
        </button>
      </div>
      <select
        v-model="projectFilter"
        class="s-form-select archive-project-select"
        data-testid="archive-project-filter"
        :aria-label="t('archive.allProjects')"
      >
        <option :value="ALL_PROJECTS">{{ t('archive.allProjects') }}</option>
        <option v-for="option in projectOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>

    <!-- Empty / no-match -->
    <div v-if="archivedSessions.length === 0" class="archive-empty" data-testid="archive-empty">
      <Archive :size="26" />
      <p>{{ t('archive.empty') }}</p>
    </div>
    <div v-else-if="groups.length === 0" class="archive-empty" data-testid="archive-no-match">
      <Search :size="26" />
      <p>{{ t('archive.noMatch') }}</p>
    </div>

    <!-- Grouped list -->
    <div v-else class="archive-groups">
      <section v-for="group in groups" :key="group.workingDirectory || '__unassigned'" class="archive-group">
        <header class="archive-group-header">
          <FolderOpen :size="14" />
          <span class="archive-group-name" :title="group.workingDirectory">
            {{ group.displayName || t('archive.unassignedProject') }}
          </span>
          <span class="archive-group-count">{{ t('archive.sessionCount', { count: group.sessions.length }) }}</span>
        </header>

        <ul class="archive-rows">
          <li v-for="session in group.sessions" :key="session.id" class="archive-row" data-testid="archive-row">
            <div class="archive-row-main">
              <span class="archive-row-title">{{ session.title }}</span>
              <span class="archive-row-time">{{ formatArchivedAt(session) }}</span>
            </div>
            <div class="archive-row-actions">
              <button
                class="archive-icon-btn"
                data-testid="archive-row-delete"
                :disabled="busy"
                :title="t('archive.delete')"
                :aria-label="t('archive.delete')"
                @click="handleDelete(session)"
              >
                <Trash2 :size="15" />
              </button>
              <button
                class="archive-restore-btn"
                data-testid="archive-row-restore"
                :disabled="busy"
                @click="handleUnarchive(session)"
              >
                <ArchiveRestore :size="14" />
                {{ t('archive.unarchive') }}
              </button>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Archive, ArchiveRestore, FolderOpen, Search, Trash2, X } from 'lucide-vue-next'
import type { Session } from '@/types'
import { useChatSessionStore } from '@/stores/chatSession'
import { useDialog } from '@/composables/useDialog'
import {
  filterArchivedSessions,
  getArchivedAt,
  groupArchivedSessionsByProject,
} from '@/utils/sessionArchive'
import { normalizeAbsolutePath } from '@/utils/normalizePath'

const ALL_PROJECTS = '__all__'

const { t, locale } = useI18n()
const sessionStore = useChatSessionStore()
const { showAlert, showConfirm } = useDialog()

const query = ref('')
const projectFilter = ref<string>(ALL_PROJECTS)
const busy = ref(false)

const archivedSessions = computed(() => sessionStore.archivedSessions)

const visibleSessions = computed(() =>
  filterArchivedSessions(archivedSessions.value, {
    query: query.value,
    project: projectFilter.value === ALL_PROJECTS ? undefined : projectFilter.value,
  })
)

const groups = computed(() => groupArchivedSessionsByProject(visibleSessions.value))

/** 下拉选项取自全部归档会话，不跟着搜索收窄 —— 否则搜完就切不回别的项目。 */
const projectOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const session of archivedSessions.value) {
    const dir = normalizeAbsolutePath(session.workingDirectory || '')
    if (seen.has(dir)) continue
    seen.set(dir, dir.split(/[\\/]/).filter(Boolean).pop() || t('archive.unassignedProject'))
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

function formatArchivedAt(session: Session): string {
  const at = getArchivedAt(session)
  if (!at) return ''
  return new Date(at).toLocaleString(locale.value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function handleUnarchive(session: Session) {
  sessionStore.unarchiveSession(session.id)
}

async function handleDelete(session: Session) {
  const confirmed = await showConfirm(
    t('archive.confirmDelete', { title: session.title }),
    { title: t('archive.confirmDeleteTitle'), variant: 'danger' },
  )
  if (!confirmed) return
  await deleteSessions([session.id])
}

/** 「全部删除」只作用于当前筛选结果：搜索框里挂着条件时删掉全部归档会误伤。 */
async function handleDeleteAll() {
  const ids = visibleSessions.value.map(session => session.id)
  if (ids.length === 0) return
  const confirmed = await showConfirm(
    t('archive.confirmDeleteAll', { count: ids.length }),
    { title: t('archive.confirmDeleteAllTitle'), variant: 'danger' },
  )
  if (!confirmed) return
  await deleteSessions(ids)
}

async function deleteSessions(ids: string[]) {
  busy.value = true
  try {
    for (const id of ids) {
      await sessionStore.deleteSession(id)
    }
  } catch (error) {
    console.error('[ArchiveSettings] Failed to delete archived sessions:', error)
    await showAlert(t('archive.deleteFailed'))
  } finally {
    busy.value = false
  }
}
</script>

<style lang="scss" scoped>
.archive-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.archive-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 1.5px solid var(--border-default);
  border-radius: var(--radius-sm);

  em {
    font-style: normal;
    font-variant-numeric: tabular-nums;
    color: var(--accent-primary);
  }
}

.archive-delete-all {
  @include reset-button;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--error);
  background: color-mix(in srgb, var(--error) 10%, transparent);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--error) 18%, transparent);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.archive-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.archive-search {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.archive-search-icon {
  position: absolute;
  left: 13px;
  color: var(--text-muted);
  pointer-events: none;
}

.archive-search-input {
  width: 100%;
  padding: 11px 34px 11px 36px;
  font-size: var(--text-base);
  font-family: var(--font-body);
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 1.5px solid var(--border-default);
  border-radius: var(--radius-sm);
  outline: none;
  transition: all var(--transition-fast);

  &::placeholder {
    color: var(--text-muted);
  }

  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }
}

.archive-search-clear {
  @include reset-button;
  position: absolute;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--text-muted);
  border-radius: var(--radius-full);
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }
}

.archive-project-select {
  width: 190px;
  flex-shrink: 0;
}

.archive-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 56px 24px;
  text-align: center;
  color: var(--text-muted);
  background: var(--bg-elevated);
  border: 1.5px dashed var(--border-default);
  border-radius: var(--radius-md);

  p {
    margin: 0;
    max-width: 420px;
    font-size: 13.5px;
    line-height: 1.7;
  }
}

.archive-groups {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.archive-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--text-secondary);
}

.archive-group-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-group-count {
  flex-shrink: 0;
  font-size: 12.5px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.archive-rows {
  margin: 0;
  padding: 0;
  list-style: none;
  background: var(--bg-elevated);
  border: 1.5px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.archive-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px dashed var(--border-subtle);
  transition: background var(--transition-fast);

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--surface-soft);
  }
}

.archive-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.archive-row-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-row-time {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.archive-row-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.archive-icon-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 12%, transparent);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.archive-restore-btn {
  @include reset-button;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-secondary);
  border: 1.5px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    background: var(--bg-tertiary);
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

@media (max-width: 720px) {
  .archive-filters {
    flex-direction: column;
    align-items: stretch;
  }

  .archive-project-select {
    width: 100%;
  }

  .archive-row {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .archive-row-actions {
    justify-content: flex-end;
  }
}
</style>