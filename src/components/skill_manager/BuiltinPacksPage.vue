<script setup lang="ts">
/**
 * Skill Manager V2 — Built-in Skill Packs Page
 *
 * 展示内置技能包（resources/skills-lib 下 skills/<category>/<skill> 两层结构的目录，
 * 如 matt-skills）。点击技能包弹出二级窗口，按分类多选技能后一键批量安装。
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Check,
  CheckSquare,
  Download,
  FolderOpen,
  Loader2,
  Minus,
  PackageOpen,
  RefreshCw,
  X,
} from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useAppStore } from '@/stores/app'
import { getSkillGlyph, packCategoryKey } from './skillLabels'

const { t, te } = useI18n()
const appStore = useAppStore()

// ── Types (mirrors electron/skills/skillsService.ts) ──────────────

interface PackCategory {
  name: string
  skillCount: number
}

interface SkillPack {
  id: string
  name: string
  description?: string
  category?: string
  packDir: string
  categories: PackCategory[]
  skillCount: number
  installedCount: number
}

interface PackSkill {
  name: string
  description: string
  category: string
  skillPath: string
  isInstalled: boolean
  packId?: string
  packName?: string
  packCategory?: string
}

type InstallStatus = 'idle' | 'success' | 'failed' | 'skipped'

// ── State ─────────────────────────────────────────────────────────

const packs = ref<SkillPack[]>([])
const packSkills = ref<PackSkill[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const activePack = ref<SkillPack | null>(null)
const selectedKeys = ref<Set<string>>(new Set())
const scope = ref<'global' | 'project'>('global')
const installing = ref(false)
const installResults = ref<Map<string, InstallStatus>>(new Map())
const resultNotice = ref<string | null>(null)

const hasProject = computed(() => Boolean(appStore.projectRoot))

/** 包级分类的本地化标签，未知分类回退显示原始 id，无分类返回 null。 */
function packCategoryLabel(category?: string): string | null {
  const key = packCategoryKey(category)
  if (!key || !category) return null
  return te(key) ? t(key) : category
}

// ── Data loading ──────────────────────────────────────────────────

async function loadPacks(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const cwd = appStore.projectRoot || undefined
    const data = await api.skills.scanLocalLibrary(['resources/skills-lib'], cwd)
    packs.value = data.packs || []
    packSkills.value = (data.skills || []).filter((s: PackSkill) => s.packId)
  } catch (err) {
    console.error('[BuiltinPacks] Failed to scan packs:', err)
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

onMounted(loadPacks)

// ── Modal & selection ─────────────────────────────────────────────

function openPack(pack: SkillPack): void {
  activePack.value = pack
  selectedKeys.value = new Set()
  installResults.value = new Map()
  resultNotice.value = null
}

function closePack(): void {
  activePack.value = null
  selectedKeys.value = new Set()
  installResults.value = new Map()
  resultNotice.value = null
}

const activePackSkills = computed(() =>
  packSkills.value.filter((s) => s.packId === activePack.value?.id)
)

const groupedSkills = computed(() => {
  const groups: Array<{ name: string; skills: PackSkill[] }> = []
  const index = new Map<string, PackSkill[]>()
  // flat 布局的技能包没有分类，统一落入单个平铺分组
  const fallbackKey = activePack.value && activePack.value.categories.length === 0
    ? t('skillManagerV2.builtinPacks.noCategory')
    : 'misc'
  for (const skill of activePackSkills.value) {
    const key = skill.packCategory || fallbackKey
    if (!index.has(key)) {
      const group = { name: key, skills: [] }
      index.set(key, group.skills)
      groups.push(group)
    }
    index.get(key)!.push(skill)
  }
  return groups
})

function skillKey(skill: PackSkill): string {
  return skill.skillPath
}

function isSelectable(skill: PackSkill): boolean {
  return !skill.isInstalled && installResults.value.get(skillKey(skill)) !== 'success'
}

function toggleSkill(skill: PackSkill): void {
  const key = skillKey(skill)
  if (!isSelectable(skill)) return
  const next = new Set(selectedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = next
}

function categoryState(group: { name: string; skills: PackSkill[] }): 'none' | 'all' | 'some' {
  const selectable = group.skills.filter(isSelectable)
  if (selectable.length === 0) return 'none'
  const selected = selectable.filter((s) => selectedKeys.value.has(skillKey(s)))
  if (selected.length === 0) return 'none'
  return selected.length === selectable.length ? 'all' : 'some'
}

function toggleCategory(group: { name: string; skills: PackSkill[] }): void {
  const state = categoryState(group)
  const next = new Set(selectedKeys.value)
  for (const skill of group.skills.filter(isSelectable)) {
    const key = skillKey(skill)
    if (state === 'all') next.delete(key)
    else next.add(key)
  }
  selectedKeys.value = next
}

function selectAll(): void {
  const next = new Set<string>()
  for (const skill of activePackSkills.value.filter(isSelectable)) {
    next.add(skillKey(skill))
  }
  selectedKeys.value = next
}

function clearAll(): void {
  selectedKeys.value = new Set()
}

const selectedCount = computed(() => selectedKeys.value.size)

// ── Install ───────────────────────────────────────────────────────

async function installSelected(): Promise<void> {
  if (!activePack.value || selectedCount.value === 0 || installing.value) return
  installing.value = true
  resultNotice.value = null
  try {
    const cwd = appStore.projectRoot || undefined
    const items = activePackSkills.value
      .filter((s) => selectedKeys.value.has(skillKey(s)))
      .map((s) => ({ name: s.name, skillPath: s.skillPath }))
    const { results } = await api.skills.installLocalSkillsBatch(items, scope.value, cwd)

    const nextResults = new Map(installResults.value)
    const keyByName = new Map(items.map((item) => [item.name, item.skillPath]))
    let succeeded = 0
    let failed = 0
    for (const result of results) {
      if (result.success) {
        nextResults.set(joinKey(activePack.value.id, result.name), 'success')
        succeeded += 1
      } else if (result.error?.includes('already installed')) {
        nextResults.set(joinKey(activePack.value.id, result.name), 'skipped')
        failed += 1
      } else {
        nextResults.set(joinKey(activePack.value.id, result.name), 'failed')
        failed += 1
      }
    }
    installResults.value = nextResults

    resultNotice.value =
      failed === 0
        ? t('skillManagerV2.builtinPacks.resultSuccess', { count: succeeded })
        : t('skillManagerV2.builtinPacks.resultPartial', { success: succeeded, failed })

    // 成功的从选中集合移除
    const next = new Set(selectedKeys.value)
    for (const result of results) {
      if (result.success) {
        const selectKey = keyByName.get(result.name)
        if (selectKey) next.delete(selectKey)
      }
    }
    selectedKeys.value = next

    await loadPacks()
    // 重开当前 pack 的数据保持弹窗内容最新
    const refreshed = packs.value.find((p) => p.id === activePack.value?.id)
    if (refreshed) activePack.value = refreshed
  } catch (err) {
    console.error('[BuiltinPacks] Batch install failed:', err)
    resultNotice.value = err instanceof Error ? err.message : String(err)
  } finally {
    installing.value = false
  }
}

/** install results 以 packId + name 为键（skillPath 含反斜杠序列化无碍,但统一用 name 更稳） */
function joinKey(packId: string, name: string): string {
  return `${packId}::${name}`
}

function resultStatusOf(skill: PackSkill): InstallStatus {
  if (!activePack.value) return 'idle'
  return installResults.value.get(joinKey(activePack.value.id, skill.name)) || 'idle'
}
</script>

<template>
  <div class="sbp-page">
    <!-- Header -->
    <div class="sbp-head">
      <div>
        <p class="sbp-eyebrow">{{ t('skillManagerV2.tabs.builtinPacks') }}</p>
        <h2>{{ t('skillManagerV2.viewTitle.builtinPacks') }}</h2>
        <p class="sbp-desc">{{ t('skillManagerV2.viewSubtitle.builtinPacks') }}</p>
      </div>
      <button class="sbp-btn" type="button" :disabled="loading" @click="loadPacks">
        <RefreshCw :size="15" :class="{ spin: loading }" />{{ t('skillManagerV2.builtinPacks.refresh') }}
      </button>
    </div>

    <!-- Error -->
    <div v-if="error" class="sbp-error">{{ error }}</div>

    <!-- Loading skeleton -->
    <div v-if="loading && packs.length === 0" class="sbp-grid">
      <span v-for="index in 3" :key="index" class="sbp-skeleton" />
    </div>

    <!-- Empty -->
    <div v-else-if="packs.length === 0" class="sbp-empty">
      <PackageOpen :size="34" />
      <p class="sbp-empty-title">{{ t('skillManagerV2.builtinPacks.empty') }}</p>
      <p class="sbp-empty-desc">{{ t('skillManagerV2.builtinPacks.emptyDesc') }}</p>
    </div>

    <!-- Pack cards -->
    <div v-else class="sbp-grid">
      <article
        v-for="pack in packs"
        :key="pack.id"
        class="sbp-card"
        tabindex="0"
        @click="openPack(pack)"
        @keydown.enter="openPack(pack)"
      >
        <div class="sbp-card-head">
          <span class="sbp-card-glyph"><PackageOpen :size="20" /></span>
          <div class="sbp-card-info">
            <h3>{{ pack.name }}</h3>
            <p class="sbp-card-meta">
              <span>{{ t('skillManagerV2.builtinPacks.skills', { count: pack.skillCount }) }}</span>
              <i />
              <span>{{ t('skillManagerV2.builtinPacks.categories', { count: pack.categories.length }) }}</span>
            </p>
          </div>
        </div>
        <div class="sbp-card-cats">
          <span v-if="packCategoryLabel(pack.category)" class="sbp-cat-chip primary">
            {{ packCategoryLabel(pack.category) }}
          </span>
          <span v-for="cat in pack.categories" :key="cat.name" class="sbp-cat-chip">
            {{ cat.name }} · {{ cat.skillCount }}
          </span>
        </div>
        <div class="sbp-card-foot">
          <span
            class="sbp-progress"
            :class="{ done: pack.installedCount >= pack.skillCount }"
          >
            <template v-if="pack.installedCount >= pack.skillCount">
              <Check :size="12" />{{ t('skillManagerV2.builtinPacks.allInstalled') }}
            </template>
            <template v-else>
              {{ t('skillManagerV2.builtinPacks.installedOf', { installed: pack.installedCount, total: pack.skillCount }) }}
            </template>
          </span>
          <span class="sbp-card-action">
            {{ t('skillManagerV2.builtinPacks.viewSkills') }}
            <FolderOpen :size="13" />
          </span>
        </div>
      </article>
    </div>

    <!-- ── Secondary modal: pack skill picker ──────────────────── -->
    <Teleport to="body">
      <div v-if="activePack" class="sbp-overlay" @click.self="closePack">
        <div class="sbp-modal" role="dialog" aria-modal="true">
          <!-- Modal header -->
          <header class="sbp-modal-head">
            <span class="sbp-modal-glyph"><PackageOpen :size="18" /></span>
            <div class="sbp-modal-title">
              <h3>{{ activePack.name }}</h3>
              <p>
                <template v-if="packCategoryLabel(activePack.category)">
                  {{ packCategoryLabel(activePack.category) }} ·
                </template>
                {{ t('skillManagerV2.builtinPacks.skills', { count: activePack.skillCount }) }}
                · {{ t('skillManagerV2.builtinPacks.categories', { count: activePack.categories.length }) }}
              </p>
            </div>
            <div class="sbp-modal-head-actions">
              <button class="sbp-btn sm" type="button" @click="selectAll">
                <CheckSquare :size="13" />{{ t('skillManagerV2.builtinPacks.selectAll') }}
              </button>
              <button class="sbp-btn sm" type="button" @click="clearAll">
                {{ t('skillManagerV2.builtinPacks.clearAll') }}
              </button>
              <button class="sbp-icon-btn" type="button" :title="t('skillManagerV2.builtinPacks.close')" @click="closePack">
                <X :size="17" />
              </button>
            </div>
          </header>

          <!-- Install result notice -->
          <div v-if="resultNotice" class="sbp-notice">
            <Check :size="14" />
            <span>{{ resultNotice }}</span>
          </div>

          <!-- Skill list grouped by category -->
          <div class="sbp-modal-body">
            <section v-for="group in groupedSkills" :key="group.name" class="sbp-group">
              <button class="sbp-group-head" type="button" @click="toggleCategory(group)">
                <span class="sbp-check" :class="categoryState(group)">
                  <Check v-if="categoryState(group) === 'all'" :size="12" />
                  <Minus v-else-if="categoryState(group) === 'some'" :size="12" />
                </span>
                <strong>{{ group.name }}</strong>
                <span class="sbp-group-count">{{ group.skills.length }}</span>
              </button>
              <div class="sbp-group-list">
                <div
                  v-for="skill in group.skills"
                  :key="skill.skillPath"
                  class="sbp-skill-row"
                  :class="{
                    selected: selectedKeys.has(skillKey(skill)),
                    disabled: !isSelectable(skill),
                  }"
                  role="checkbox"
                  :aria-checked="selectedKeys.has(skillKey(skill))"
                  :tabindex="isSelectable(skill) ? 0 : -1"
                  @click="toggleSkill(skill)"
                  @keydown.enter.prevent="toggleSkill(skill)"
                  @keydown.space.prevent="toggleSkill(skill)"
                >
                  <span class="sbp-check" :class="{ checked: selectedKeys.has(skillKey(skill)) }">
                    <Check v-if="selectedKeys.has(skillKey(skill))" :size="12" />
                  </span>
                  <span class="sbp-skill-glyph">{{ getSkillGlyph(skill.name) }}</span>
                  <div class="sbp-skill-info">
                    <strong>{{ skill.name }}</strong>
                    <p>{{ skill.description }}</p>
                  </div>
                  <span v-if="resultStatusOf(skill) === 'success'" class="sbp-status ok">
                    <Check :size="11" />{{ t('skillManagerV2.builtinPacks.installed') }}
                  </span>
                  <span v-else-if="resultStatusOf(skill) === 'failed'" class="sbp-status bad">
                    {{ t('skillManagerV2.builtinPacks.installFailed') }}
                  </span>
                  <span v-else-if="resultStatusOf(skill) === 'skipped'" class="sbp-status warn">
                    {{ t('skillManagerV2.builtinPacks.alreadyInstalled') }}
                  </span>
                  <span v-else-if="skill.isInstalled" class="sbp-status ok">
                    <Check :size="11" />{{ t('skillManagerV2.builtinPacks.installed') }}
                  </span>
                </div>
              </div>
            </section>
          </div>

          <!-- Modal footer: scope + install -->
          <footer class="sbp-modal-foot">
            <div class="sbp-scope">
              <span class="sbp-scope-label">{{ t('skillManagerV2.builtinPacks.scopeLabel') }}</span>
              <button
                type="button"
                class="sbp-scope-opt"
                :class="{ active: scope === 'global' }"
                @click="scope = 'global'"
              >
                <strong>{{ t('skillManagerV2.builtinPacks.scopeGlobal') }}</strong>
                <small>{{ t('skillManagerV2.builtinPacks.scopeGlobalHint') }}</small>
              </button>
              <button
                type="button"
                class="sbp-scope-opt"
                :class="{ active: scope === 'project', disabled: !hasProject }"
                :disabled="!hasProject"
                :title="hasProject ? undefined : appStore.projectRoot"
                @click="scope = 'project'"
              >
                <strong>{{ t('skillManagerV2.builtinPacks.scopeProject') }}</strong>
                <small>{{ hasProject ? t('skillManagerV2.builtinPacks.scopeProjectHint') : appStore.projectRoot }}</small>
              </button>
            </div>
            <div class="sbp-foot-actions">
              <span class="sbp-selected-count">
                {{ t('skillManagerV2.builtinPacks.selected', { count: selectedCount }) }}
              </span>
              <button
                class="sbp-btn primary"
                type="button"
                :disabled="installing || selectedCount === 0"
                @click="installSelected"
              >
                <Loader2 v-if="installing" :size="15" class="spin" />
                <Download v-else :size="15" />
                {{ installing ? t('skillManagerV2.builtinPacks.installing') : t('skillManagerV2.builtinPacks.install') }}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.sbp-page {
  height: 100%;
  overflow-y: auto;
  padding: 24px 28px 40px;
  color: var(--text-primary);
}

.sbp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 25px;
    line-height: 1.1;
    letter-spacing: -0.02em;
  }
}

.sbp-eyebrow {
  margin: 0 0 5px;
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sbp-desc {
  margin: 7px 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

// ── Buttons ───────────────────────────────────────────────────────

.sbp-btn {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 13px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s;

  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }

  &.primary {
    border-color: transparent;
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
    box-shadow: 0 8px 18px color-mix(in srgb, var(--accent-primary) 22%, transparent);

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover, var(--accent-primary));
    }
  }

  &.sm {
    min-height: 28px;
    padding: 0 10px;
    font-size: 11px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
}

.sbp-icon-btn {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
}

.spin {
  animation: sbp-spin 0.9s linear infinite;
}

@keyframes sbp-spin {
  to {
    transform: rotate(360deg);
  }
}

// ── States ────────────────────────────────────────────────────────

.sbp-error {
  margin-bottom: 14px;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--error) 24%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--error) 8%, transparent);
  color: var(--error);
  font-size: 12px;
}

.sbp-empty {
  display: grid;
  place-items: center;
  min-height: 260px;
  color: var(--text-muted);
  text-align: center;
}

.sbp-empty-title {
  margin: 10px 0 0;
  font-size: 15px;
  font-weight: 700;
}

.sbp-empty-desc {
  margin: 5px 0 0;
  font-size: 12px;
}

.sbp-skeleton {
  height: 168px;
  border: 1px solid var(--border-default);
  border-radius: 12px;
  background: linear-gradient(90deg, var(--bg-elevated) 25%, var(--bg-hover) 50%, var(--bg-elevated) 75%);
  background-size: 200% 100%;
  animation: sbp-skeleton 1.3s ease-in-out infinite;
}

@keyframes sbp-skeleton {
  to {
    background-position: -200% 0;
  }
}

// ── Pack cards ────────────────────────────────────────────────────

.sbp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.sbp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: 12px;
  background: var(--bg-elevated);
  cursor: pointer;
  transition: transform 0.18s, border-color 0.18s, box-shadow 0.18s;

  &:hover,
  &:focus-visible {
    border-color: color-mix(in srgb, var(--accent-primary) 48%, var(--border-default));
    box-shadow: 0 12px 28px color-mix(in srgb, var(--accent-primary) 12%, transparent);
    outline: none;
    transform: translateY(-2px);
  }
}

.sbp-card-head {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.sbp-card-glyph {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: color-mix(in srgb, var(--accent-primary) 12%, var(--surface-card, var(--bg-secondary)));
  color: var(--accent-primary);
}

.sbp-card-info {
  min-width: 0;

  h3 {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 750;
  }
}

.sbp-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 11px;

  i {
    width: 1px;
    height: 10px;
    background: var(--border-default);
  }
}

.sbp-card-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.sbp-cat-chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;

  &.primary {
    background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
    color: var(--accent-primary);
    font-weight: 700;
  }
}

.sbp-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
}

.sbp-progress {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;

  &.done {
    color: var(--success);
  }
}

.sbp-card-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 700;
}

// ── Modal ─────────────────────────────────────────────────────────

.sbp-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.sbp-modal {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: min(82vh, 860px);
  border: 1px solid var(--border-default);
  border-radius: 14px;
  background: var(--bg-primary);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.sbp-modal-head {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-default);
  background: var(--surface-soft);
  flex-shrink: 0;
}

.sbp-modal-glyph {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent-primary) 12%, var(--surface-card, var(--bg-secondary)));
  color: var(--accent-primary);
}

.sbp-modal-title {
  min-width: 0;

  h3 {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 16px;
    font-weight: 750;
  }

  p {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 11px;
  }
}

.sbp-modal-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sbp-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 16px 0;
  padding: 8px 12px;
  border: 1px solid color-mix(in srgb, var(--success) 24%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--success) 8%, transparent);
  color: var(--success);
  font-size: 12px;
  flex-shrink: 0;
}

.sbp-modal-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
}

// ── Category groups ───────────────────────────────────────────────

.sbp-group {
  margin-bottom: 14px;

  &:last-child {
    margin-bottom: 0;
  }
}

.sbp-group-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
  }

  strong {
    font-size: 13px;
    font-weight: 750;
    text-transform: capitalize;
  }
}

.sbp-group-count {
  min-width: 20px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-soft);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
}

// ── Skill rows ────────────────────────────────────────────────────

.sbp-group-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.sbp-skill-row {
  display: grid;
  grid-template-columns: 18px 30px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;

  &:hover:not(.disabled),
  &:focus-visible:not(.disabled) {
    border-color: color-mix(in srgb, var(--accent-primary) 48%, var(--border-default));
    background: var(--bg-hover);
    outline: none;
  }

  &.selected {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 7%, var(--bg-elevated));
  }

  &.disabled {
    cursor: default;
    opacity: 0.72;
  }
}

.sbp-check {
  width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--border-strong, var(--border-default));
  border-radius: 5px;
  background: var(--bg-elevated);
  color: transparent;
  flex-shrink: 0;

  &.checked {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
  }

  &.all {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: var(--text-on-accent, #fff);
  }

  &.some {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
    background: var(--bg-elevated);
  }
}

.sbp-skill-glyph {
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--text-primary);
  color: var(--bg-primary);
  font-size: 11px;
  font-weight: 800;
  flex-shrink: 0;
}

.sbp-skill-info {
  min-width: 0;

  strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 650;
  }

  p {
    display: -webkit-box;
    margin: 2px 0 0;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1.45;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
  }
}

.sbp-status {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;

  &.ok {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 12%, transparent);
  }

  &.warn {
    color: var(--warning);
    background: color-mix(in srgb, var(--warning) 12%, transparent);
  }

  &.bad {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 12%, transparent);
  }
}

// ── Footer ────────────────────────────────────────────────────────

.sbp-modal-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--border-default);
  background: var(--surface-soft);
  flex-shrink: 0;
}

.sbp-scope {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sbp-scope-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.sbp-scope-opt {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;

  strong {
    font-size: 12px;
    font-weight: 700;
  }

  small {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: 10px;
  }

  &:hover:not(.disabled) {
    border-color: var(--border-strong, var(--border-default));
  }

  &.active {
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-elevated));

    strong {
      color: var(--accent-primary);
    }
  }

  &.disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
}

.sbp-foot-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.sbp-selected-count {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

// ── Responsive ────────────────────────────────────────────────────

@media (max-width: 820px) {
  .sbp-page {
    padding: 18px 16px 32px;
  }

  .sbp-head {
    flex-direction: column;
    align-items: stretch;
  }

  .sbp-modal-foot {
    flex-direction: column;
    align-items: stretch;
  }

  .sbp-foot-actions {
    justify-content: space-between;
  }
}
</style>
