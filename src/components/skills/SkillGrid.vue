<template>
  <div class="skill-grid" :class="viewMode">
    <div v-if="skills.length === 0" class="empty-state">
      <PackageOpen :size="48" />
      <p>{{ t('skills.emptyLibrary') }}</p>
      <span>{{ t('skills.emptyLibraryDesc') }}</span>
    </div>

    <div v-else class="grid-container">
      <LocalSkillCard
        v-for="skill in skills"
        :key="skill.name"
        :skill="skill"
        :installing="installingId === skill.name"
        @select="$emit('select', $event)"
        @install="$emit('install', $event)"
        @uninstall="$emit('uninstall', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { PackageOpen } from 'lucide-vue-next'
import LocalSkillCard from './LocalSkillCard.vue'
import type { LocalSkill } from '../../stores/localSkills'

defineProps<{
  skills: LocalSkill[]
  viewMode: 'grid' | 'list'
  installingId: string | null
}>()

defineEmits<{
  (e: 'select', skill: LocalSkill): void
  (e: 'install', name: string): void
  (e: 'uninstall', name: string): void
}>()

const { t } = useI18n()
</script>

<style scoped lang="scss">
.skill-grid {
  flex: 1;
  overflow-y: auto;
  padding: 16px;

  &.grid .grid-container {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  &.list .grid-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  gap: 8px;

  p {
    font-size: 16px;
    font-weight: 500;
    margin: 0;
  }

  span {
    font-size: 13px;
  }
}
</style>
