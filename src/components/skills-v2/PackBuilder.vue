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
