<template>
  <div class="builtin-section">
    <div class="builtin-header" @click="expanded = !expanded">
      <div class="builtin-header-left">
        <div class="s-panel-icon engine"><Package :size="14" /></div>
        <span class="s-panel-title">{{ t('hookSettings.builtin.title') }}</span>
        <span class="builtin-badge" v-if="store.enabledCount">{{ store.enabledCount }}</span>
        <span class="builtin-hint">{{ t('hookSettings.builtin.subtitle') }}</span>
      </div>
      <div class="builtin-header-right">
        <ChevronDown :size="16" class="s-expand-icon" :class="{ rotated: expanded }" />
      </div>
    </div>

    <div v-if="expanded" class="builtin-body">
      <p class="builtin-desc">{{ t('hookSettings.builtin.description') }}</p>

      <div class="builtin-list">
        <div
          v-for="hook in store.definitions"
          :key="hook.id"
          class="builtin-card"
          :class="{
            enabled: store.getState(hook.id).enabled,
            configured: store.isConfigured(hook.id),
          }"
        >
          <div class="builtin-card-main">
            <div class="builtin-toggle"
              :class="{ on: store.getState(hook.id).enabled }"
              @click="onToggle(hook.id)"
              :title="store.getState(hook.id).enabled ? t('hookSettings.builtin.disable') : t('hookSettings.builtin.enable')"
            ></div>

            <div class="builtin-icon">
              <component :is="hook.icon" :size="18" />
            </div>

            <div class="builtin-info">
              <div class="builtin-name">{{ t(`hookSettings.builtin.${hook.id}.name`, hook.name) }}</div>
              <div class="builtin-desc-text">{{ t(`hookSettings.builtin.${hook.id}.description`, hook.description) }}</div>
            </div>

            <div class="builtin-tags">
              <span class="tag tag-event">{{ hook.event }}</span>
              <span class="tag tag-timeout">{{ t('hookSettings.timeout') }} {{ hook.timeout ?? 30 }}s</span>
              <span class="tag tag-category" :class="`cat-${hook.category}`">
                {{ t(`hookSettings.builtin.cat.${hook.category}`) }}
              </span>
            </div>

            <div class="builtin-actions">
              <button
                v-if="store.getState(hook.id).enabled"
                class="s-btn btn-sm btn-outline"
                @click="onConfigure(hook.id)"
              >
                <Settings :size="13" />
                {{ t('hookSettings.builtin.configureAction') }}
              </button>
              <button
                v-else
                class="s-btn btn-sm btn-primary"
                @click="onConfigure(hook.id)"
              >
                <Settings :size="13" />
                {{ t('hookSettings.builtin.configureAction') }}
              </button>
            </div>
          </div>

          <!-- 已启用时显示当前 provider 状态 -->
          <div v-if="store.getState(hook.id).enabled" class="builtin-card-footer">
            <div class="status-row">
              <CheckCircle :size="12" class="status-icon active" />
              <span class="status-text">
                {{ t('hookSettings.builtin.runningVia') }}
                <strong>{{ getProviderLabel(hook.id) }}</strong>
              </span>
            </div>
          </div>
          <div v-else-if="store.isConfigured(hook.id)" class="builtin-card-footer">
            <div class="status-row">
              <AlertCircle :size="12" class="status-icon idle" />
              <span class="status-text idle">{{ t('hookSettings.builtin.configuredButDisabled') }}</span>
            </div>
          </div>
          <div v-else class="builtin-card-footer">
            <div class="status-row">
              <span class="status-text muted">{{ t('hookSettings.builtin.notConfigured') }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 配置弹窗 -->
    <BuiltinHookConfigModal
      v-if="configModalId"
      :builtin-id="configModalId"
      :initial-provider-id="editDefaults.providerId"
      :initial-config="editDefaults.config"
      :initial-scope="editDefaults.scope"
      @apply="onApplyConfig"
      @close="configModalId = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { Package, ChevronDown, Settings, CheckCircle, AlertCircle } from 'lucide-vue-next'
import { getBuiltinProvider } from '@/types/builtinHooks'
import type { HookScope } from '@/types/hooks'
import { useBuiltinHooksStore } from '@/stores/builtinHooks'
import BuiltinHookConfigModal from './BuiltinHookConfigModal.vue'

const { t } = useI18n()
const store = useBuiltinHooksStore()

const expanded = ref(true)
const configModalId = ref<string | null>(null)

interface EditDefaults {
  providerId: string
  config: Record<string, string>
  scope: HookScope
}

const editDefaults = reactive<EditDefaults>({
  providerId: '',
  config: {},
  scope: 'user',
})

function getProviderLabel(builtinId: string): string {
  const st = store.getState(builtinId)
  if (!st.providerId) return ''
  const p = getBuiltinProvider(builtinId, st.providerId)
  return p?.label ?? st.providerId
}

function onConfigure(builtinId: string) {
  const st = store.getState(builtinId)
  editDefaults.providerId = st.providerId
  editDefaults.config = { ...st.config }
  editDefaults.scope = st.scope || 'user'
  configModalId.value = builtinId
}

async function onToggle(builtinId: string) {
  const st = store.getState(builtinId)
  if (st.enabled) {
    await store.disable(builtinId)
  } else {
    if (!store.isConfigured(builtinId)) {
      // 未配置 -> 弹窗
      onConfigure(builtinId)
      return
    }
    const result = await store.enable(builtinId)
    if (!result.ok) {
      // 配置不完整 -> 弹窗
      onConfigure(builtinId)
    }
  }
}

async function onApplyConfig(
  builtinId: string,
  providerId: string,
  config: Record<string, string>,
  scope: HookScope,
) {
  const st = store.getState(builtinId)
  if (st.enabled) {
    await store.reconfigure(builtinId, providerId, config, scope)
  } else {
    await store.applyAndEnable(builtinId, providerId, config, scope)
  }
  configModalId.value = null
}
</script>

<style lang="scss" scoped>
.builtin-section {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface-card);
}

.builtin-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; cursor: pointer;
  &:hover { background: var(--bg-hover); }
}
.builtin-header-left {
  display: flex; align-items: center; gap: 8px;
}
.s-panel-icon {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 8px;
  &.engine { background: var(--accent-primary-glow); color: var(--accent-primary); }
}
.s-panel-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.builtin-badge {
  font-size: 10px; background: var(--accent-primary); color: white;
  padding: 1px 6px; border-radius: 4px; font-weight: 600;
}
.builtin-hint { font-size: 11px; color: var(--text-muted); }
.builtin-header-right {
  display: flex; align-items: center;
}
.s-expand-icon { color: var(--text-muted); transition: transform 0.2s; &.rotated { transform: rotate(180deg); } }

.builtin-body {
  padding: 0 16px 16px;
  border-top: 1px solid var(--border-default);
}
.builtin-desc { font-size: 12px; color: var(--text-muted); line-height: 1.5; margin: 12px 0; }

.builtin-list { display: flex; flex-direction: column; gap: 8px; }

.builtin-card {
  border: 1px solid var(--border-default); border-radius: 10px;
  overflow: hidden; transition: all 0.15s;
  &.enabled { border-color: var(--accent-primary-glow); background: var(--accent-primary-glow); }
  &.configured { border-color: var(--border-strong); }
}
.builtin-card-main {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
}
.builtin-toggle {
  position: relative; width: 36px; height: 20px; border-radius: 10px;
  background: var(--border-default); cursor: pointer; transition: all var(--transition-fast); flex-shrink: 0;
  &.on { background: var(--accent-primary); }
  &::after {
    content: ''; position: absolute; top: 2px; left: 2px;
    width: 16px; height: 16px; border-radius: 50%; background: var(--bg-elevated); transition: all var(--transition-fast);
  }
  &.on::after { left: 18px; }
}
.builtin-icon {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 8px;
  background: var(--accent-primary-glow); color: var(--accent-primary); flex-shrink: 0;
}
.builtin-info { flex: 1; min-width: 0; }
.builtin-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.builtin-desc-text { font-size: 11px; color: var(--text-muted); line-height: 1.4; }

.builtin-tags { display: flex; gap: 4px; flex-shrink: 0; }
.tag {
  display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 500;
  &.tag-event { background: var(--accent-primary-glow); color: var(--accent-primary); }
  &.tag-timeout { background: var(--surface-soft); color: var(--text-muted); }
  &.tag-category {
    &.cat-notification { background: var(--accent-secondary-glow); color: var(--accent-secondary); }
    &.cat-safety { background: var(--warning-glow); color: var(--warning); }
    &.cat-workflow { background: var(--accent-tertiary-glow, rgba(124,58,237,0.12)); color: var(--accent-tertiary); }
  }
}

.builtin-actions { flex-shrink: 0; }
.btn-sm {
  @include reset-button;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px; border-radius: 6px; font-size: 11px; font-weight: 500;
  transition: all 0.15s;
}
.btn-primary {
  background: var(--accent-primary); color: white;
  &:hover { background: var(--accent-primary-hover); }
}
.btn-outline {
  background: transparent; border: 1px solid var(--border-default); color: var(--text-secondary);
  &:hover { border-color: var(--border-strong); color: var(--text-primary); background: var(--bg-hover); }
}

.builtin-card-footer {
  padding: 8px 14px;
  border-top: 1px solid var(--border-default);
  background: var(--surface-soft);
}
.status-row {
  display: flex; align-items: center; gap: 6px;
}
.status-icon {
  flex-shrink: 0;
  &.active { color: var(--accent-primary); }
  &.idle { color: var(--warning); }
}
.status-text {
  font-size: 11px; color: var(--text-secondary);
  strong { color: var(--text-primary); }
  &.idle { color: var(--warning); }
  &.muted { color: var(--text-muted); }
}
</style>