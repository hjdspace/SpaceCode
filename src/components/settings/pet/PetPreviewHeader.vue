<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Pet, PetMode } from '@/types/pet'
import PetSprite from '@/components/pets/PetSprite.vue'

defineProps<{
  pet: Pet | null
  mode: PetMode
}>()

const emit = defineEmits<{ 'toggle-mode': [] }>()
const { t } = useI18n()
</script>

<template>
  <div class="pet-preview-header">
    <div class="preview-sprite">
      <PetSprite v-if="pet" :pet="pet" :is-petted="false" :scale="2" />
    </div>
    <div class="preview-info">
      <h2 v-if="pet">{{ pet.name }}</h2>
      <p v-if="pet" class="personality">{{ pet.personality }}</p>
      <div v-if="pet" class="badges">
        <span v-if="pet.rarity" class="rarity-badge" :class="`rarity-${pet.rarity}`">
          {{ t(`petSettings.rarity.${pet.rarity}`) }}
        </span>
        <span class="type-badge">
          {{ pet.visual.type === 'builtin-svg' ? t('petSettings.builtin') : t('petSettings.custom') }}
        </span>
      </div>
    </div>
    <div class="mode-toggle">
      <button @click="emit('toggle-mode')">
        {{ mode === 'embedded' ? t('petSettings.switchToDesktop') : t('petSettings.switchToEmbedded') }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.pet-preview-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-subtle, #3a3a3a);
  border-radius: 12px;
  margin-bottom: 16px;
}

.preview-sprite { flex-shrink: 0; }

.preview-info {
  flex: 1;

  h2 {
    margin: 0 0 4px;
    font-size: 18px;
    color: var(--text-primary, #fff);
  }

  .personality {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--text-muted, #999);
  }
}

.badges {
  display: flex;
  gap: 8px;
}

.rarity-badge, .type-badge {
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

.rarity-badge {
  &.rarity-common { background: rgba(158, 158, 158, 0.2); color: #9e9e9e; }
  &.rarity-rare { background: rgba(79, 195, 247, 0.15); color: #4FC3F7; }
  &.rarity-epic { background: rgba(171, 71, 188, 0.15); color: #AB47BC; }
  &.rarity-legendary { background: rgba(255, 193, 7, 0.15); color: #FFC107; }
}

.type-badge {
  background: var(--bg-tertiary, #444);
  color: var(--text-secondary, #ccc);
}

.mode-toggle button {
  padding: 8px 16px;
  background: var(--accent-primary, #4FC3F7);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;

  &:hover { opacity: 0.9; }
}
</style>
