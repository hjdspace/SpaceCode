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
        <!-- 创建自定义助手入口 -->
        <button
          class="assistant-card create-card"
          @click="showEditor = true"
        >
          <div class="create-plus-circle">
            <Plus :size="18" />
          </div>
          <span class="create-label">{{ t('work.createCustom') }}</span>
          <span class="create-sub">{{ t('work.createCustomSub') }}</span>
        </button>

        <button
          v-for="a in filtered"
          :key="a.name"
          class="assistant-card"
          :style="cardStyle(a)"
          :disabled="starting"
          @click="handleSelect(a)"
        >
          <div class="card-top">
            <div class="card-avatar" :style="workAvatarStyle(a.category)">
              <component :is="workAssistantIcon(a.avatar)" :size="20" />
            </div>
            <div class="card-head">
              <span class="card-name">{{ workDisplayName(a.name) }}</span>
              <span v-if="formatTag(a)" class="card-tag" :class="`tag-${formatTag(a)}`">{{ formatTag(a) }}</span>
            </div>
          </div>
          <div class="card-desc">{{ displayDesc(a) }}</div>
          <div class="card-foot">
            <span class="capability-hint">
              <span class="capability-dots">
                <span
                  v-for="i in 4"
                  :key="i"
                  class="cap-dot"
                  :class="{ muted: i > capabilityDotCount(a) }"
                />
              </span>
              {{ capabilityText(a) }}
            </span>
            <span v-if="displayPrompts(a).length" class="capability-hint prompt-hint">
              <ChevronRight :size="11" />
              {{ t('work.exampleCount', { count: displayPrompts(a).length }) }}
            </span>
          </div>

          <!-- 悬停浮层：渐进式披露 -->
          <div class="hover-card">
            <div class="hover-card-head">
              <span class="hover-card-name">{{ workDisplayName(a.name) }}</span>
              <span v-if="formatTag(a)" class="card-tag" :class="`tag-${formatTag(a)}`">{{ formatTag(a) }}</span>
            </div>
            <div class="hover-card-desc">{{ displayDesc(a) }}</div>
            <div class="hover-section-label">{{ t('work.abilitiesLabel') }}</div>
            <div class="skill-list">
              <div
                v-for="(s, idx) in displaySkillDescs(a)"
                :key="idx"
                class="skill-item"
              >
                <span class="skill-status"></span>
                <span class="skill-item-name">{{ s }}</span>
              </div>
              <div v-if="!displaySkillDescs(a).length" class="skill-item">
                <span class="skill-status"></span>
                <span class="skill-item-desc">{{ t('work.noSkillNeeded') }}</span>
              </div>
            </div>
            <template v-if="displayPrompts(a).length">
              <div class="hover-section-label">{{ t('work.trySaying') }}</div>
              <div class="prompt-list">
                <div
                  v-for="(p, idx) in displayPrompts(a)"
                  :key="idx"
                  class="prompt-item"
                >{{ p }}</div>
              </div>
            </template>
          </div>
        </button>
      </div>
    </div>

    <!-- 自定义助手编辑器弹窗 -->
    <CustomAssistantEditor
      v-if="showEditor"
      @close="showEditor = false"
      @saved="onAssistantSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, Bot, X, FolderOpen, Plus, ChevronRight } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useAgentsStore, type AgentDef } from '@/stores/agents'
import { workAssistantIcon, workAvatarStyle, workDisplayName, workCategoryColor } from '@/utils/workAssistant'
import CustomAssistantEditor from './CustomAssistantEditor.vue'

const { t, locale } = useI18n()
const appStore = useAppStore()
const sessionStore = useChatSessionStore()
const agentsStore = useAgentsStore()

const query = ref('')
const activeCategory = ref('all')
const loading = ref(false)
const starting = ref(false)
const showEditor = ref(false)

const workAssistants = computed(() => agentsStore.libraryAgents.filter(a => a.mode === 'work'))

const categories = computed(() => {
  const ids = new Set<string>()
  workAssistants.value.forEach(a => ids.add(a.category || 'general'))
  const labelMap: Record<string, string> = {
    office: t('work.catOffice'),
    research: t('work.catResearch'),
    finance: t('work.catFinance'),
    investment: t('work.catInvestment'),
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
      workDisplayName(a.name).toLowerCase().includes(q) ||
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

function displayDesc(a: AgentDef): string {
  return (isZh() && a.descriptionZh) ? a.descriptionZh : a.description
}

/** 根据绑定的 skill 推断输出格式标签；无明确格式的助手返回空串 */
function formatTag(a: AgentDef): string {
  const skills = a.skills || []
  if (skills.includes('html-ppt') || skills.includes('guizang-ppt-skill')) return 'HTML'
  if (skills.includes('pptx')) return 'PPTX'
  if (skills.includes('docx')) return 'DOCX'
  if (skills.includes('xlsx')) return 'XLSX'
  if (skills.includes('pdf')) return 'PDF'
  return ''
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
    const session = await sessionStore.startWorkAssistantSession({
      name: a.name,
      skills: a.skills,
      permission: a.permission,
      skillRuntime: a.skillRuntime,
      skillsRequired: a.skillsRequired,
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

async function onAssistantSaved(_name: string) {
  showEditor.value = false
  await loadLibrary()
}

/** 卡片内联样式：设置分类色 CSS 变量 --cat */
function cardStyle(a: AgentDef): Record<string, string> {
  return { '--cat': workCategoryColor(a.category) }
}

/** 能力指示点数量（最多 4 个） */
function capabilityDotCount(a: AgentDef): number {
  return Math.min((a.skills?.length || 0), 4)
}

/** 底部能力文字 */
function capabilityText(a: AgentDef): string {
  const count = a.skills?.length || 0
  return count > 0 ? t('work.capabilities', { count }) : t('work.generalChat')
}

/** 本地化的推荐提示词 */
function displayPrompts(a: AgentDef): string[] {
  if (isZh() && a.recommendedPromptsZh?.length) return a.recommendedPromptsZh
  return a.recommendedPrompts || []
}

/** 人可读的技能描述列表 */
function displaySkillDescs(a: AgentDef): string[] {
  return a.skillDescriptions || []
}

onMounted(async () => {
  await loadLibrary()
})
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

/* ===== 助手卡片：垂直布局 + 顶部色条 ===== */
.assistant-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 16px;
  text-align: left;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  font-family: inherit;
  min-height: 132px;
  transition: border-color var(--transition-normal), box-shadow var(--transition-normal), transform var(--transition-normal);

  /* 顶部 3px 分类色条 */
  &::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: var(--cat, var(--accent-primary));
    opacity: 0.7;
    transition: opacity var(--transition-fast);
    border-top-left-radius: var(--radius-lg);
    border-top-right-radius: var(--radius-lg);
  }

  &:hover:not(:disabled) {
    z-index: 20;
    border-color: color-mix(in srgb, var(--cat, var(--accent-primary)) 40%, var(--surface-border));
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
    &::before { opacity: 1; }
    .card-avatar { transform: scale(1.05); }
    .hover-card { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
  }
  &:disabled { opacity: 0.6; cursor: not-allowed; }
}

.card-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.card-avatar {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  transition: transform var(--transition-fast);
}

.card-head {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-tag {
  flex-shrink: 0;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  border-radius: var(--radius-sm, 4px);
  font-family: var(--font-mono, monospace);
  border: 1px solid transparent;
}
.tag-HTML { color: #e34c26; background: rgba(227, 76, 38, 0.12); border-color: rgba(227, 76, 38, 0.3); }
.tag-PPTX { color: #d35400; background: rgba(211, 84, 0, 0.12); border-color: rgba(211, 84, 0, 0.3); }
.tag-DOCX { color: #2b579a; background: rgba(43, 87, 154, 0.12); border-color: rgba(43, 87, 154, 0.3); }
.tag-XLSX { color: #217346; background: rgba(33, 115, 70, 0.12); border-color: rgba(33, 115, 70, 0.3); }
.tag-PDF  { color: #c0392b; background: rgba(192, 57, 43, 0.12); border-color: rgba(192, 57, 43, 0.3); }

.card-desc {
  font-size: 12.5px;
  color: var(--text-muted);
  margin-top: 10px;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 底部能力指示 */
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 10px;
  gap: 8px;
}
.capability-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-disabled);
  font-weight: 500;
}
.capability-dots {
  display: inline-flex;
  gap: 3px;
}
.cap-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--cat, var(--accent-primary)) 50%, transparent);
  &.muted { background: var(--surface-border-strong); }
}
.prompt-hint { gap: 4px; }

/* ===== 悬停浮层：渐进式披露 ===== */
.hover-card {
  position: absolute;
  left: 0; right: 0; top: 0;
  z-index: 10;
  background: var(--bg-elevated);
  border: 1px solid color-mix(in srgb, var(--cat, var(--accent-primary)) 30%, var(--surface-border));
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  padding: 16px;
  opacity: 0;
  transform: translateY(4px) scale(0.98);
  pointer-events: none;
  transition: opacity var(--transition-fast), transform var(--transition-fast);
  max-height: 360px;
  overflow-y: auto;
}
.hover-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.hover-card-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hover-card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.55;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--surface-border);
}
.hover-section-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-disabled);
  margin: 10px 0 6px;
}
.skill-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.skill-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  line-height: 1.4;
}
.skill-item-name {
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}
.skill-item-desc {
  color: var(--text-muted);
}
.skill-status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #22c55e;
}
.prompt-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.prompt-item {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.4;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-glass);
  border-left: 2px solid var(--cat, var(--accent-primary));
  transition: background var(--transition-fast);
  &::before {
    content: '›';
    color: var(--cat, var(--accent-primary));
    font-weight: 700;
    margin-right: 5px;
  }
}

/* ===== 创建卡片 ===== */
.create-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 132px;
  background: transparent;
  border: 1.5px dashed var(--surface-border-strong);
  border-radius: var(--radius-lg);
  cursor: pointer;
  font-family: inherit;
  color: var(--text-muted);
  transition: all var(--transition-fast);
  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    background: var(--accent-primary-glow);
  }
}
.create-plus-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
}
.create-label {
  font-size: 13px;
  font-weight: 600;
}
.create-sub {
  font-size: 11px;
  color: var(--text-disabled);
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
