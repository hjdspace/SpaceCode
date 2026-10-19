<template>
  <div class="artifacts-panel">
    <div class="artifacts-header">
      <span class="header-title">{{ t('artifacts.title') }}</span>
      <button class="refresh-btn" :title="t('artifacts.refresh')" @click="refresh">
        <RotateCw :size="14" :class="{ spinning: loading }" />
      </button>
    </div>

    <div class="artifacts-body">
      <div v-if="files.length === 0" class="artifacts-empty">
        <PackageOpen :size="30" class="empty-icon" />
        <p>{{ t('artifacts.empty') }}</p>
        <span class="empty-path">{{ outputsHint }}</span>
      </div>

      <ul v-else class="artifacts-list">
        <li
          v-for="f in files"
          :key="f.path"
          class="artifact-item"
          @dblclick="open(f)"
        >
          <span class="file-icon">{{ iconFor(f.ext) }}</span>
          <div class="file-meta">
            <div class="file-name" :title="f.name">{{ f.name }}</div>
            <div class="file-sub">{{ formatSize(f.size) }} · {{ f.ext.toUpperCase() || 'FILE' }}</div>
          </div>
          <div class="file-actions">
            <button v-if="isPreviewable(f.path)" class="act-btn" :title="t('artifacts.preview')" @click.stop="open(f)">
              <Eye :size="13" />
            </button>
            <button class="act-btn" :title="t('artifacts.openExternal')" @click.stop="openExternally(f)">
              <ExternalLink :size="13" />
            </button>
            <button class="act-btn" :title="t('artifacts.reveal')" @click.stop="reveal(f)">
              <FolderOpen :size="13" />
            </button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCw, PackageOpen, ExternalLink, FolderOpen, Eye } from 'lucide-vue-next'
import { useChatSessionStore } from '@/stores/chatSession'
import { useAppStore } from '@/stores/app'
import { useDialog } from '@/composables/useDialog'
import { api, type ArtifactEntry } from '@/services/electronAPI'
import { iconFor, formatSize, isHtmlPreviewPath, isOfficePreviewPath } from '@/utils/artifactFormat'
import { needsWorkspaceRootScan } from '@/utils/artifactScope'

const { t } = useI18n()
const sessionStore = useChatSessionStore()
const appStore = useAppStore()
const { showAlert } = useDialog()

const files = ref<ArtifactEntry[]>([])
const loading = ref(false)
let unsubscribe: (() => void) | null = null

function isPreviewable(path: string): boolean {
  return isHtmlPreviewPath(path) || isOfficePreviewPath(path)
}

const workingDir = computed(() => sessionStore.workingDirectory || '')
const outputsHint = computed(() => workingDir.value ? `${workingDir.value}/outputs` : 'outputs/')

// 当前会话创建时间：用于过滤掉历史会话残留的产物（所有 Work 会话共享同一 outputs 目录）
const sessionCreatedAt = computed(() => sessionStore.currentSession?.createdAt ?? 0)
const currentSessionId = computed(() => sessionStore.currentSessionId)

/**
 * 一次列表请求的世代号。切项目/切会话会同时触发 watch(currentSessionId) 与
 * watch(workingDir) 两条 refresh，两条都可能在飞；迟到的旧结果一律不得写回，
 * 否则当前项目是 B、列表却是 A。
 */
let listRun = 0

async function refresh() {
  const run = ++listRun
  const dir = workingDir.value
  if (!dir) {
    files.value = []
    return
  }
  // 会话创建时间与扫描口径都属于「发起那一刻的上下文」，必须在 await 之前取，
  // 否则迟到结果会用 B 的截止时间去过滤 A 的文件。
  const cutoff = sessionCreatedAt.value - 1000
  const scanWorkspaceRoot = needsWorkspaceRootScan(sessionStore.currentSession?.mode)
  loading.value = true
  try {
    // 与本轮产物卡片同一套扫描口径：work 只看 outputs/，design/code 还要看工作区根目录，
    // 否则 agent 写在 outputs/ 之外的交付物在这个列表里根本不会出现。
    const res = await api.artifacts.list(dir, { scanWorkspaceRoot })
    if (run !== listRun || workingDir.value !== dir) return
    // 只显示当前会话创建之后生成的产物（容差 1s 处理时钟精度边界）
    files.value = (res.artifacts || []).filter(f => f.mtime >= cutoff)
  } catch (err) {
    if (run !== listRun || workingDir.value !== dir) return
    console.error('[Artifacts] list failed:', err)
  } finally {
    if (run === listRun) loading.value = false
  }
}

/** 行内预览：office/html 走应用内预览，其余交回系统默认程序 */
function open(f: ArtifactEntry) {
  if (isOfficePreviewPath(f.path)) {
    appStore.openOfficePreview(f.path)
  } else if (isHtmlPreviewPath(f.path)) {
    appStore.openFileInWebview(f.path)
  } else {
    void openExternally(f)
  }
}

/** 「外部打开」按钮：调用系统关联程序（shell.openPath），失败必须让用户看见 */
async function openExternally(f: ArtifactEntry) {
  try {
    const result = await api.artifacts.open(f.path)
    if (!result.success) {
      await showAlert(result.error ? `${t('artifacts.openFailed')}: ${result.error}` : t('artifacts.openFailed'))
    }
  } catch (err) {
    console.error('[Artifacts] open failed:', err)
    await showAlert(t('artifacts.openFailed'))
  }
}

async function reveal(f: ArtifactEntry) {
  await api.artifacts.reveal(f.path)
}

watch(currentSessionId, () => {
  // 切换会话：清空列表，避免显示上一个会话的产物
  files.value = []
  refresh()
})

watch(workingDir, () => {
  refresh()
  // 重启 watcher 以监听新目录
  void restartWatch()
})

// watcher 一个都没建成时（罕见：fs.watch 整体失败）退回 3s 轮询，
// 列表仍能自动更新；watching=true 时撤销轮询（issue #44）。
let pollTimer: ReturnType<typeof setInterval> | null = null

function applyWatchStatus(watching: boolean): void {
  if (watching) {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  } else if (!pollTimer) {
    pollTimer = setInterval(() => {
      if (!loading.value) void refresh()
    }, 3000)
  }
}

/** watcher 的状态同样按发起时的目录复核，否则 A 的 watching 结果会决定 B 是否退回轮询。 */
let watchRun = 0

async function restartWatch(): Promise<void> {
  const run = ++watchRun
  const dir = workingDir.value
  if (!dir) return
  try {
    const status = await api.artifacts.startWatch(dir)
    if (run !== watchRun || workingDir.value !== dir) return
    applyWatchStatus(status.watching)
  } catch {
    if (run !== watchRun || workingDir.value !== dir) return
    applyWatchStatus(false)
  }
}

onMounted(() => {
  refresh()
  // Phase 6: 使用 fs.watch 实时推送替换 3s 轮询
  void restartWatch()
  unsubscribe = api.artifacts.onChanged(() => {
    refresh()
  })
})

onBeforeUnmount(() => {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  api.artifacts.stopWatch()
})
</script>

<style lang="scss" scoped>
.artifacts-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.artifacts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--surface-border);

  .header-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--text-muted);
  }
}

.refresh-btn {
  display: flex;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  &:hover { color: var(--accent-primary); background: var(--surface-glass-hover); }
  .spinning { animation: spin 0.8s linear infinite; }
}

@keyframes spin { to { transform: rotate(360deg); } }

.artifacts-body { flex: 1; min-height: 0; overflow-y: auto; @include scrollbar-overlay; }

.artifacts-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;

  .empty-icon { opacity: 0.3; }
  .empty-path {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    opacity: 0.6;
    word-break: break-all;
  }
}

.artifacts-list { list-style: none; margin: 0; padding: 6px; }

.artifact-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: default;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
    .file-actions { opacity: 1; }
  }
}

.file-icon { font-size: 20px; flex-shrink: 0; }

.file-meta { flex: 1; min-width: 0; }
.file-name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

.file-actions { display: flex; gap: 2px; opacity: 0; transition: opacity var(--transition-fast); }

.act-btn {
  display: flex;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 5px;
  border-radius: var(--radius-sm);
  &:hover { color: var(--accent-primary); background: var(--bg-secondary, var(--bg-primary)); }
}
</style>
