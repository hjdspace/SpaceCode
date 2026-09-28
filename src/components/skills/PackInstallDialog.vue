<template>
  <Teleport to="body">
    <div v-if="open && pack" class="pid-overlay" @click.self="close">
      <div class="pid-dialog">
        <header class="pid-header">
          <div class="pid-title-wrap">
            <Boxes :size="18" />
            <h3 class="pid-title">{{ pack.name }}</h3>
          </div>
          <div class="pid-header-actions">
            <button class="pid-link-btn" @click="selectAll">{{ t('skillManagerV2.builtinPacks.selectAll') }}</button>
            <button class="pid-link-btn" @click="clearSelection">{{ t('skillManagerV2.builtinPacks.clearAll') }}</button>
            <button class="pid-icon-btn" :title="t('skillManagerV2.builtinPacks.close')" @click="close">
              <X :size="16" />
            </button>
          </div>
        </header>

        <div class="pid-body">
          <!-- flat 布局：无分类，平铺展示 -->
          <div v-if="pack.categories.length === 0" class="pid-group">
            <div
              v-for="skill in skills"
              :key="skill.skillPath"
              class="pid-skill-row"
              :class="{ disabled: skill.isInstalled }"
              @click="toggleSkill(skill)"
            >
              <input
                type="checkbox"
                class="pid-check"
                :checked="selected.has(skill.skillPath)"
                :disabled="skill.isInstalled"
                @click.stop
                @change="toggleSkill(skill)"
              />
              <FileText :size="14" class="pid-row-icon" />
              <div class="pid-row-main">
                <span class="pid-row-name">{{ skill.name }}</span>
                <span v-if="skill.description" class="pid-row-desc">{{ skill.description }}</span>
              </div>
              <span v-if="skill.isInstalled" class="pid-installed-badge">
                <CheckCircle :size="12" />
                {{ t('skillManagerV2.builtinPacks.installed') }}
              </span>
              <span v-else-if="getResultStatus(skill.name)" class="pid-result" :class="getResultStatus(skill.name)">
                <CheckCircle v-if="getResultStatus(skill.name) === 'success'" :size="12" />
                <AlertCircle v-else-if="getResultStatus(skill.name) === 'failed'" :size="12" />
                <MinusCircle v-else :size="12" />
                {{ getResultLabel(skill.name) }}
              </span>
            </div>
          </div>

          <!-- 分组布局：按分类展示 -->
          <div v-for="cat in pack.categories" v-else :key="cat.name" class="pid-group">
            <div class="pid-group-header">
              <input
                type="checkbox"
                class="pid-check"
                :checked="isCategoryFullySelected(cat.name)"
                :indeterminate="isCategoryPartiallySelected(cat.name)"
                @change="toggleCategory(cat.name)"
              />
              <Folder :size="14" class="pid-folder-icon" />
              <span class="pid-group-name">{{ cat.name }}</span>
              <span class="pid-group-count">{{ t('skillManagerV2.builtinPacks.skills', { count: cat.skillCount }) }}</span>
            </div>
            <div
              v-for="skill in categorySkills(cat.name)"
              :key="skill.skillPath"
              class="pid-skill-row"
              :class="{ disabled: skill.isInstalled }"
              @click="toggleSkill(skill)"
            >
              <input
                type="checkbox"
                class="pid-check"
                :checked="selected.has(skill.skillPath)"
                :disabled="skill.isInstalled"
                @click.stop
                @change="toggleSkill(skill)"
              />
              <FileText :size="14" class="pid-row-icon" />
              <div class="pid-row-main">
                <span class="pid-row-name">{{ skill.name }}</span>
                <span v-if="skill.description" class="pid-row-desc">{{ skill.description }}</span>
              </div>
              <span v-if="skill.isInstalled" class="pid-installed-badge">
                <CheckCircle :size="12" />
                {{ t('skillManagerV2.builtinPacks.installed') }}
              </span>
              <span v-else-if="getResultStatus(skill.name)" class="pid-result" :class="getResultStatus(skill.name)">
                <CheckCircle v-if="getResultStatus(skill.name) === 'success'" :size="12" />
                <AlertCircle v-else-if="getResultStatus(skill.name) === 'failed'" :size="12" />
                <MinusCircle v-else :size="12" />
                {{ getResultLabel(skill.name) }}
              </span>
            </div>
          </div>

          <div v-if="resultSummary" class="pid-result-summary" :class="{ partial: resultSummary.failed > 0 }">
            <template v-if="resultSummary.failed === 0">
              {{ t('skillManagerV2.builtinPacks.resultSuccess', { count: resultSummary.success }) }}
            </template>
            <template v-else>
              {{ t('skillManagerV2.builtinPacks.resultPartial', { success: resultSummary.success, failed: resultSummary.failed }) }}
            </template>
          </div>
        </div>

        <footer class="pid-footer">
          <div class="pid-scope">
            <span class="pid-scope-label">{{ t('skillManagerV2.builtinPacks.scopeLabel') }}</span>
            <button
              class="pid-scope-btn"
              :class="{ active: scope === 'global' }"
              @click="scope = 'global'"
            >
              {{ t('skillManagerV2.builtinPacks.scopeGlobal') }}
            </button>
            <button
              class="pid-scope-btn"
              :class="{ active: scope === 'project' }"
              :disabled="!projectRoot"
              :title="projectRoot ? t('skillManagerV2.builtinPacks.scopeProjectHint') : t('skillManagerV2.builtinPacks.scopeProjectHint')"
              @click="scope = 'project'"
            >
              {{ t('skillManagerV2.builtinPacks.scopeProject') }}
            </button>
          </div>
          <div class="pid-footer-actions">
            <span class="pid-selected-count">{{ t('skillManagerV2.builtinPacks.selected', { count: selected.size }) }}</span>
            <button
              class="pid-install-btn"
              :disabled="selected.size === 0 || installing"
              @click="installSelected"
            >
              <Loader2 v-if="installing" :size="14" class="spin" />
              <Download v-else :size="14" />
              {{ installing ? t('skillManagerV2.builtinPacks.installing') : t('skillManagerV2.builtinPacks.install') }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Boxes, X, FileText, Folder, CheckCircle, AlertCircle,
  MinusCircle, Download, Loader2
} from 'lucide-vue-next'
import { useLocalSkillsStore, type LocalSkill, type LocalSkillPack } from '../../stores/localSkills'
import { useAppStore } from '@/stores/app'

const props = defineProps<{
  open: boolean
  pack: LocalSkillPack | null
  skills: LocalSkill[]
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'installed'): void
}>()

const { t } = useI18n()
const store = useLocalSkillsStore()
const appStore = useAppStore()

const selected = ref<Set<string>>(new Set())
const scope = ref<'global' | 'project'>('global')
const installing = ref(false)
const results = ref<Map<string, { status: 'success' | 'failed' | 'skipped'; error?: string }>>(new Map())

const projectRoot = computed(() => appStore.projectRoot || '')

const selectableSkills = computed(() => props.skills.filter(s => !s.isInstalled))

const resultSummary = computed(() => {
  if (results.value.size === 0) return null
  let success = 0
  let failed = 0
  results.value.forEach((r) => {
    if (r.status === 'success') success++
    else if (r.status === 'failed') failed++
  })
  return { success, failed }
})

watch(() => props.open, (open) => {
  if (open) {
    selected.value = new Set()
    results.value = new Map()
    scope.value = 'global'
  }
})

function close() {
  emit('update:open', false)
}

function toggleSkill(skill: LocalSkill) {
  if (skill.isInstalled) return
  const next = new Set(selected.value)
  if (next.has(skill.skillPath)) next.delete(skill.skillPath)
  else next.add(skill.skillPath)
  selected.value = next
}

function categorySkills(categoryName: string): LocalSkill[] {
  return props.skills.filter(s => s.packCategory === categoryName)
}

function isCategoryFullySelected(categoryName: string): boolean {
  const catSkills = categorySkills(categoryName).filter(s => !s.isInstalled)
  return catSkills.length > 0 && catSkills.every(s => selected.value.has(s.skillPath))
}

function isCategoryPartiallySelected(categoryName: string): boolean {
  const catSkills = categorySkills(categoryName).filter(s => !s.isInstalled)
  const picked = catSkills.filter(s => selected.value.has(s.skillPath))
  return picked.length > 0 && picked.length < catSkills.length
}

function toggleCategory(categoryName: string) {
  const catSkills = categorySkills(categoryName).filter(s => !s.isInstalled)
  const shouldSelect = !isCategoryFullySelected(categoryName)
  const next = new Set(selected.value)
  catSkills.forEach((s) => {
    if (shouldSelect) next.add(s.skillPath)
    else next.delete(s.skillPath)
  })
  selected.value = next
}

function selectAll() {
  selected.value = new Set(selectableSkills.value.map(s => s.skillPath))
}

function clearSelection() {
  selected.value = new Set()
}

function getResultStatus(name: string): 'success' | 'failed' | 'skipped' | null {
  return results.value.get(name)?.status ?? null
}

function getResultLabel(name: string): string {
  const result = results.value.get(name)
  if (!result) return ''
  if (result.status === 'success') return t('skillManagerV2.builtinPacks.installed')
  if (result.status === 'skipped') return t('skillManagerV2.builtinPacks.alreadyInstalled')
  return result.error || t('skillManagerV2.builtinPacks.installFailed')
}

async function installSelected() {
  const items = selectableSkills.value
    .filter(s => selected.value.has(s.skillPath))
    .map(s => ({ name: s.name, skillPath: s.skillPath }))
  if (items.length === 0) return

  installing.value = true
  try {
    const installResults = await store.installPackSkills(items, scope.value, appStore.projectRoot || undefined)
    const nextResults = new Map(results.value)
    const succeeded = new Set<string>()
    for (const result of installResults) {
      const isAlreadyInstalled = !!result.error && result.error.includes('already installed')
      const status = result.success ? 'success' : (isAlreadyInstalled ? 'skipped' : 'failed')
      nextResults.set(result.name, { status, error: result.error })
      if (result.success) succeeded.add(result.name)
    }
    results.value = nextResults

    // 成功安装的技能从选中集合移除
    const keyByName = new Map(items.map(item => [item.name, item.skillPath]))
    const nextSelected = new Set(selected.value)
    succeeded.forEach((name) => {
      const key = keyByName.get(name)
      if (key) nextSelected.delete(key)
    })
    selected.value = nextSelected

    emit('installed')
  } catch (err) {
    console.error('Failed to install pack skills:', err)
  } finally {
    installing.value = false
  }
}
</script>

<style scoped lang="scss">
.pid-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.pid-dialog {
  width: min(640px, 90vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.pid-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-default);
  color: var(--text-primary);
}

.pid-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--accent-primary);
}

.pid-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pid-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.pid-link-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
}

.pid-icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
}

.pid-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pid-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pid-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.pid-folder-icon {
  color: var(--text-tertiary);
}

.pid-group-name {
  text-transform: capitalize;
}

.pid-group-count {
  font-weight: 400;
  font-size: 11px;
  color: var(--text-tertiary);
}

.pid-skill-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px 7px 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--bg-tertiary);
  }

  &.disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }
}

.pid-check {
  accent-color: var(--accent-primary);
  flex-shrink: 0;
}

.pid-row-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.pid-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pid-row-name {
  font-size: 13px;
  color: var(--text-primary);
}

.pid-row-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pid-installed-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #10b981;
  flex-shrink: 0;
}

.pid-result {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  flex-shrink: 0;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.success { color: #10b981; }
  &.skipped { color: var(--text-tertiary); }
  &.failed { color: var(--error, #dc3545); }
}

.pid-result-summary {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: #10b981;
  font-size: 12px;

  &.partial {
    color: var(--text-secondary);
  }
}

.pid-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-default);
}

.pid-scope {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pid-scope-label {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-right: 2px;
}

.pid-scope-btn {
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    color: var(--text-primary);
  }

  &.active {
    background: var(--accent-primary-glow, var(--bg-tertiary));
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.pid-footer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pid-selected-count {
  font-size: 12px;
  color: var(--text-tertiary);
}

.pid-install-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  background: var(--accent-primary);
  color: white;
  transition: opacity var(--transition-fast);

  &:hover:not(:disabled) { opacity: 0.9; }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
