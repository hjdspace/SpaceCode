<template>
  <div class="marketplace-browser">
    <!-- Left: search + results -->
    <div class="marketplace-sidebar">
      <div class="search-box">
        <Search :size="14" class="search-icon" />
        <input
          v-model="search"
          :placeholder="t('skills.marketplace.searchPlaceholder')"
          class="search-input"
        />
      </div>
      <div class="results-list">
        <div v-if="loading && results.length === 0" class="loading-state">
          <Loader2 :size="20" class="spin" />
        </div>
        <div v-else-if="error" class="error-state">
          <p class="error-title">{{ t('skills.marketplace.failedToSearch') }}</p>
          <p class="error-desc">{{ error }}</p>
        </div>
        <div v-else-if="!loading && results.length === 0" class="empty-state">
          <Store :size="32" class="empty-icon" />
          <p class="empty-text">{{ t('skills.marketplace.noResults') }}</p>
        </div>
        <MarketplaceSkillCard
          v-for="skill in results"
          :key="skill.id"
          :skill="skill"
          :selected="selected?.id === skill.id"
          @select="selected = skill"
        />
      </div>
    </div>

    <!-- Divider -->
    <div class="divider" />

    <!-- Right: detail -->
    <div class="marketplace-detail">
      <MarketplaceSkillDetail
        v-if="selected"
        :key="selected.id"
        :skill="selected"
        @install-complete="handleInstallComplete"
      />
      <div v-else class="no-selection">
        <Store :size="48" class="no-selection-icon" />
        <div class="no-selection-text">
          <p class="no-selection-title">{{ t('skills.marketplace.browseTitle') }}</p>
          <p class="no-selection-desc">{{ t('skills.marketplace.browseDesc') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { Search, Loader2, Store } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useSkillsStore, type MarketplaceSkill } from '@/stores/skills'
import MarketplaceSkillCard from './MarketplaceSkillCard.vue'
import MarketplaceSkillDetail from './MarketplaceSkillDetail.vue'

const { t } = useI18n()
const skillsStore = useSkillsStore()

const emit = defineEmits<{
  installed: []
}>()

const search = ref('')
const selected = ref<MarketplaceSkill | null>(null)
const results = ref<MarketplaceSkill[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function doSearch(query: string) {
  loading.value = true
  error.value = null
  try {
    await skillsStore.searchMarketplace(query)
    results.value = skillsStore.marketplaceSkills
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Search failed'
    results.value = []
  } finally {
    loading.value = false
  }
}

watch(search, (value) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    doSearch(value)
  }, 300)
})

function handleInstallComplete() {
  doSearch(search.value)
  emit('installed')
}

onMounted(() => {
  doSearch('')
})
</script>

<style lang="scss" scoped>
.marketplace-browser {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.marketplace-sidebar {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
}

.search-box {
  position: relative;
  margin-bottom: 8px;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}

.search-input {
  width: 100%;
  padding: 8px 10px 8px 32px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  &::placeholder {
    color: var(--text-muted);
  }
}

.results-list {
  flex: 1;
  overflow-y: auto;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
}

.spin {
  animation: spin 1s linear infinite;
  color: var(--text-muted);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 16px;
  text-align: center;
}

.error-title {
  font-size: 12px;
  color: #dc3545;
  margin: 0;
}

.error-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  color: var(--text-muted);
}

.empty-icon {
  opacity: 0.4;
}

.empty-text {
  font-size: 12px;
  margin: 0;
}

.divider {
  width: 1px;
  background: var(--border-color);
  flex-shrink: 0;
}

.marketplace-detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.no-selection {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-muted);
}

.no-selection-icon {
  opacity: 0.3;
}

.no-selection-text {
  text-align: center;
}

.no-selection-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
}

.no-selection-desc {
  font-size: 12px;
  margin: 4px 0 0;
}
</style>
