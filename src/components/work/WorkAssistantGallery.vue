<template>
  <div class="work-gallery">
    <div class="gallery-header">
      <div class="header-left">
        <div>
          <h1 class="title">{{ t('work.galleryTitle') }}</h1>
          <p class="subtitle">{{ t('work.galleryDesc') }}</p>
        </div>
      </div>
      <div class="header-right">
        <button class="workspace-chip" :title="appStore.workWorkspace" @click="changeWorkspace">
          <FolderOpen :size="13" />
          <span>{{ workspaceLabel }}</span>
        </button>
        <button class="close-btn" @click="handleClose" :aria-label="t('common.close')">
          <X :size="18" />
        </button>
      </div>
    </div>

    <div class="gallery-toolbar">
      <div class="search-box">
        <Search :size="14" class="search-icon" />
        <input v-model="query" :placeholder="t('work.searchAssistants')" class="search-input" />
      </div>
      <div class="category-filters">
        <button
          v-for="cat in categories"
          :key="cat.id"
          class="cat-btn"
          :class="{ active: activeCategory === cat.id }"
          @click="activeCategory = cat.id"
        >
          {{ cat.label }}
        </button>
      </div>
    </div>

    <div class="gallery-body">
      <div v-if="loading" class="gallery-empty">{{ t('common.loading') }}</div>
      <div v-else-if="filtered.length === 0" class="gallery-empty">
        <Bot :size="32" class="empty-icon" />
        <p>{{ t('work.noAssistants') }}</p>
      </div>
      <div v-else class="assistants-grid">
        <button
          v-for="a in filtered"
          :key="a.name"
          class="assistant-card"
          :disabled="starting"
          @click="handleSelect(a)"
        >
          <div class="card-avatar">{{ a.avatar || '🤖' }}</div>
          <div class="card-body">
            <div class="card-name">{{ displayName(a) }}</div>
            <div class="card-desc">{{ displayDesc(a) }}</div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, Bot, X, FolderOpen } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { useAgentsStore, type AgentDef } from '@/stores/agents'

const { t, locale } = useI18n()
const appStore = useAppStore()
const chatStore = useChatStore()
const agentsStore = useAgentsStore()

const query = ref('')
const activeCategory = ref('all')
const loading = ref(false)
const starting = ref(false)

const workAssistants = computed(() => agentsStore.libraryAgents.filter(a => a.mode === 'work'))

const categories = computed(() => {
  const ids = new Set<string>()
  workAssistants.value.forEach(a => ids.add(a.category || 'general'))
  const labelMap: Record<string, string> = {
    office: t('work.catOffice'),
    research: t('work.catResearch'),
    finance: t('work.catFinance'),
    design: t('work.catDesign'),
    creative: t('work.catCreative'),
    productivity: t('work.catProductivity'),
    general: t('work.catGeneral'),
  }
  return [
    { id: 'all', label: t('work.catAll') },
    ...Array.from(ids).map(id => ({ id, label: labelMap[id] || id })),
  ]
})

const filtered = computed(() => {
  let list = workAssistants.value
  if (activeCategory.value !== 'all') {
    list = list.filter(a => (a.category || 'general') === activeCategory.value)
  }
  const q = query.value.trim().toLowerCase()
  if (q) {
    list = list.filter(a =>
      displayName(a).toLowerCase().includes(q) ||
      displayDesc(a).toLowerCase().includes(q)
    )
  }
  return list
})

const workspaceLabel = computed(() => {
  const p = appStore.workWorkspace
  if (!p) return t('work.chooseFolder')
  return p.split(/[\\/]/).filter(Boolean).pop() || p
})

function isZh() {
  return String(locale.value).toLowerCase().startsWith('zh')
}

function displayName(a: AgentDef): string {
  // id (kebab) → Title Case
  return a.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function displayDesc(a: AgentDef): string {
  return (isZh() && a.descriptionZh) ? a.descriptionZh : a.description
}

async function loadLibrary() {
  loading.value = true
  try {
    await agentsStore.fetchLibrary(appStore.workWorkspace || appStore.projectRoot || undefined)
  } finally {
    loading.value = false
  }
}

async function handleSelect(a: AgentDef) {
  if (!appStore.workWorkspaceConfirmed) {
    appStore.showWorkOnboarding = true
    return
  }
  starting.value = true
  try {
    const session = await chatStore.startWorkAssistantSession({
      name: a.name,
      skills: a.skills,
      permission: a.permission,
    })
    appStore.showWorkGallery = false
    appStore.openSessionTab(session.id, session.title)
  } catch (err) {
    console.error('[WorkGallery] Failed to start assistant session:', err)
  } finally {
    starting.value = false
  }
}

function changeWorkspace() {
  appStore.showWorkOnboarding = true
}

function handleClose() {
  appStore.showWorkGallery = false
}

onMounted(loadLibrary)
</script>

<style lang="scss" scoped>
.work-gallery {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.gallery-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--border-default, var(--surface-border));
  background: var(--bg-secondary, var(--bg-primary));
}

.title { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0; }
.subtitle { font-size: 13px; color: var(--text-muted); margin: 4px 0 0; }

.header-right { display: flex; align-items: center; gap: 8px; }

.workspace-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-family: inherit;
  &:hover { color: var(--accent-primary); border-color: var(--accent-primary); }
}

.close-btn {
  display: flex;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px;
  border-radius: var(--radius-sm);
  &:hover { color: var(--text-primary); background: var(--surface-glass-hover); }
}

.gallery-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 22px;
  flex-wrap: wrap;
}

.search-box { position: relative; min-width: 240px; flex: 0 0 auto; }
.search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }
.search-input {
  width: 100%;
  padding: 8px 10px 8px 32px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary, var(--surface-glass));
  color: var(--text-primary);
  font-size: 13px;
  &:focus { outline: none; border-color: var(--accent-primary); }
}

.category-filters { display: flex; flex-wrap: wrap; gap: 6px; }
.cat-btn {
  padding: 5px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full, 16px);
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition-fast);
  &:hover { color: var(--text-primary); }
  &.active { background: var(--accent-primary); color: #fff; border-color: var(--accent-primary); }
}

.gallery-body { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 22px 22px; }

.assistants-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.assistant-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  text-align: left;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition-fast);
  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
    background: var(--surface-glass-hover);
    transform: translateY(-1px);
  }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
}

.card-avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  border-radius: var(--radius-md);
  background: var(--bg-secondary, var(--bg-primary));
}

.card-body { min-width: 0; }
.card-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.card-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.gallery-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 60px;
  color: var(--text-muted);
  font-size: 13px;
}
.empty-icon { opacity: 0.3; }
</style>
