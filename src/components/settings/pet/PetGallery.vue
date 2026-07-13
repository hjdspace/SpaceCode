<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePetStore } from '@/stores/pet'
import { BUILTIN_PETS } from '@/lib/builtinPets'
import PetCard from './PetCard.vue'

const emit = defineEmits<{ create: [] }>()
const petStore = usePetStore()
const { t } = useI18n()

const customPets = computed(() => petStore.config?.customPets ?? [])

async function selectPet(petId: string) {
  try {
    await petStore.setActivePet(petId)
  } catch (err) {
    console.error('[Pet] Failed to select pet:', err)
  }
}

async function deleteCustomPet(petId: string) {
  try {
    await petStore.removeCustomPet(petId)
  } catch (err) {
    console.error('[Pet] Failed to delete custom pet:', err)
  }
}
</script>

<template>
  <div class="pet-gallery">
    <section class="gallery-section">
      <h3>{{ t('petSettings.builtinPets') }}</h3>
      <div class="pet-grid">
        <PetCard
          v-for="pet in BUILTIN_PETS"
          :key="pet.id"
          :pet="pet"
          :active="pet.id === petStore.config?.activePetId"
          @click="selectPet(pet.id)"
        />
      </div>
    </section>

    <section class="gallery-section">
      <h3 class="custom-header">
        {{ t('petSettings.customPets') }}
        <button class="create-btn" @click="emit('create')">{{ t('petSettings.create') }}</button>
      </h3>
      <div v-if="customPets.length" class="pet-grid">
        <PetCard
          v-for="pet in customPets"
          :key="pet.id"
          :pet="pet"
          :active="pet.id === petStore.config?.activePetId"
          :is-custom="true"
          @click="selectPet(pet.id)"
          @delete="deleteCustomPet(pet.id)"
        />
      </div>
      <div v-else class="empty-state">
        {{ t('petSettings.noCustomPets') }}
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.pet-gallery {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.gallery-section h3 {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--text-secondary, #ccc);
  font-weight: 500;
}

.custom-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.create-btn {
  padding: 4px 12px;
  background: var(--accent-primary, #4FC3F7);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;

  &:hover { opacity: 0.9; }
}

.pet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 12px;
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--text-muted, #999);
  font-size: 13px;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px dashed var(--border-default, #444);
  border-radius: 8px;
}
</style>
