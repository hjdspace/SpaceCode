<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Pet } from '@/types/pet'
import PetSprite from '@/components/pets/PetSprite.vue'

const props = defineProps<{
  pet: Pet
  active?: boolean
  isCustom?: boolean
}>()

defineEmits<{ click: []; delete: [] }>()

const { t } = useI18n()

const rarityStars = computed(() => {
  switch (props.pet.rarity) {
    case 'common': return 1
    case 'rare': return 3
    case 'epic': return 4
    case 'legendary': return 5
    default: return 0
  }
})
</script>

<template>
  <div class="pet-card" :class="{ active }" @click="$emit('click')">
    <div class="card-sprite">
      <PetSprite :pet="pet" :is-petted="false" :scale="0.8" />
    </div>
    <div class="card-info">
      <span class="name">{{ pet.name }}</span>
      <span v-if="pet.rarity" class="rarity">{{ '★'.repeat(rarityStars) }}</span>
    </div>
    <button v-if="isCustom" class="delete-btn" @click.stop="$emit('delete')">×</button>
  </div>
</template>

<style scoped lang="scss">
.pet-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-subtle, #3a3a3a);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-hover, #333);
    border-color: var(--border-default, #444);
  }

  &.active {
    border-color: var(--accent-primary, #4FC3F7);
    background: var(--surface-hover, #333);
  }
}

.card-sprite { margin-bottom: 8px; }

.card-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.name {
  font-size: 13px;
  color: var(--text-primary, #fff);
  font-weight: 500;
}

.rarity {
  font-size: 10px;
  color: var(--text-muted, #999);
}

.delete-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border: none;
  background: var(--bg-tertiary, #444);
  color: var(--text-muted, #999);
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;

  &:hover {
    background: #e53935;
    color: white;
  }
}
</style>
