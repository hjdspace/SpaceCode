<script setup lang="ts">
/**
 * Skill Manager V2 — Pack Builder
 *
 * Create or edit a skill pack by selecting skills from the center library.
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillPackDetail, UpsertPackInput } from '@/types/skillManagerV2'

const props = defineProps<{
  mode: 'create' | 'edit'
  existing: SkillPackDetail | null
}>()

const emit = defineEmits<{
  cancel: []
  saved: [pack: SkillPackDetail]
}>()

const { t } = useI18n()
const store = useSkillManagerStore()

const name = ref(props.mode === 'edit' && props.existing ? props.existing.name : '')
const query = ref('')
const selected = ref<Set<string>>(
  new Set(props.existing?.members.map((m) => m.skillId) ?? [])
)
const busy = ref(false)
const error = ref<string | null>(null)

const skills = computed(() => store.skills)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return skills.value
  return skills.value.filter((s) =>
    [s.name, s.id, s.description].join(' ').toLowerCase().includes(q)
  )
})

const selectedSkills = computed(() =>
  skills.value.filter((s) => selected.value.has(s.id))
)

function toggle(id: string): void {
  error.value = null
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function selectVisible(): void {
  error.value = null
  const next = new Set(selected.value)
  filtered.value.forEach((s) => next.add(s.id))
  selected.value = next
}

function clearAll(): void {
  error.value = null
  selected.value = new Set()
}

async function save(): Promise<void> {
  if (!name.value.trim()) {
    error.value = t('skillManagerV2.pack.nameRequired')
    return
  }
  busy.value = true
  error.value = null
  try {
    const input: UpsertPackInput = {
      id: props.mode === 'edit' ? props.existing?.id : undefined,
      name: name.value.trim(),
      memberSkillIds: Array.from(selected.value),
    }
    const result = await store.upsertPack(input)
    if (result) {
      emit('saved', result)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function cancel(): void {
  emit('cancel')
}
</script>

<template>
  <div class="spp-builder">
    <header class="spp-builder-header">
      <div>
        <div class="spp-detail-kicker">{{ mode === 'edit' ? t('skillManagerV2.pack.editPack') : t('skillManagerV2.pack.createPack') }}</div>
        <h3>{{ mode === 'edit' ? t('skillManagerV2.pack.editTitle') : t('skillManagerV2.pack.createTitle') }}</h3>
        <p>{{ t('skillManagerV2.pack.builderHint') }}</p>
      </div>
      <button class="spp-close-btn" @click="cancel" :disabled="busy">&times;</button>
    </header>

    <div class="spp-builder-identity">
      <label class="spp-field">
        <span>{{ t('skillManagerV2.pack.nameLabel') }}</span>
        <input v-model="name" :placeholder="t('skillManagerV2.pack.namePlaceholder')" />
      </label>
      <div class="spp-builder-count">
        <strong>{{ selectedSkills.length }}</strong>
        <span>{{ t('skillManagerV2.pack.skillsAdded') }}</span>
      </div>
    </div>

    <div class="spp-builder-grid">
      <!-- Picker -->
      <section class="spp-builder-card">
        <div class="spp-builder-card-head">
          <div>
            <h4>{{ t('skillManagerV2.pack.fromLibrary') }}</h4>
            <span>{{ filtered.length }} {{ t('skillManagerV2.pack.results') }}</span>
          </div>
          <button class="spp-btn sm" @click="selectVisible" :disabled="filtered.length === 0">
            {{ t('skillManagerV2.pack.selectAll') }}
          </button>
        </div>
        <input v-model="query" class="spp-search" :placeholder="t('skillManagerV2.pack.searchSkillPlaceholder')" />
        <div class="spp-picker-list">
          <div v-if="filtered.length === 0" class="spp-section-empty sm">{{ t('skillManagerV2.pack.noMatchSkill') }}</div>
          <div
            v-for="skill in filtered"
            :key="skill.id"
            class="spp-pick-row"
            :class="{ selected: selected.has(skill.id) }"
            @click="toggle(skill.id)"
          >
            <span class="spp-pick-toggle">{{ selected.has(skill.id) ? '✓' : '+' }}</span>
            <div class="spp-pick-info">
              <strong>{{ skill.name }}</strong>
              <span>{{ skill.description || skill.id }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Selected -->
      <section class="spp-builder-card">
        <div class="spp-builder-card-head">
          <div>
            <h4>{{ t('skillManagerV2.pack.packMembers') }}</h4>
            <span>{{ selectedSkills.length }} {{ t('skillManagerV2.pack.skills') }}</span>
          </div>
          <button class="spp-btn sm" @click="clearAll" :disabled="selectedSkills.length === 0">
            {{ t('skillManagerV2.pack.clearAll') }}
          </button>
        </div>
        <div v-if="selectedSkills.length === 0" class="spp-section-empty sm">
          <strong>{{ t('skillManagerV2.pack.noMembers') }}</strong>
          <span>{{ t('skillManagerV2.pack.noMembersHint') }}</span>
        </div>
        <div v-else class="spp-picker-list">
          <div
            v-for="skill in selectedSkills"
            :key="skill.id"
            class="spp-pick-row selected"
            @click="toggle(skill.id)"
          >
            <span class="spp-pick-toggle">✓</span>
            <div class="spp-pick-info">
              <strong>{{ skill.name }}</strong>
              <span>{{ skill.id }}</span>
            </div>
            <span class="spp-pick-remove">&times;</span>
          </div>
        </div>
      </section>
    </div>

    <div v-if="error" class="spp-error">{{ error }}</div>
    <footer class="spp-builder-footer">
      <span>{{ name.trim() ? t('skillManagerV2.pack.savePreview', { name: name.trim(), count: selectedSkills.length }) : t('skillManagerV2.pack.fillName') }}</span>
      <div class="spp-detail-actions">
        <button class="spp-btn" @click="cancel" :disabled="busy">{{ t('skillManagerV2.actions.cancel') }}</button>
        <button class="spp-btn primary" @click="save" :disabled="busy || !name.trim()">
          {{ busy ? t('common.processing') : (mode === 'edit' ? t('skillManagerV2.pack.saveChanges') : t('skillManagerV2.actions.createPack')) }}
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped lang="scss">
.spp-builder {
  display: flex;
  min-height: 0;
  height: 100%;
  flex-direction: column;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.spp-builder-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 22px 26px 18px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;

  h3 {
    margin: 2px 0 0;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.025em;
  }

  p {
    margin: 5px 0 0;
    color: var(--text-muted);
    font-size: 13px;
  }
}

.spp-detail-kicker {
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 750;
}

.spp-close-btn {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: 50%;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }
}

.spp-builder-identity {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 22px;
  padding: 18px 26px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-soft);
  flex-shrink: 0;
}

.spp-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;

  > span {
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 700;
  }

  input,
  select {
    width: 100%;
    height: 42px;
    padding: 0 12px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    outline: none;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font: inherit;
    font-size: 14px;
    transition: border-color 160ms ease, box-shadow 160ms ease;
  }

  input:focus,
  select:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }
}

.spp-builder-count {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding-bottom: 10px;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 12px;

  strong {
    color: var(--accent-primary);
    font-size: 28px;
    font-variant-numeric: tabular-nums;
  }
}

.spp-builder-grid {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  gap: 16px;
  padding: 18px 26px;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-secondary) 60%, var(--bg-primary));
}

.spp-builder-card {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-elevated);
  box-shadow: 0 8px 24px rgba(31, 41, 71, 0.05);
}

.spp-builder-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;

  h4 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
  }

  span {
    display: block;
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 11px;
  }
}

.spp-search {
  width: 100%;
  height: 38px;
  margin: 0 0 10px;
  padding: 0 11px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  outline: none;
  background: var(--surface-soft);
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;

  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }
}

.spp-picker-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding-right: 3px;
}

.spp-pick-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 58px;
  margin-bottom: 7px;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;

  &:hover {
    border-color: var(--accent-primary);
    background: var(--surface-soft);
    transform: translateY(-1px);
  }

  &.selected {
    border-color: var(--accent-primary-glow);
    background: color-mix(in srgb, var(--accent-primary) 7%, var(--bg-elevated));
  }
}

.spp-pick-toggle {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid var(--accent-primary);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--accent-primary);
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.spp-pick-row.selected .spp-pick-toggle {
  background: var(--accent-primary);
  color: #fff;
}

.spp-pick-info {
  min-width: 0;

  strong,
  span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 750;
  }

  span {
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 11px;
  }
}

.spp-pick-remove {
  color: var(--text-muted);
  font-size: 18px;
}

.spp-section-empty {
  display: flex;
  min-height: 140px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 6px;
  padding: 20px;
  color: var(--text-muted);
  text-align: center;

  &.sm { min-height: 120px; }

  strong {
    color: var(--text-primary);
    font-size: 14px;
  }

  span { font-size: 12px; }
}

.spp-btn {
  height: 34px;
  padding: 0 13px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;

  &:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }

  &:active:not(:disabled) { transform: translateY(1px); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }

  &.primary {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: #fff;
  }

  &.sm { height: 30px; padding: 0 10px; font-size: 11px; }
}

.spp-error {
  margin: 0 26px;
  padding: 8px 11px;
  border: 1px solid rgba(220, 38, 38, 0.2);
  border-radius: var(--radius-md);
  background: rgba(220, 38, 38, 0.08);
  color: var(--error);
  font-size: 12px;
}

.spp-builder-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 26px;
  border-top: 1px solid var(--border-default);
  color: var(--text-muted);
  font-size: 12px;
  flex-shrink: 0;
}

.spp-detail-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

@media (max-width: 760px) {
  .spp-builder-header,
  .spp-builder-identity,
  .spp-builder-grid,
  .spp-builder-footer { padding-right: 16px; padding-left: 16px; }
  .spp-builder-grid { grid-template-columns: minmax(0, 1fr); overflow-y: auto; }
  .spp-builder-card { min-height: 280px; }
  .spp-builder-footer { align-items: stretch; flex-direction: column; }
  .spp-detail-actions { justify-content: flex-end; }
}
</style>
