<template>
  <div class="mcp-manager">
    <!-- Fixed header -->
    <div class="mcp-header">
      <div class="header-content">
        <div class="header-left">
          <button class="back-btn" @click="handleClose" :title="t('mcpSettings.backToChat')">
            <ArrowLeft :size="18" />
          </button>
          <div>
            <h1 class="title">
              {{ t('mcpSettings.title') }}
              <span v-if="serverCount > 0" class="server-count">({{ serverCount }})</span>
            </h1>
            <p class="description">{{ t('mcpSettings.description') }}</p>
          </div>
        </div>
        <button class="btn btn-primary" @click="handleAdd">
          <Plus :size="14" />
          {{ t('mcpSettings.addServer') }}
        </button>
      </div>
    </div>

    <!-- Scrollable content -->
    <div class="mcp-content">
      <div v-if="error" class="error-banner">
        <p>{{ error }}</p>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button
          class="tab-btn"
          :class="{ active: tab === 'list' }"
          @click="tab = 'list'"
        >
          <List :size="14" />
          {{ t('mcpSettings.tabList') }}
        </button>
        <button
          class="tab-btn"
          :class="{ active: tab === 'json' }"
          @click="tab = 'json'"
        >
          <Code :size="14" />
          {{ t('mcpSettings.tabJson') }}
        </button>
      </div>

      <!-- List Tab -->
      <div v-if="tab === 'list'" class="tab-content">
        <div v-if="loading" class="loading-state">
          <Loader2 :size="16" class="spin" />
          <p>{{ t('mcpSettings.loadingServers') }}</p>
        </div>
        <template v-else>
          <!-- Built-in MCP Servers -->
          <section v-if="builtinEntries.length > 0" class="builtin-section">
            <div class="builtin-header">
              <div class="builtin-title">
                <Boxes :size="16" />
                <span>{{ t('mcpSettings.builtinTitle') }}</span>
              </div>
              <span class="builtin-subtitle">{{ t('mcpSettings.builtinSubtitle') }}</span>
            </div>

            <div class="builtin-grid">
              <div
                v-for="entry in builtinEntries"
                :key="entry.preset.key"
                class="builtin-card"
                :class="{ enabled: entry.enabled }"
              >
                <div class="builtin-card-top">
                  <div class="builtin-card-head">
                    <div class="builtin-card-title-row">
                      <span class="builtin-card-name">{{ entry.preset.name }}</span>
                      <span class="builtin-badge">{{ t('mcpSettings.builtinBadge') }}</span>
                      <span
                        v-if="entry.probe"
                        class="builtin-status"
                        :class="entry.probe.status"
                      >
                        <Loader2 v-if="entry.probe.status === 'probing'" :size="10" class="spin" />
                        {{ builtinStatusLabel(entry.probe.status) }}
                      </span>
                    </div>
                    <a
                      :href="entry.preset.homepage"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="builtin-homepage"
                      :title="entry.preset.homepage"
                    >
                      <ExternalLink :size="12" />
                    </a>
                  </div>
                  <p class="builtin-desc">{{ builtinPresetDesc(entry.preset.key) }}</p>
                  <div class="builtin-command">
                    <span class="mono">{{ entry.command }} {{ entry.args.join(' ') }}</span>
                  </div>

                  <!-- 依赖状态 / 一键安装 -->
                  <div v-if="entry.depCommand" class="builtin-dep">
                    <!-- 安装进行中 -->
                    <template v-if="entry.isInstallingDep">
                      <div class="builtin-dep-row installing">
                        <Loader2 :size="12" class="spin" />
                        <span class="builtin-dep-cmd">{{ entry.depCommand }}</span>
                        <span class="builtin-dep-msg">
                          {{ entry.installProgress?.message || t('mcpSettings.installingDependency') }}
                        </span>
                      </div>
                      <div v-if="entry.installProgress?.percent != null" class="builtin-dep-bar">
                        <div
                          class="builtin-dep-bar-fill"
                          :style="{ width: `${entry.installProgress.percent}%` }"
                        />
                      </div>
                    </template>

                    <!-- 检测中（首次加载，store 尚未返回） -->
                    <div
                      v-else-if="entry.depStatus === null"
                      class="builtin-dep-row checking"
                    >
                      <Loader2 :size="12" class="spin" />
                      <span class="builtin-dep-cmd">{{ entry.depCommand }}</span>
                      <span class="builtin-dep-msg">{{ t('mcpSettings.depChecking') }}</span>
                    </div>

                    <!-- 依赖已装 -->
                    <div
                      v-else-if="entry.depStatus?.available"
                      class="builtin-dep-row ok"
                    >
                      <CheckCircle2 :size="12" />
                      <span class="builtin-dep-cmd">{{ entry.depCommand }}</span>
                      <span class="builtin-dep-msg">{{ dependencyStatusLabel(entry.depStatus) }}</span>
                    </div>

                    <!-- 依赖缺失：一键安装 OR 外链 -->
                    <div v-else class="builtin-dep-row missing">
                      <XCircle :size="12" />
                      <span class="builtin-dep-cmd">{{ entry.depCommand }}</span>
                      <span class="builtin-dep-msg">{{ t('mcpSettings.depMissing') }}</span>
                      <button
                        v-if="entry.preset.dependency?.installer"
                        class="builtin-dep-install-btn"
                        :disabled="!!mcpStore.installingDependency"
                        :title="t('mcpSettings.depInstallHint', { command: entry.preset.dependency.installer })"
                        @click="handleInstallDependency(entry.preset.key)"
                      >
                        <Download :size="11" />
                        {{ t('mcpSettings.installDependency') }}
                      </button>
                      <button
                        v-else-if="entry.preset.dependency?.installerDocs"
                        class="builtin-dep-install-btn external"
                        @click="handleInstallDependency(entry.preset.key)"
                      >
                        <ExternalLink :size="11" />
                        {{ entry.depCommand === 'npx'
                          ? t('mcpSettings.installNodejs')
                          : t('mcpSettings.installDependency') }}
                      </button>
                    </div>

                    <!-- 安装出错 -->
                    <p
                      v-if="!entry.isInstallingDep && mcpStore.installError && entry.preset.dependency?.installer && mcpStore.installingDependency === null && entry.depStatus && !entry.depStatus.available"
                      class="builtin-dep-error"
                    >
                      {{ t('mcpSettings.installFailed') }}: {{ mcpStore.installError }}
                    </p>
                  </div>

                  <p v-else-if="entry.preset.requirements" class="builtin-req">
                    {{ t('mcpSettings.builtinRequirements') }}: {{ entry.preset.requirements }}
                  </p>
                </div>

                <div class="builtin-card-bottom">
                  <button
                    class="builtin-test-btn"
                    :disabled="entry.probe?.status === 'probing'"
                    @click="handleBuiltinProbe(entry.preset.key)"
                  >
                    <Loader2 v-if="entry.probe?.status === 'probing'" :size="12" class="spin" />
                    <Zap v-else :size="12" />
                    {{ t('mcpSettings.testConnection') }}
                  </button>
                  <label class="builtin-toggle">
                    <input
                      type="checkbox"
                      :checked="entry.enabled"
                      @change="handleBuiltinToggle(entry.preset.key, ($event.target as HTMLInputElement).checked)"
                    />
                    <span class="builtin-toggle-label">
                      {{ entry.enabled ? t('mcpSettings.enabled') : t('mcpSettings.disabled') }}
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </section>

          <!-- User-defined servers -->
          <div class="user-section-title" v-if="Object.keys(userServers).length > 0 || !loading">
            {{ t('mcpSettings.yourServers') }}
          </div>
          <McpServerList
            :servers="userServers"
            @edit="handleEdit"
            @delete="handleDelete"
            @toggle-enabled="handleToggleEnabled"
            @reconnect="handleReconnect"
          />
        </template>
      </div>

      <!-- JSON Tab -->
      <div v-else class="tab-content">
        <p v-if="hasClaudeJsonServers || hasBuiltinServers" class="json-hint">
          {{ t('mcpSettings.jsonTabNote') }}
        </p>
        <ConfigEditor
          :value="jsonConfig"
          label="Server Configuration"
          @save="handleJsonSave"
        />
      </div>

      <!-- Runtime Status Section -->
      <div class="runtime-section">
        <div class="runtime-header">
          <div class="runtime-title">
            <Wifi :size="16" />
            <span>{{ t('mcpSettings.runtimeStatus') }}</span>
          </div>
          <button
            class="refresh-btn"
            @click="fetchRuntimeStatus"
            :disabled="runtimeLoading"
          >
            <Loader2 v-if="runtimeLoading" :size="12" class="spin" />
            <RefreshCw v-else :size="12" />
            {{ t('mcpSettings.refresh') }}
          </button>
        </div>

        <div v-if="!activeSessionId && !runtimeLoading && probeResultCount === 0" class="runtime-empty runtime-hint">
          <Info :size="14" />
          <div>
            <div class="runtime-hint-title">{{ t('mcpSettings.noActiveSession') }}</div>
            <div class="runtime-hint-desc">
              {{ t('mcpSettings.noActiveSessionDesc') }}
            </div>
          </div>
        </div>
        <div v-else-if="runtimeStatus.length === 0 && probeResultCount === 0" class="runtime-empty">
          {{ t('mcpSettings.noRuntimeStatus') }}
        </div>
        <div v-else class="runtime-list">
          <!-- Merge engine runtime + probe results -->
          <div
            v-for="item in mergedRuntimeItems"
            :key="item.name"
            class="runtime-item"
          >
            <button
              class="runtime-summary"
              :class="{ open: expanded[item.name] }"
              @click="toggleExpand(item.name)"
            >
              <ChevronRight :size="12" class="chev" />
              <span class="status-dot" :class="item.status" aria-hidden="true" />
              <span class="server-name">{{ item.name }}</span>
              <span v-if="item.toolCount > 0" class="tool-count">
                {{ item.toolCount }} {{ t('mcpSettings.tools') }}
              </span>
              <span class="status-badge" :class="item.status">
                {{ item.statusLabel }}
              </span>
            </button>
            <ul v-if="expanded[item.name]" class="tool-list">
              <li
                v-if="item.status === 'connected' && item.toolCount === 0"
                class="tool-empty"
              >
                {{ t('mcpSettings.noToolsReported') }}
              </li>
              <li
                v-else-if="item.status === 'failed'"
                class="tool-error"
              >
                {{ getProbeError(item.name) || t('mcpSettings.connectionFailed') }}
              </li>
              <li
                v-else-if="item.status !== 'connected' && item.status !== 'probing'"
                class="tool-empty"
              >
                {{ t('mcpSettings.toolsUnavailable') }}
              </li>
              <li
                v-for="tool in item.tools"
                :key="tool.name"
                class="tool-row"
              >
                <span class="tool-name">{{ tool.name }}</span>
                <span class="tool-desc">{{ tool.description || t('mcpSettings.noDescription') }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- Server Editor Modal -->
    <McpServerEditor
      v-model:open="editorOpen"
      :name="editingName"
      :server="editingServer"
      @save="handleSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Plus, List, Code, Loader2, Wifi, RefreshCw, ArrowLeft, ChevronRight, Info,
  ExternalLink, Boxes, Zap, CheckCircle2, XCircle, Download
} from 'lucide-vue-next'
import { useMcpStore, type McpToolInfo, type MCPServer } from '@/stores/mcp'
import { useAppStore } from '@/stores/app'
import { BUILTIN_MCP_PRESETS, findBuiltinPreset } from '@/lib/builtinMcp'
import { useDialog } from '@/composables/useDialog'
import McpServerList from './McpServerList.vue'
import McpServerEditor from './McpServerEditor.vue'
import ConfigEditor from './ConfigEditor.vue'

const { t } = useI18n()
const mcpStore = useMcpStore()
const appStore = useAppStore()
const { showAlert, showConfirm } = useDialog()

const tab = ref<'list' | 'json'>('list')
const editorOpen = ref(false)
const editingName = ref<string | undefined>()
const editingServer = ref<MCPServer | undefined>()
const expanded = reactive<Record<string, boolean>>({})

const servers = computed(() => mcpStore.servers)
const serverList = computed(() => mcpStore.serverList)
const loading = computed(() => mcpStore.loading)
const runtimeLoading = computed(() => mcpStore.runtimeLoading)
const error = computed(() => mcpStore.error)
const runtimeStatus = computed(() => mcpStore.runtimeStatus)
const activeSessionId = computed(() => mcpStore.activeSessionId)
const serverCount = computed(() => mcpStore.serverCount)

const probeResultCount = computed(() => Object.keys(mcpStore.probeResults).length)

interface MergedRuntimeItem {
  name: string
  status: string
  statusLabel: string
  toolCount: number
  tools: McpToolInfo[]
}

const mergedRuntimeItems = computed<MergedRuntimeItem[]>(() => {
  const map = new Map<string, MergedRuntimeItem>()

  // 1) 先放 engine runtime status
  for (const s of runtimeStatus.value) {
    map.set(s.name, {
      name: s.name,
      status: s.status,
      statusLabel: s.status,
      toolCount: s.tools?.length ?? 0,
      tools: s.tools ?? [],
    })
  }

  // 2) 再用 probe 结果覆盖（probe 有 description，engine 没有）
  for (const [name, probe] of Object.entries(mcpStore.probeResults)) {
    const existing = map.get(name)
    if (probe.status === 'probing') {
      map.set(name, {
        name,
        status: 'probing',
        statusLabel: t('mcpSettings.testing'),
        toolCount: existing?.toolCount ?? 0,
        tools: existing?.tools ?? [],
      })
    } else if (probe.status === 'connected') {
      map.set(name, {
        name,
        status: 'connected',
        statusLabel: t('mcpSettings.connectedTested'),
        toolCount: probe.tools?.length ?? 0,
        tools: probe.tools ?? [],
      })
    } else {
      map.set(name, {
        name,
        status: 'failed',
        statusLabel: t('mcpSettings.failed'),
        toolCount: 0,
        tools: [],
      })
    }
  }

  return Array.from(map.values())
})

const hasClaudeJsonServers = computed(() =>
  Object.values(servers.value).some(s => s._source === 'claude.json')
)

const hasBuiltinServers = computed(() =>
  Object.values(servers.value).some(s => s._source === 'builtin')
)

/** 内置 MCP 预设 + 当前启用状态的合并视图，供「内置 MCP」面板渲染 */
const builtinEntries = computed(() => {
  return BUILTIN_MCP_PRESETS.map(preset => {
    const server = servers.value[preset.key]
    const depCmd = preset.dependency?.command
    // 依赖状态：null 表示尚未检测过（首次加载），undefined 表示无依赖声明
    const depStatus = depCmd ? mcpStore.dependencyStatus[depCmd] ?? null : undefined
    const isInstallingThis = !!(
      preset.dependency?.installer &&
      mcpStore.installingDependency === preset.dependency.installer
    )
    return {
      preset,
      enabled: server ? server.enabled !== false : false,
      // 用户可能修改过 command/args，展示实际配置而非预设默认值
      command: server?.command || preset.config.command || '',
      args: server?.args || preset.config.args || [],
      // 运行时状态（用于在面板上展示连接结果）
      runtime: mcpStore.getRuntimeStatusForServer(preset.key),
      probe: mcpStore.getProbeResult(preset.key),
      // 依赖检测 / 安装状态
      depCommand: depCmd,
      depStatus,
      isInstallingDep: isInstallingThis,
      installProgress: isInstallingThis ? mcpStore.installProgress : null,
    }
  })
})

/** 用户自建服务器（排除 claude.json 只读项与内置预设），传给 McpServerList */
const userServers = computed(() => {
  const result: Record<string, MCPServer> = {}
  for (const [name, server] of Object.entries(servers.value)) {
    if (server._source === 'builtin') continue
    result[name] = server
  }
  return result
})

function handleClose() {
  appStore.showMCPManager = false
}

const jsonConfig = computed(() => {
  const filtered = Object.fromEntries(
    Object.entries(servers.value)
      .filter(([, v]) => v._source !== 'claude.json' && v._source !== 'builtin')
      .map(([k, v]) => {
        const { _source, id, name, ...rest } = v
        return [k, rest]
      })
  )
  return JSON.stringify(filtered, null, 2)
})

function handleAdd() {
  editingName.value = undefined
  editingServer.value = undefined
  editorOpen.value = true
}

function handleEdit(name: string, server: MCPServer) {
  editingName.value = name
  editingServer.value = server
  editorOpen.value = true
}

async function handleDelete(name: string) {
  if (!await showConfirm(t('mcpSettings.deleteConfirm', { name }), { variant: 'danger' })) return
  try {
    await mcpStore.deleteServer(name)
  } catch (err) {
    console.error('Failed to delete server:', err)
    if (err instanceof Error && err.message === 'builtinServerCannotDelete') {
      await showAlert(t('mcpSettings.builtinCannotDelete'))
    } else {
      await showAlert(err instanceof Error ? err.message : t('mcpSettings.deleteFailed'))
    }
  }
}

async function handleToggleEnabled(name: string, enabled: boolean) {
  try {
    await mcpStore.toggleServerEnabled(name, enabled)
  } catch (err) {
    console.error('Failed to toggle server:', err)
  }
}

/** 内置 MCP 开关。首次开启时确保服务器记录存在（store 已注入），直接切换 enabled。 */
async function handleBuiltinToggle(key: string, enabled: boolean) {
  try {
    await mcpStore.toggleServerEnabled(key, enabled)
    // 开启后自动探测一次，让用户立刻看到连接结果
    if (enabled) {
      mcpStore.probeServer(key)
    }
  } catch (err) {
    console.error('Failed to toggle builtin MCP:', err)
  }
}

/** 对内置 MCP 执行一次连接测试 */
function handleBuiltinProbe(key: string) {
  mcpStore.probeServer(key)
}

/**
 * 一键安装某个内置 MCP 所缺失的依赖（如 uv → uvx）。
 *
 * 没有 installer 字段（如 chrome-devtools 缺 npx）的预设走外链分支，
 * 直接打开官方下载页让用户手动装；store 那一层不接这种情况。
 */
async function handleInstallDependency(presetKey: string) {
  const preset = findBuiltinPreset(presetKey)
  if (!preset?.dependency) return

  // 无 installer：打开外链让用户自己装
  if (!preset.dependency.installer) {
    if (preset.dependency.installerDocs) {
      window.open(preset.dependency.installerDocs, '_blank', 'noopener,noreferrer')
    }
    return
  }

  // 防止同时点多次：installingDependency 非空时 store 会直接拒绝
  if (mcpStore.installingDependency) return

  const result = await mcpStore.installDependency(preset.dependency.installer)
  if (!result.success && result.error) {
    console.warn(`Failed to install ${preset.dependency.installer}:`, result.error)
    // 失败时回退到外链（store 里 cliDetector 已经 openExternal 过一次，这里
    // 仅在 store 调用都没成功的情况下再兜底，避免用户看不到任何反馈）
    if (preset.dependency.installerDocs) {
      window.open(preset.dependency.installerDocs, '_blank', 'noopener,noreferrer')
    }
  }
}

/** 依赖状态文案：null = 检测中；命中字段后按是否 available 取文案 */
function dependencyStatusLabel(
  depStatus: { available: boolean; version: string | null } | null | undefined
): string {
  if (depStatus === null) return t('mcpSettings.depChecking')
  if (!depStatus) return ''
  if (depStatus.available) {
    return depStatus.version
      ? `${t('mcpSettings.depInstalled')} · ${depStatus.version.replace(/^[a-zA-Z]+\s*/, '')}`
      : t('mcpSettings.depInstalled')
  }
  return t('mcpSettings.depMissing')
}

/** 内置 MCP 卡片上的状态文案 */
function builtinStatusLabel(status: 'connected' | 'failed' | 'probing'): string {
  switch (status) {
    case 'connected': return t('mcpSettings.connected')
    case 'failed': return t('mcpSettings.failed')
    case 'probing': return t('mcpSettings.testing')
    default: return status
  }
}

/** 取内置 MCP 的描述文案（i18n，回退到预设默认值） */
function builtinPresetDesc(key: string): string {
  const preset = findBuiltinPreset(key)
  if (!preset) return ''
  // 优先使用 i18n 文案（mcpSettings.builtin.<key>Desc），找不到再回退到预设默认描述
  const i18nKey = `mcpSettings.builtin.${key}Desc`
  const translated = t(i18nKey)
  return translated === i18nKey ? preset.description : translated
}

async function handleSave(name: string, server: Omit<MCPServer, 'id' | 'name'>) {
  try {
    if (editingName.value && editingName.value !== name) {
      await mcpStore.updateServer(name, server, editingName.value)
    } else if (editingName.value) {
      await mcpStore.updateServer(name, server)
    } else {
      await mcpStore.addServer(name, server)
    }
    editorOpen.value = false
  } catch (err) {
    console.error('Failed to save server:', err)
    await showAlert(err instanceof Error ? err.message : t('mcpSettings.saveFailed'))
  }
}

async function handleJsonSave(jsonStr: string) {
  try {
    await mcpStore.saveJsonConfig(jsonStr)
  } catch (err) {
    console.error('Failed to save config:', err)
    await showAlert(err instanceof Error ? err.message : t('mcpSettings.saveConfigFailed'))
  }
}

async function handleReconnect(name: string) {
  try {
    await mcpStore.reconnectServer(name)
    await mcpStore.fetchRuntimeStatus()
  } catch (err) {
    console.error('Failed to reconnect server:', err)
    await showAlert(err instanceof Error ? err.message : t('mcpSettings.reconnectFailed'))
  }
}

async function fetchRuntimeStatus() {
  await mcpStore.fetchRuntimeStatus()
}

function toggleExpand(name: string) {
  expanded[name] = !expanded[name]
}

function getProbeError(name: string): string | undefined {
  return mcpStore.probeResults[name]?.error
}

onMounted(() => {
  mcpStore.fetchServers()
  mcpStore.fetchRuntimeStatus()
})
</script>

<style lang="scss" scoped>
.mcp-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.mcp-header {
  flex-shrink: 0;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-secondary);
}

.header-content {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.server-count {
  font-size: var(--font-size-base);
  font-weight: 400;
  color: var(--text-muted);
  margin-left: 8px;
}

.description {
  font-size: 13px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

.mcp-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.error-banner {
  padding: 12px 16px;
  background: rgba(220, 53, 69, 0.1);
  border-radius: var(--radius-md);
  margin-bottom: 16px;

  p {
    font-size: 13px;
    color: var(--error);
    margin: 0;
  }
}

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }
}

.tab-content {
  margin-bottom: 24px;
}

/* ── Built-in MCP Servers section ── */
.builtin-section {
  margin-bottom: 24px;
}

.builtin-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.builtin-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);

  svg {
    color: var(--accent-primary);
  }
}

.builtin-subtitle {
  font-size: 11px;
  color: var(--text-muted);
}

.builtin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}

.builtin-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 14px;
  transition: border-color var(--transition-fast);

  &:hover {
    border-color: var(--accent-primary);
  }

  &.enabled {
    border-color: rgba(16, 185, 129, 0.5);
  }
}

.builtin-card-top {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.builtin-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.builtin-card-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.builtin-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.builtin-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(var(--accent-primary-rgb), 0.15);
  color: var(--accent-primary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.builtin-status {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border-default);

  &.connected {
    color: #10b981;
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.1);
  }

  &.failed {
    color: var(--error);
    border-color: var(--error);
    background: rgba(220, 53, 69, 0.1);
  }

  &.probing {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.1);
  }
}

.builtin-homepage {
  display: inline-flex;
  color: var(--text-muted);
  flex-shrink: 0;
  padding: 2px;
  border-radius: 4px;
  transition: all var(--transition-fast);

  &:hover {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }
}

.builtin-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin: 0;
}

.builtin-command {
  font-size: 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  padding: 4px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  .mono {
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
    color: var(--text-muted);
  }
}

.builtin-req {
  font-size: 10px;
  color: var(--text-muted);
  margin: 0;
  font-style: italic;
}

/* 依赖状态行（替代静态 builtin-req） */
.builtin-dep {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.builtin-dep-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  line-height: 1.4;

  &.ok { color: #10b981; }
  &.missing { color: var(--error); }
  &.checking { color: var(--text-muted); }
  &.installing { color: var(--accent-primary); }
}

.builtin-dep-cmd {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--bg-primary);
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.builtin-dep-msg {
  color: var(--text-secondary);
}

.builtin-dep-row.ok .builtin-dep-msg { color: var(--text-secondary); }
.builtin-dep-row.missing .builtin-dep-msg { color: var(--error); }

.builtin-dep-install-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  border: 1px solid var(--accent-primary);
  background: var(--accent-primary);
  color: var(--bg-primary);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.external {
    background: transparent;
    color: var(--accent-primary);
  }
}

.builtin-dep-bar {
  height: 3px;
  background: var(--bg-primary);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 2px;
}

.builtin-dep-bar-fill {
  height: 100%;
  background: var(--accent-primary);
  transition: width 0.2s ease;
}

.builtin-dep-error {
  font-size: 10px;
  color: var(--error);
  margin: 0;
  line-height: 1.4;
}

.builtin-card-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-default);
}

.builtin-test-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-xs);
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: wait;
  }
}

.builtin-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;

  input[type="checkbox"] {
    width: 15px;
    height: 15px;
    cursor: pointer;
    accent-color: var(--accent-primary);
  }
}

.builtin-toggle-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
}

.user-section-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px;
  color: var(--text-muted);

  p {
    font-size: 13px;
    margin: 0;
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.json-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.runtime-section {
  border-top: 1px solid var(--border-default);
  padding-top: 16px;
}

.runtime-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.runtime-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-base);
  font-weight: 500;
  color: var(--text-primary);

  svg {
    color: var(--text-muted);
  }
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: var(--radius-xs);
  font-size: 11px;
  font-weight: 500;
  border: none;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.runtime-empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.runtime-hint {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  text-align: left;
  padding: 14px 16px;
  background: var(--bg-secondary);
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-secondary);

  svg {
    color: var(--accent-primary);
    flex-shrink: 0;
    margin-top: 1px;
  }
}

.runtime-hint-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.runtime-hint-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}

.runtime-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.runtime-item {
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border-default);
}

.runtime-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: none;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--bg-hover);
  }

  &.open {
    border-bottom: 1px solid var(--border-default);
  }
}

.chev {
  color: var(--text-muted);
  transition: transform var(--transition-fast);
  flex-shrink: 0;

  .runtime-summary.open & {
    transform: rotate(90deg);
  }
}

.tool-count {
  font-size: 10px;
  color: var(--text-muted);
  margin-left: auto;
  padding: 1px 6px;
  background: var(--bg-primary);
  border-radius: 10px;
}

.tool-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: var(--bg-primary);
}

.tool-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 12px 8px 32px;
  border-top: 1px solid var(--border-default);
  font-size: 12px;

  &:first-child {
    border-top: none;
  }
}

.tool-name {
  flex: 0 0 220px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-all;
}

.tool-desc {
  flex: 1;
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-empty {
  padding: 8px 12px 8px 32px;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

.tool-error {
  padding: 8px 12px 8px 32px;
  font-size: 11px;
  color: var(--error);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.connected {
    background: #10b981;
  }

  &.failed {
    background: var(--error);
  }

  &.needs-auth {
    background: #f59e0b;
  }

  &.pending {
    background: var(--accent-primary);
  }

  &.disabled {
    background: #9ca3af;
  }

  &.probing {
    background: var(--accent-primary);
    animation: pulse 1.5s ease-in-out infinite;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.server-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-badge {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border-default);
  text-transform: lowercase;

  &.connected {
    border-color: #10b981;
    color: #10b981;
  }

  &.failed {
    border-color: var(--error);
    color: var(--error);
  }

  &.pending {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
  }

  &.disabled {
    border-color: #9ca3af;
    color: #9ca3af;
  }

  &.needs-auth {
    border-color: #f59e0b;
    color: #f59e0b;
  }
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all var(--transition-fast);

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }
}
</style>
