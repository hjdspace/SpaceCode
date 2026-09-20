<script setup lang="ts">
/**
 * Skill Manager V2 — Skill Pack Page
 *
 * Full pack management: list, detail, create/edit, apply to agents, revoke.
 * Reference: AgentBro `src/components/skills-v2/SkillPackPage.tsx`
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type {
  SkillPackSummary,
  SkillPackDetail,
  SkillPackMember,
  DeletePackPreview,
  RemovePackFromAgentPreview,
} from '@/types/skillManagerV2'
import PackBuilder from './PackBuilder.vue'
import ApplyPackDialog from './ApplyPackDialog.vue'
import { getSkillGlyph } from './skillLabels'

const { t } = useI18n()
const store = useSkillManagerStore()

// ── State ─────────────────────────────────────────────────────────

const packQuery = ref('')
const builderMode = ref<'create' | 'edit' | null>(null)
const applyFor = ref<SkillPackDetail | null>(null)
const deletePreview = ref<DeletePackPreview | null>(null)
const revokePreview = ref<RemovePackFromAgentPreview | null>(null)
const detailSection = ref<'members' | 'agents'>('members')
const busy = ref(false)
const notice = ref<string | null>(null)

// ── Computed ──────────────────────────────────────────────────────

const packs = computed<SkillPackSummary[]>(() => store.packs)
const selectedPackDetail = computed<SkillPackDetail | null>(() => store.selectedPackDetail)
const hasPacks = computed(() => packs.value.length > 0)
const totalMembers = computed(() => packs.value.reduce((sum, pack) => sum + pack.memberCount, 0))
const totalApplied = computed(() => packs.value.reduce((sum, pack) => sum + pack.appliedAgentCount, 0))
const isDefaultPack = computed(() => selectedPackDetail.value?.id === 'default')

const filteredPacks = computed(() => {
  const q = packQuery.value.trim().toLowerCase()
  if (!q) return packs.value
  return packs.value.filter((p) =>
    [p.name, p.description, p.tags.join(' ')].join(' ').toLowerCase().includes(q)
  )
})

// ── Lifecycle ─────────────────────────────────────────────────────

onMounted(() => {
  if (hasPacks.value && !store.selectedPackDetail) {
    selectPack(packs.value[0].id)
  }
})

watch(
  () => packs.value,
  (newPacks) => {
    if (newPacks.length > 0 && !store.selectedPackDetail && !builderMode.value) {
      selectPack(newPacks[0].id)
    }
  }
)

// ── Handlers ──────────────────────────────────────────────────────

function selectPack(packId: string): void {
  builderMode.value = null
  store.loadPackDetail(packId)
}

function handleMemberClick(member: SkillPackMember): void {
  if (member.missing) return
  void store.loadSkillDetail(member.skillId)
}

function startCreate(): void {
  store.clearSelectedPack()
  builderMode.value = 'create'
}

function startEdit(): void {
  builderMode.value = 'edit'
}

async function openDelete(packId: string): Promise<void> {
  busy.value = true
  try {
    deletePreview.value = await store.previewDeletePack(packId)
  } finally {
    busy.value = false
  }
}

async function openRevoke(packId: string, agentId: string): Promise<void> {
  busy.value = true
  try {
    revokePreview.value = await store.previewRemovePackFromAgent(packId, agentId)
  } finally {
    busy.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (!deletePreview.value) return
  busy.value = true
  try {
    await store.deletePack(deletePreview.value.packId)
    deletePreview.value = null
    notice.value = t('skillManagerV2.pack.deleted')
  } finally {
    busy.value = false
  }
}

async function confirmRevoke(): Promise<void> {
  if (!revokePreview.value) return
  busy.value = true
  try {
    const packId = revokePreview.value.packId
    await store.removePackFromAgent(packId, revokePreview.value.agentId)
    revokePreview.value = null
    notice.value = t('skillManagerV2.pack.revoked')
    if (selectedPackDetail.value) {
      await store.loadPackDetail(packId)
    }
  } finally {
    busy.value = false
  }
}

function onSaved(pack: SkillPackDetail): void {
  builderMode.value = null
  notice.value = t('skillManagerV2.pack.saved', { name: pack.name })
  store.loadPackDetail(pack.id)
}

function applyToAgents(): void {
  if (!selectedPackDetail.value) return
  applyFor.value = selectedPackDetail.value
}

async function onApplied(): Promise<void> {
  const packId = applyFor.value?.id
  applyFor.value = null
  notice.value = t('skillManagerV2.pack.applied')
  if (packId) {
    await store.loadPackDetail(packId)
  }
}

function clearNotice(): void {
  notice.value = null
}
</script>

<template>
  <div class="spp-page">
    <!-- Notice -->
    <div v-if="notice" class="spp-notice" @click="clearNotice">
      <span>{{ notice }}</span>
      <button class="spp-notice-close">&times;</button>
    </div>

    <!-- Error -->
    <div v-if="store.error" class="spp-error">{{ store.error }}</div>

    <header class="spp-header">
      <div>
        <h2>{{ t('skillManagerV2.pack.allPacks') }}</h2>
        <p>{{ t('skillManagerV2.viewSubtitle.packs') }}</p>
        <div class="spp-overview" aria-label="技能包概览">
          <span><strong>{{ packs.length }}</strong> {{ t('skillManagerV2.pack.packCountLabel') }}</span>
          <span><strong>{{ totalMembers }}</strong> {{ t('skillManagerV2.pack.memberRefsLabel') }}</span>
          <span><strong>{{ totalApplied }}</strong> {{ t('skillManagerV2.pack.agentAppsLabel') }}</span>
          <span class="spp-overview-status"><i />{{ t('skillManagerV2.pack.healthySummary') }}</span>
        </div>
      </div>
      <div class="spp-header-actions">
        <button class="spp-btn primary" @click="startCreate">+ {{ t('skillManagerV2.actions.newPack') }}</button>
        <button class="spp-btn" :disabled="store.loading" @click="store.loadOverview()">
          {{ store.loading ? t('skillManagerV2.loading') : t('skillManagerV2.actions.refresh') }}
        </button>
      </div>
    </header>

    <!-- Two-column layout -->
    <div class="spp-layout">
      <!-- Left: Pack List -->
      <aside class="spp-sidebar">
        <div class="spp-side-header">
          <div>
            <strong>{{ t('skillManagerV2.pack.allPacks') }}</strong>
            <span>{{ t('skillManagerV2.pack.selectHint') }}</span>
          </div>
          <span class="spp-count-badge">{{ filteredPacks.length }}</span>
        </div>
        <input
          v-model="packQuery"
          class="spp-search"
          :placeholder="t('skillManagerV2.pack.searchPlaceholder')"
        />
        <!-- Pack List -->
        <div v-if="!hasPacks" class="spp-empty-side">
          <strong>{{ t('skillManagerV2.empty.noPacks') }}</strong>
          <span>{{ t('skillManagerV2.empty.noPacksDesc') }}</span>
          <button class="spp-btn primary" @click="startCreate">
            {{ t('skillManagerV2.actions.createPack') }}
          </button>
        </div>
        <div v-else-if="filteredPacks.length === 0" class="spp-empty-side">
          <span>{{ t('skillManagerV2.pack.noMatch') }}</span>
        </div>
        <div v-else class="spp-pack-list">
          <button
            v-for="pack in filteredPacks"
            :key="pack.id"
            class="spp-pack-item"
            :class="{ active: selectedPackDetail?.id === pack.id && !builderMode }"
            @click="selectPack(pack.id)"
          >
            <span class="spp-pack-emblem" :class="{ builtIn: pack.id === 'default' }">{{ pack.id === 'default' ? 'ALL' : 'PK' }}</span>
            <span class="spp-pack-body">
              <span class="spp-pack-top">
                <strong>{{ pack.name }}</strong>
                <span class="spp-pack-health ok">{{ pack.id === 'default' ? '内置' : '正常' }}</span>
              </span>
              <span class="spp-pack-desc">{{ pack.description || t('skillManagerV2.pack.customPack') }}</span>
              <span class="spp-pack-meta">
                <span>{{ pack.memberCount }} {{ t('skillManagerV2.pack.skills') }}</span>
                <span>{{ pack.appliedAgentCount }} {{ t('skillManagerV2.pack.agents') }}</span>
              </span>
            </span>
            <span class="spp-pack-arrow">&rsaquo;</span>
          </button>
        </div>
      </aside>

      <!-- Right: Pack Detail / Builder -->
      <main class="spp-canvas">
        <!-- Builder Mode -->
        <div v-if="builderMode" class="spp-overlay spp-builder-overlay" @click.self="builderMode = null">
          <div class="spp-modal spp-builder-modal" @click.stop>
            <PackBuilder
              :mode="builderMode"
              :existing="builderMode === 'edit' ? selectedPackDetail : null"
              @cancel="builderMode = null"
              @saved="onSaved"
            />
          </div>
        </div>

        <!-- Detail Mode -->
        <template v-else-if="selectedPackDetail">
          <div class="spp-detail">
            <!-- Header -->
            <header class="spp-detail-header">
              <div class="spp-detail-identity">
                <span class="spp-detail-emblem" :class="{ builtIn: isDefaultPack }">{{ isDefaultPack ? 'ALL' : 'PK' }}</span>
                <div class="spp-detail-main">
                  <div class="spp-detail-kicker">{{ isDefaultPack ? t('skillManagerV2.pack.systemPack') : t('skillManagerV2.pack.customPack') }}</div>
                  <h3>{{ selectedPackDetail.name }}</h3>
                  <p>{{ selectedPackDetail.description || t('skillManagerV2.pack.descPlaceholder') }}</p>
                  <div class="spp-detail-tags">
                    <span>{{ selectedPackDetail.members.length }} {{ t('skillManagerV2.pack.skills') }}</span>
                    <span>{{ selectedPackDetail.appliedAgents.length }} {{ t('skillManagerV2.pack.agents') }}</span>
                    <span v-for="tag in selectedPackDetail.tags" :key="tag" class="spp-tag-chip">{{ tag }}</span>
                  </div>
                </div>
              </div>
              <div class="spp-detail-actions">
                <button
                  class="spp-btn primary"
                  :disabled="busy || selectedPackDetail.members.length === 0"
                  @click="applyToAgents"
                >
                  {{ t('skillManagerV2.actions.applyPack') }}
                </button>
                <button v-if="!isDefaultPack" class="spp-btn" :disabled="busy" @click="startEdit">
                  {{ t('skillManagerV2.pack.edit') }}
                </button>
                <button v-if="!isDefaultPack" class="spp-btn danger" :disabled="busy" @click="openDelete(selectedPackDetail.id)">
                  {{ t('skillManagerV2.pack.delete') }}
                </button>
              </div>
            </header>

            <div v-if="isDefaultPack" class="spp-system-note">
              <strong>{{ t('skillManagerV2.pack.systemNoteTitle') }}</strong>
              <span>{{ t('skillManagerV2.pack.systemNote') }}</span>
            </div>

            <!-- Section Tabs -->
            <div class="spp-section-tabs">
              <button
                :class="{ active: detailSection === 'members' }"
                @click="detailSection = 'members'"
              >
                {{ t('skillManagerV2.pack.members') }} ({{ selectedPackDetail.members.length }})
              </button>
              <button
                :class="{ active: detailSection === 'agents' }"
                @click="detailSection = 'agents'"
              >
                {{ t('skillManagerV2.pack.appliedAgents') }} ({{ selectedPackDetail.appliedAgents.length }})
              </button>
            </div>

            <!-- Members Section -->
            <div v-if="detailSection === 'members'" class="spp-section-content">
              <div v-if="selectedPackDetail.members.length === 0" class="spp-section-empty">
                <strong>{{ t('skillManagerV2.pack.emptyMembers') }}</strong>
                <span>{{ t('skillManagerV2.pack.emptyMembersHint') }}</span>
                <button v-if="!isDefaultPack" class="spp-btn" @click="startEdit">{{ t('skillManagerV2.pack.addSkills') }}</button>
              </div>
              <div v-else class="spp-member-list">
                <div
                  v-for="member in selectedPackDetail.members"
                  :key="member.skillId"
                  class="spp-member-row"
                  :class="{ missing: member.missing }"
                  :role="member.missing ? undefined : 'button'"
                  :tabindex="member.missing ? undefined : 0"
                  @click="handleMemberClick(member)"
                  @keydown.enter="handleMemberClick(member)"
                >
                  <span class="spp-member-mark" :class="{ missing: member.missing }">{{ getSkillGlyph(member.skillName.trim() || 'S') }}</span>
                  <div class="spp-member-info">
                    <strong>{{ member.skillName }}</strong>
                    <span>{{ member.skillId }}</span>
                  </div>
                  <span class="spp-status-pill" :class="member.missing ? 'missing' : 'ok'">
                    {{ member.missing ? t('skillManagerV2.pack.missing') : t('skillManagerV2.pack.ready') }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Applied Agents Section -->
            <div v-if="detailSection === 'agents'" class="spp-section-content">
              <div v-if="selectedPackDetail.appliedAgents.length === 0" class="spp-section-empty">
                <strong>{{ t('skillManagerV2.pack.noAppliedAgents') }}</strong>
                <span>{{ t('skillManagerV2.pack.noAppliedAgentsHint') }}</span>
                <button
                  class="spp-btn primary"
                  :disabled="busy || selectedPackDetail.members.length === 0"
                  @click="applyToAgents"
                >
                  {{ t('skillManagerV2.actions.applyPack') }}
                </button>
              </div>
              <div v-else class="spp-agent-list">
                <div
                  v-for="agent in selectedPackDetail.appliedAgents"
                  :key="agent.id"
                  class="spp-agent-row"
                >
                  <span class="spp-agent-glyph">{{ agent.displayName.slice(0, 2).toUpperCase() }}</span>
                  <div class="spp-agent-info">
                    <strong>{{ agent.displayName }}</strong>
                    <span v-if="agent.skillsDir">{{ agent.skillsDir }}</span>
                  </div>
                  <button
                    class="spp-btn danger sm"
                    :disabled="busy"
                    @click="openRevoke(selectedPackDetail.id, agent.id)"
                  >
                    {{ t('skillManagerV2.actions.removePack') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- Landing (no pack selected) -->
        <div v-else class="spp-landing">
          <div class="spp-landing-mark">PACK</div>
          <strong>{{ t('skillManagerV2.pack.landingTitle') }}</strong>
          <span>{{ t('skillManagerV2.pack.landingHint') }}</span>
          <button class="spp-btn primary" @click="startCreate">
            {{ t('skillManagerV2.actions.newPack') }}
          </button>
        </div>
      </main>
    </div>

    <!-- Apply Pack Dialog -->
    <ApplyPackDialog
      v-if="applyFor"
      :pack="applyFor"
      @close="applyFor = null"
      @done="onApplied"
    />

    <!-- Delete Pack Dialog -->
    <div v-if="deletePreview" class="spp-overlay" @click.self="deletePreview = null">
      <div class="spp-modal">
        <div class="spp-modal-header">
          <h3>{{ t('skillManagerV2.pack.deleteTitle', { name: deletePreview.packName }) }}</h3>
          <button class="spp-close-btn" @click="deletePreview = null">&times;</button>
        </div>
        <div class="spp-modal-body">
          <div v-if="deletePreview.warnings.length > 0" class="spp-warnings">
            <div v-for="(w, i) in deletePreview.warnings" :key="i" class="spp-warning-item">{{ w }}</div>
          </div>
          <div v-if="deletePreview.appliedAgents.length > 0" class="spp-modal-meta">
            {{ t('skillManagerV2.pack.appliedAgentList') }}: {{ deletePreview.appliedAgents.join('、') }}
          </div>
          <div v-if="deletePreview.affectedTargets.length > 0" class="spp-target-list">
            <div v-for="target in deletePreview.affectedTargets" :key="target.targetId" class="spp-target-row">
              <span>{{ target.agentId }}</span>
              <code>{{ target.targetPath }}</code>
              <span class="spp-claim-count">{{ target.claimCount }} claims</span>
            </div>
          </div>
        </div>
        <div class="spp-modal-footer">
          <button class="spp-btn" :disabled="busy" @click="deletePreview = null">{{ t('skillManagerV2.actions.cancel') }}</button>
          <button class="spp-btn danger" :disabled="busy || !deletePreview.removable" @click="confirmDelete">
            {{ busy ? t('common.processing') : t('skillManagerV2.pack.delete') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Revoke Pack Dialog -->
    <div v-if="revokePreview" class="spp-overlay" @click.self="revokePreview = null">
      <div class="spp-modal">
        <div class="spp-modal-header">
          <h3>{{ t('skillManagerV2.pack.revokeTitle', { agent: revokePreview.agentName, pack: revokePreview.packName }) }}</h3>
          <button class="spp-close-btn" @click="revokePreview = null">&times;</button>
        </div>
        <div class="spp-modal-body">
          <div class="spp-modal-meta">
            {{ t('skillManagerV2.pack.revokeSummary', {
              remove: revokePreview.willRemoveTargets,
              preserve: revokePreview.willPreserveTargets
            }) }}
          </div>
          <div v-if="revokePreview.affectedTargets.length > 0" class="spp-target-list">
            <div v-for="target in revokePreview.affectedTargets" :key="target.targetId" class="spp-target-row">
              <span>{{ target.agentId }}</span>
              <code>{{ target.targetPath }}</code>
              <span class="spp-claim-count">{{ target.claimCount }} claims</span>
            </div>
          </div>
        </div>
        <div class="spp-modal-footer">
          <button class="spp-btn" :disabled="busy" @click="revokePreview = null">{{ t('skillManagerV2.actions.cancel') }}</button>
          <button class="spp-btn danger" :disabled="busy" @click="confirmRevoke">
            {{ busy ? t('common.processing') : t('skillManagerV2.pack.revokeConfirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.spp-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px 20px;
  overflow: hidden;
}

.spp-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 0 4px 12px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;

  h2 {
    margin: 0;
    font-size: 21px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  p {
    margin: 3px 0 0;
    color: var(--text-muted);
    font-size: 12px;
  }
}

.spp-overview {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0;
  margin-top: 9px;
  color: var(--text-muted);
  font-size: 11px;

  > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  > span + span::before {
    content: '';
    width: 1px;
    height: 12px;
    margin: 0 10px;
    background: var(--border-default);
  }

  strong {
    color: var(--text-primary);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
}

.spp-overview-status {
  color: var(--success);
  font-weight: 700;

  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
}

.spp-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

// ── Notice ────────────────────────────────────────────────────────

.spp-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: rgba(5, 150, 105, 0.08);
  border: 1px solid rgba(5, 150, 105, 0.2);
  color: var(--success);
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.spp-notice-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
}

.spp-error {
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.2);
  color: var(--error);
  font-size: 12px;
  flex-shrink: 0;
}

// ── Layout ────────────────────────────────────────────────────────

.spp-layout {
  flex: 1;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}

// ── Sidebar ───────────────────────────────────────────────────────

.spp-sidebar {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.spp-side-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-soft);
  flex-shrink: 0;

  strong {
    display: block;
    font-size: 13px;
    font-weight: 700;
  }
  span {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
  }
}

.spp-count-badge {
  min-width: 22px;
  height: 20px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  padding: 0 6px;
}

.spp-search {
  margin: 10px 12px 0;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
  flex-shrink: 0;

  &:focus {
    border-color: var(--accent-primary);
  }
  &::placeholder {
    color: var(--text-muted);
  }
}

.spp-side-actions {
  padding: 8px 12px;
  flex-shrink: 0;
}

.spp-empty-side {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  text-align: center;

  strong {
    font-size: 13px;
    font-weight: 600;
  }
  span {
    font-size: 11px;
    color: var(--text-muted);
  }
}

.spp-pack-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.spp-pack-item {
  display: grid;
  grid-template-columns: 32px 1fr 14px;
  gap: 9px;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--border-default);
    background: var(--surface-soft);
  }
  &.active {
    border-color: var(--accent-primary-glow);
    background: var(--accent-primary-glow);
  }
}

.spp-pack-emblem {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 800;
  flex-shrink: 0;

  &.builtIn {
    background: color-mix(in srgb, var(--accent-primary) 10%, var(--surface-card));
    color: var(--accent-primary);
  }
}

.spp-pack-body {
  min-width: 0;
}

.spp-pack-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;

  strong {
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.spp-pack-health {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: var(--radius-full);

  &.ok {
    color: var(--success);
    background: rgba(5, 150, 105, 0.08);
  }
}

.spp-pack-desc {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spp-pack-meta {
  display: flex;
  gap: 8px;
  margin-top: 3px;
  font-size: 10px;
  color: var(--text-muted);
}

.spp-pack-arrow {
  color: var(--text-muted);
  font-size: 16px;
}

// ── Canvas ────────────────────────────────────────────────────────

.spp-canvas {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

// ── Landing ───────────────────────────────────────────────────────

.spp-landing {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 20px;
  text-align: center;

  strong {
    font-size: 15px;
    font-weight: 600;
  }
  span {
    font-size: 13px;
    color: var(--text-muted);
  }
}

.spp-landing-mark {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  font-size: 14px;
  font-weight: 800;
  margin-bottom: 6px;
}

// ── Detail ────────────────────────────────────────────────────────

.spp-detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.spp-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-soft);
  flex-shrink: 0;
}

.spp-detail-identity {
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 11px;
  align-items: center;
  min-width: 0;
}

.spp-detail-emblem {
  width: 42px;
  height: 42px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  font-size: 12px;
  font-weight: 800;
  flex-shrink: 0;

  &.builtIn {
    background: color-mix(in srgb, var(--success) 12%, var(--surface-card));
    color: var(--success);
  }
}

.spp-system-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 14px 0;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--success) 20%, var(--border-default));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--success) 7%, var(--bg-elevated));
  color: var(--text-muted);
  font-size: 11px;

  strong {
    color: var(--success);
    white-space: nowrap;
  }
}

.spp-detail-main {
  min-width: 0;

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  p {
    margin: 3px 0 0;
    color: var(--text-muted);
    font-size: 11px;
    overflow-wrap: anywhere;
  }
}

.spp-detail-kicker {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--accent-primary);
  margin-bottom: 2px;
}

.spp-detail-tags {
  display: flex;
  gap: 8px;
  margin-top: 5px;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--text-muted);
}

.spp-tag-chip {
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-secondary);
  font-weight: 600;
}

.spp-detail-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

// ── Buttons ───────────────────────────────────────────────────────

.spp-btn {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;

  &:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }
  &.primary {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: #fff;

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover);
    }
  }
  &.danger {
    border-color: rgba(220, 38, 38, 0.3);
    color: var(--error);

    &:hover:not(:disabled) {
      background: rgba(220, 38, 38, 0.06);
    }
  }
  &.sm {
    height: 26px;
    padding: 0 10px;
    font-size: 11px;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

// ── Section Tabs ──────────────────────────────────────────────────

.spp-section-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 14px 0;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;

  button {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--border-default);
    border-bottom: none;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    background: var(--surface-soft);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      color: var(--text-primary);
      background: var(--bg-elevated);
    }
    &.active {
      border-color: var(--border-default);
      border-bottom-color: var(--bg-elevated);
      background: var(--bg-elevated);
      color: var(--accent-primary);
      font-weight: 700;
    }
  }
}

.spp-section-content {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
}

.spp-section-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
  text-align: center;

  &.sm {
    padding: 20px 12px;
  }

  strong {
    font-size: 13px;
    font-weight: 600;
  }
  span {
    font-size: 11px;
    color: var(--text-muted);
  }
}

// ── Member List ───────────────────────────────────────────────────

.spp-member-list,
.spp-agent-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.spp-member-row {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  font-size: 12px;
  min-width: 0;
  cursor: pointer;
  transition: border-color .18s, background .18s;

  &:hover:not(.missing),
  &:focus-visible:not(.missing) {
    border-color: color-mix(in srgb, var(--accent-primary) 48%, var(--border-default));
    background: var(--bg-hover);
    outline: none;
  }

  &.missing {
    cursor: default;
    border-color: rgba(217, 119, 6, 0.25);
    background: rgba(217, 119, 6, 0.04);
  }
}

.spp-member-mark {
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--text-primary);
  color: var(--bg-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .02em;
  flex-shrink: 0;

  &.missing {
    background: var(--surface-card);
    color: var(--text-muted);
  }
}

.spp-member-info {
  min-width: 0;

  strong {
    display: block;
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  span {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
    overflow-wrap: anywhere;
  }
}

.spp-status-pill {
  min-width: 44px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;

  &.ok { color: var(--success); background: rgba(5, 150, 105, 0.08); }
  &.missing { color: var(--warning); background: rgba(217, 119, 6, 0.08); }
}

// ── Agent Row ─────────────────────────────────────────────────────

.spp-agent-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
  padding: 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  min-width: 0;
}

.spp-agent-glyph {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 800;
  flex-shrink: 0;
}

.spp-agent-info {
  min-width: 0;

  strong {
    display: block;
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  span {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
    overflow-wrap: anywhere;
  }
}

// ── Overlay & Modal ───────────────────────────────────────────────

.spp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.spp-modal {
  background: var(--bg-primary);
  border-radius: var(--radius-lg, 12px);
  width: 560px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);

  &.spp-modal-lg {
    width: 640px;
  }
}

.spp-builder-overlay {
  padding: 20px;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(5px);
}

.spp-builder-modal {
  width: min(1080px, 100%);
  height: min(760px, 100%);
  max-height: none;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg, 14px);
}

.spp-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-default);

  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
  }
}

.spp-close-btn {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-muted);
  padding: 0 4px;

  &:hover {
    color: var(--text-primary);
  }
}

.spp-modal-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.spp-modal-meta {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.spp-warnings {
  margin-bottom: 10px;
}

.spp-warning-item {
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: rgba(217, 119, 6, 0.08);
  border: 1px solid rgba(217, 119, 6, 0.2);
  color: var(--warning);
  font-size: 12px;
  margin-bottom: 4px;
}

.spp-target-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.spp-target-row {
  display: grid;
  grid-template-columns: 100px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  font-size: 11px;

  code {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.spp-claim-count {
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
}

.spp-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--border-default);
}

@media (max-width: 820px) {
  .spp-page { padding: 12px; }
  .spp-header { align-items: stretch; flex-direction: column; }
  .spp-header-actions { justify-content: flex-start; }
  .spp-layout { grid-template-columns: 1fr; overflow-y: auto; }
  .spp-sidebar { min-height: 220px; }
  .spp-canvas { min-height: 520px; }
  .spp-builder-overlay { padding: 0; }
  .spp-builder-modal { width: 100%; height: 100%; border-radius: 0; }
}

.spp-detail-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}
</style>
