# 工作区归档 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 项目目录三点菜单新增「归档工作区」，整组隐藏、设置·已归档页可恢复/永久删除。

**架构：** 工作区归档标记（归一化路径 → archivedAt）存 localStorage，过滤并入 `normalSessions` computed，所有侧栏/回退消费者一处生效。会话自身字段不动，引擎不停。纯 renderer 状态，无新 IPC。

**技术栈：** Vue 3 + Pinia + TypeScript + Vitest + vue-i18n（zh-CN/en-US）。

**规格：** `docs/superpowers/specs/2026-11-15-workspace-archive-design.md`

**提交约定：** 按用户惯例不逐任务 commit，全部验证通过后等用户「提交吧」统一提交。

**关键事实（已验证）：**
- `normalizeAbsolutePath`（`src/utils/normalizePath.ts`）：Windows 路径统一为**反斜杠**、折叠重复、保留大小写。测试期望值用反斜杠形式。
- `pathsEqual`（`src/utils/recentProjectRoots.ts`）：归一化 + 大小写不敏感比较，Sidebar 已 import。
- `useDialog().showConfirm(message, { title, variant })` 返回 `Promise<boolean>`。
- store 测试模式见 `src/stores/__tests__/chatSession.archive.test.ts`（vi.hoisted mocks + 动态 import store）。
- 组件测试模式见 `src/components/settings/__tests__/ArchiveSettings.test.ts`（mock vue-i18n / useDialog / electronAPI，真实 store）。
- `npm run dev` = vite renderer；无 electronAPI 时 api.claudeCode 为 undefined，代码有守卫，归档流程可浏览器实测（localStorage 种子数据）。

---

## 文件结构

| 操作 | 文件 | 职责 |
|---|---|---|
| 修改 | `src/services/sessionPersistence.ts` | 新增 archived workspaces 的 load/save helper |
| 修改 | `src/stores/chatSession.ts` | archivedWorkspaces 状态、normalSessions 过滤、archive/unarchive/deleteWorkspace、auto-archive 跳过、archivedWorkspaceList、导出 |
| 修改 | `src/i18n/locales/zh-CN/sidebar.ts` / `en-US/sidebar.ts` | 菜单项 + 确认文案 |
| 修改 | `src/i18n/locales/zh-CN/archive.ts` / `en-US/archive.ts` | 工作区 tab 文案 + desc 更新 |
| 修改 | `src/components/explorer/ProjectGroupHeader.vue` | 菜单新增红色「归档工作区」+ emit |
| 修改 | `src/components/explorer/SessionList.vue` | 透传 archive-project |
| 修改 | `src/components/layout/Sidebar.vue` | handleArchiveWorkspace（确认 + store + 分屏/指针清理） |
| 修改 | `src/components/settings/ArchiveSettings.vue` | 会话/工作区 tab + 工作区列表/搜索/恢复/删除 |
| 创建 | `src/services/__tests__/sessionPersistence.workspaceArchive.test.ts` | helper 容错测试 |
| 创建 | `src/stores/__tests__/chatSession.workspaceArchive.test.ts` | store 契约测试 |
| 创建 | `src/components/explorer/__tests__/ProjectGroupHeader.archive.test.ts` | 菜单项测试 |
| 创建 | `src/components/settings/__tests__/ArchiveSettings.workspaces.test.ts` | 工作区 tab 测试 |

---

### 任务 1：持久化 helper

**文件：**
- 修改：`src/services/sessionPersistence.ts`（常量区 + 文件尾部 projects helper 之后）
- 测试：`src/services/__tests__/sessionPersistence.workspaceArchive.test.ts`

- [ ] **步骤 1：编写失败的测试**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadArchivedWorkspacesFromStorage,
  saveArchivedWorkspacesToStorage,
} from '../sessionPersistence'

beforeEach(() => localStorage.clear())

describe('archived workspaces persistence', () => {
  it('round-trips the map', () => {
    expect(saveArchivedWorkspacesToStorage({ 'D:\\AI\\SpaceCode': 1000 })).toBe(true)
    expect(loadArchivedWorkspacesFromStorage()).toEqual({ 'D:\\AI\\SpaceCode': 1000 })
  })

  it('normalizes separators and dedupes case-insensitively on load', () => {
    localStorage.setItem('chat_archived_workspaces_v1', JSON.stringify({
      'D:\\\\AI\\\\SpaceCode': 1000,
      'd:/ai/spacecode': 2000,
    }))
    expect(loadArchivedWorkspacesFromStorage()).toEqual({ 'D:\\AI\\SpaceCode': 1000 })
  })

  it('drops invalid entries', () => {
    localStorage.setItem('chat_archived_workspaces_v1', JSON.stringify({
      'D:/ok': 5,
      'D:/bad': 'nope',
      '': 9,
    }))
    expect(loadArchivedWorkspacesFromStorage()).toEqual({ 'D:\\ok': 5 })
  })

  it('survives bad JSON and non-object payloads', () => {
    localStorage.setItem('chat_archived_workspaces_v1', '{bad json')
    expect(loadArchivedWorkspacesFromStorage()).toEqual({})
    localStorage.setItem('chat_archived_workspaces_v1', JSON.stringify([1, 2]))
    expect(loadArchivedWorkspacesFromStorage()).toEqual({})
    expect(loadArchivedWorkspacesFromStorage()).toEqual({})
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/services/__tests__/sessionPersistence.workspaceArchive.test.ts`
预期：FAIL，`loadArchivedWorkspacesFromStorage is not a function`（export 不存在）。

- [ ] **步骤 3：实现 helper**

常量区（`DELETED_SESSIONS_KEY` 之后）加：

```ts
const ARCHIVED_WORKSPACES_KEY = 'chat_archived_workspaces_v1'
```

`saveProjectsToStorage` 之后加：

```ts
export function loadArchivedWorkspacesFromStorage(): Record<string, number> {
  try {
    const saved = localStorage.getItem(ARCHIVED_WORKSPACES_KEY)
    if (!saved) return {}
    const parsed = JSON.parse(saved)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const seen = new Set<string>()
    const result: Record<string, number> = {}
    for (const [path, at] of Object.entries(parsed)) {
      if (!path || typeof at !== 'number' || !Number.isFinite(at)) continue
      const normalized = normalizeAbsolutePath(path)
      const key = normalized.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result[normalized] = at
    }
    return result
  } catch (e) {
    console.error('[ChatStore] Failed to load archived workspaces from storage:', e)
    return {}
  }
}

export function saveArchivedWorkspacesToStorage(workspaces: Record<string, number>): boolean {
  try {
    localStorage.setItem(ARCHIVED_WORKSPACES_KEY, JSON.stringify(workspaces))
    return true
  } catch (e) {
    console.error('[ChatStore] Failed to save archived workspaces to storage:', e)
    return false
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/services/__tests__/sessionPersistence.workspaceArchive.test.ts`
预期：PASS（4 个用例）。

---

### 任务 2：store 状态与 actions

**文件：**
- 修改：`src/stores/chatSession.ts`（import 区、projects ref 附近、normalSessions、runAutoArchive、archiveSession 附近、return 导出表）
- 测试：`src/stores/__tests__/chatSession.workspaceArchive.test.ts`

- [ ] **步骤 1：编写失败的测试**

mock 块照抄 `chatSession.archive.test.ts` 的 `vi.hoisted` + `vi.mock('@/services/electronAPI')`（同一份 mocks：getSessionStatus/startSession/stop/resumeSession/setPermissionMode/listAgents/listAllSessions/getFullSession/traceEvent/getTurnCheckpoints/getTurnRewindPreviewFiles/rewindTurn，api 结构相同）。beforeEach / loadStore / loadSettings 同该文件。用例：

```ts
import { loadArchivedWorkspacesFromStorage, loadDeletedSessionIds } from '@/services/sessionPersistence'

const DAY = 86_400_000

describe('chatSession archiveWorkspace', () => {
  it('hides the whole group from normalSessions without touching session fields or the engine', async () => {
    const store = await loadStore()
    const a = store.createSession('A', 'D:/repo', 'a')
    store.createSession('B', 'D:/repo', 'b')
    const other = store.createSession('Other', 'D:/else', 'other')
    store.addMessage({ role: 'user', content: 'keep' }, a.id)
    const updatedAt = a.updatedAt

    expect(store.archiveWorkspace('D:/repo')).toBe(true)

    expect(store.normalSessions.map(s => s.id)).toEqual(['other'])
    expect(store.getSession('a')?.archived).toBeFalsy()
    expect(store.getSession('a')?.messages).toHaveLength(1)
    expect(store.getSession('a')?.updatedAt).toBe(updatedAt)
    expect(store.archivedSessions).toHaveLength(0)
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('is idempotent and rejects empty paths', async () => {
    const store = await loadStore()
    store.createSession('A', 'D:/repo', 'a')
    expect(store.archiveWorkspace('D:/repo')).toBe(true)
    const at = store.archivedWorkspaceList[0].archivedAt
    expect(store.archiveWorkspace('D:/repo')).toBe(false)
    expect(store.archivedWorkspaceList[0].archivedAt).toBe(at)
    expect(store.archiveWorkspace('')).toBe(false)
  })

  it('matches paths case-insensitively and across separator styles', async () => {
    const store = await loadStore()
    store.createSession('A', 'D:/repo', 'a')
    store.archiveWorkspace('D:/repo')
    expect(store.isWorkspaceArchived('d:\\repo')).toBe(true)
    expect(store.isWorkspaceArchived('D:/else')).toBe(false)
    expect(store.isWorkspaceArchived(undefined)).toBe(false)
  })

  it('moves the current session and clears the current project pointer', async () => {
    const store = await loadStore()
    store.createSession('Other', 'D:/else', 'other')
    const doomed = store.createSession('Doomed', 'D:/repo', 'doomed')
    store.switchProject('D:/repo')
    expect(store.currentSessionId).toBe(doomed.id)

    store.archiveWorkspace('D:/repo')

    expect(store.currentSessionId).toBe('other')
    expect(store.currentProjectRoot).toBe('')
  })

  it('clears the current session when nothing visible is left', async () => {
    const store = await loadStore()
    store.createSession('Only', 'D:/repo', 'only')
    store.archiveWorkspace('D:/repo')
    expect(store.currentSessionId).toBeNull()
  })

  it('persists immediately so a restart keeps the group hidden', async () => {
    const store = await loadStore()
    store.createSession('A', 'D:/repo', 'a')
    store.archiveWorkspace('D:/repo')
    const persisted = loadArchivedWorkspacesFromStorage()
    expect(Object.keys(persisted)).toEqual(['D:\\repo'])
    expect(persisted['D:\\repo']).toBeGreaterThan(0)
  })
})

describe('chatSession unarchiveWorkspace', () => {
  it('restores every session at its original freshness', async () => {
    const store = await loadStore()
    const older = store.createSession('Older', 'D:/repo', 'older')
    older.updatedAt = Date.now() - 10 * DAY
    store.createSession('Newer', 'D:/repo', 'newer')
    store.archiveWorkspace('D:/repo')

    expect(store.unarchiveWorkspace('D:/repo')).toBe(true)

    expect(store.normalSessions.map(s => s.id)).toEqual(['newer', 'older'])
    expect(store.getSession('older')?.updatedAt).toBe(older.updatedAt)
    expect(store.archivedWorkspaceList).toHaveLength(0)
    expect(loadArchivedWorkspacesFromStorage()).toEqual({})
  })

  it('rejects unknown paths', async () => {
    const store = await loadStore()
    expect(store.unarchiveWorkspace('D:/nope')).toBe(false)
  })
})

describe('chatSession archivedWorkspaceList', () => {
  it('counts sessions, derives display names and sorts newest archive first', async () => {
    const store = await loadStore()
    store.createSession('A', 'D:/AI/SpaceCode', 'a')
    store.createSession('B', 'D:/AI/SpaceCode', 'b')
    store.createSession('Side', 'D:/AI/SpaceCode', 'side', { ephemeral: true, activate: false })
    store.createSession('C', 'D:/AI/Proma', 'c')
    store.archiveWorkspace('D:/AI/SpaceCode')
    store.archivedWorkspaces['D:\\AI\\SpaceCode'] = 1_000
    store.archiveWorkspace('D:/AI/Proma')
    store.archivedWorkspaces['D:\\AI\\Proma'] = 2_000

    expect(store.archivedWorkspaceList.map(w => w.displayName)).toEqual(['Proma', 'SpaceCode'])
    expect(store.archivedWorkspaceList[1].sessionCount).toBe(2)
  })
})

describe('chatSession runAutoArchive x archived workspace', () => {
  it('skips sessions inside archived workspaces', async () => {
    const store = await loadStore()
    const settings = await loadSettings()
    const hidden = store.createSession('Hidden', 'D:/repo', 'hidden')
    hidden.updatedAt = Date.now() - 90 * DAY
    const visible = store.createSession('Visible', 'D:/else', 'visible')
    visible.updatedAt = Date.now() - 90 * DAY
    store.archiveWorkspace('D:/repo')
    settings.archiveAfterDays = 7

    expect(store.runAutoArchive()).toBe(1)
    expect(store.getSession('hidden')?.archived).toBeFalsy()
    expect(store.getSession('visible')?.archived).toBe(true)
  })
})

describe('chatSession deleteWorkspace', () => {
  it('deletes all sessions with tombstones, removes the project and the marker, skips observed mirrors', async () => {
    const store = await loadStore()
    store.createSession('A', 'D:/repo', 'a')
    store.createSession('B', 'D:/repo', 'b')
    const mirror = store.createSession('Mirror', 'D:/repo', 'mirror', { activate: false })
    mirror.observedSession = true
    store.addProject('D:/repo')
    store.archiveWorkspace('D:/repo')

    await store.deleteWorkspace('D:/repo')

    expect(store.getSession('a')).toBeNull()
    expect(store.getSession('b')).toBeNull()
    expect(store.getSession('mirror')).not.toBeNull()
    expect(loadDeletedSessionIds()).toContain('a')
    expect(loadDeletedSessionIds()).toContain('b')
    expect(store.projects).not.toContain('D:\\repo')
    expect(store.archivedWorkspaceList).toHaveLength(0)
    expect(mocks.stop).toHaveBeenCalledWith('a')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/stores/__tests__/chatSession.workspaceArchive.test.ts`
预期：FAIL，`store.archiveWorkspace is not a function`。

- [ ] **步骤 3：实现 store 变更**

import 区（`saveProjectsToStorage,` 之后）加：

```ts
  loadArchivedWorkspacesFromStorage,
  saveArchivedWorkspacesToStorage,
```

`const currentProjectRoot = ref<string>('')` 之后加：

```ts
  const archivedWorkspaces = ref<Record<string, number>>(loadArchivedWorkspacesFromStorage())

  const archivedWorkspaceKeys = computed(() =>
    new Set(Object.keys(archivedWorkspaces.value).map(k => k.toLowerCase())),
  )

  function isWorkspaceArchived(path?: string): boolean {
    if (!path) return false
    return archivedWorkspaceKeys.value.has(normalizeAbsolutePath(path).toLowerCase())
  }

  function saveArchivedWorkspaces() {
    saveArchivedWorkspacesToStorage(archivedWorkspaces.value)
  }
```

`normalSessions` 改为：

```ts
  /** 普通聊天会话（不含 Super Agent Router、不含已归档、不含已归档工作区）：侧边栏与模式切换只消费这份列表。 */
  const normalSessions = computed(() =>
    sessions.value.filter(s =>
      (s.sessionType ?? 'chat') === 'chat'
      && !s.archived
      && !isWorkspaceArchived(s.workingDirectory),
    )
  )
```

`archivedSessions` computed 之后加：

```ts
  /** 已归档工作区：设置归档管理页的工作区 tab 消费，按归档时间倒序。 */
  const archivedWorkspaceList = computed(() => {
    const entries = Object.entries(archivedWorkspaces.value).map(([path, archivedAt]) => {
      const key = path.toLowerCase()
      const sessionCount = sessions.value.filter(s =>
        !s.ephemeral
        && !s.observedSession
        && normalizeAbsolutePath(s.workingDirectory || '').toLowerCase() === key,
      ).length
      return {
        path,
        displayName: path.split(/[\\/]/).filter(Boolean).pop() || path,
        sessionCount,
        archivedAt,
      }
    })
    return entries.sort((a, b) => b.archivedAt - a.archivedAt)
  })
```

`runAutoArchive` 改为：

```ts
  /** 按设置的阈值自动归档；返回本次归档条数。阈值为 0（禁用）时是空操作。 */
  function runAutoArchive(): number {
    const ids = collectAutoArchiveIds(sessions.value, settingsStore.archiveAfterDays)
      .filter(id => !isWorkspaceArchived(getSession(id)?.workingDirectory))
    if (ids.length === 0) return 0
    for (const id of ids) archiveSession(id)
    return ids.length
  }
```

`unarchiveSession` 之后加：

```ts
  /**
   * 工作区归档：整组移出侧栏，会话本身不动 —— 与会话归档同哲学，导航而非删除。
   * 刻意不停引擎：正在跑的任务照常跑完，取消归档就能回到原处。
   */
  function archiveWorkspace(projectPath: string): boolean {
    const normalized = normalizeAbsolutePath(projectPath)
    if (!normalized || isWorkspaceArchived(normalized)) return false
    archivedWorkspaces.value[normalized] = Date.now()
    saveArchivedWorkspaces()
    if (currentProjectRoot.value === normalized) {
      currentProjectRoot.value = ''
    }
    const current = getSession(currentSessionId.value)
    if (current && isWorkspaceArchived(current.workingDirectory)) {
      currentSessionId.value = normalSessions.value.find(s => !s.ephemeral)?.id || null
    }
    return true
  }

  /** 取消归档工作区。会话原样回到侧栏，新鲜度位置不变。 */
  function unarchiveWorkspace(projectPath: string): boolean {
    const normalized = normalizeAbsolutePath(projectPath).toLowerCase()
    const key = Object.keys(archivedWorkspaces.value).find(k => k.toLowerCase() === normalized)
    if (!key) return false
    delete archivedWorkspaces.value[key]
    saveArchivedWorkspaces()
    return true
  }

  /** 永久删除工作区：删其全部会话（跳过只读镜像）、移除项目、清归档标记。 */
  async function deleteWorkspace(projectPath: string): Promise<void> {
    const key = normalizeAbsolutePath(projectPath).toLowerCase()
    const doomed = sessions.value.filter(s =>
      !s.observedSession
      && normalizeAbsolutePath(s.workingDirectory || '').toLowerCase() === key,
    )
    for (const session of doomed) {
      await deleteSession(session.id)
    }
    removeProject(normalizeAbsolutePath(projectPath))
    unarchiveWorkspace(projectPath)
  }
```

return 导出表（`runAutoArchive,` 附近）加：

```ts
    archivedWorkspaces,
    archivedWorkspaceList,
    isWorkspaceArchived,
    archiveWorkspace,
    unarchiveWorkspace,
    deleteWorkspace,
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/stores/__tests__/chatSession.workspaceArchive.test.ts src/stores/__tests__/chatSession.archive.test.ts`
预期：PASS（新用例 + 既有归档契约不回归）。

---

### 任务 3：i18n 文案

**文件：**
- 修改：`src/i18n/locales/zh-CN/sidebar.ts`、`src/i18n/locales/en-US/sidebar.ts`
- 修改：`src/i18n/locales/zh-CN/archive.ts`、`src/i18n/locales/en-US/archive.ts`

- [ ] **步骤 1：zh-CN/sidebar.ts 追加**

```ts
  archiveWorkspace: '归档工作区',
  confirmArchiveWorkspaceTitle: '归档工作区',
  confirmArchiveWorkspace: '「{name}」及其 {count} 个会话将从侧栏隐藏，可在设置·已归档中恢复。',
```

- [ ] **步骤 2：en-US/sidebar.ts 追加**

```ts
  archiveWorkspace: 'Archive Workspace',
  confirmArchiveWorkspaceTitle: 'Archive Workspace',
  confirmArchiveWorkspace: '"{name}" and its {count} sessions will be hidden from the sidebar. You can restore them in Settings > Archived.',
```

- [ ] **步骤 3：zh-CN/archive.ts 追加并更新 desc**

```ts
  desc: '搜索、恢复或永久删除已归档的会话与工作区。',
  workspacesTab: '工作区',
  workspacesSearchPlaceholder: '搜索已归档工作区',
  workspacesEmpty: '还没有归档的工作区。在项目目录的三点菜单里点「归档工作区」，它们就会出现在这里。',
  workspacesNoMatch: '没有匹配的已归档工作区。',
  confirmDeleteWorkspaceTitle: '永久删除工作区',
  confirmDeleteWorkspace: '「{name}」的 {count} 个会话将被永久删除，消息记录无法恢复。确定继续吗？',
  confirmDeleteAllWorkspacesTitle: '永久删除已归档工作区',
  confirmDeleteAllWorkspaces: '将永久删除 {count} 个已归档工作区及其全部会话，消息记录无法恢复。确定继续吗？',
  deleteWorkspaceFailed: '删除工作区失败，请重试。',
```

- [ ] **步骤 4：en-US/archive.ts 追加并更新 desc**

```ts
  desc: 'Search, restore or permanently delete archived sessions and workspaces.',
  workspacesTab: 'Workspaces',
  workspacesSearchPlaceholder: 'Search archived workspaces',
  workspacesEmpty: 'No archived workspaces yet. Use "Archive Workspace" in a project\'s three-dot menu and they will show up here.',
  workspacesNoMatch: 'No archived workspaces match your search.',
  confirmDeleteWorkspaceTitle: 'Delete workspace permanently',
  confirmDeleteWorkspace: '{count} sessions in "{name}" will be deleted permanently and their messages cannot be recovered. Continue?',
  confirmDeleteAllWorkspacesTitle: 'Delete archived workspaces',
  confirmDeleteAllWorkspaces: '{count} archived workspaces and all their sessions will be deleted permanently. Messages cannot be recovered. Continue?',
  deleteWorkspaceFailed: 'Failed to delete the workspace. Please try again.',
```

---

### 任务 4：菜单项与事件透传

**文件：**
- 修改：`src/components/explorer/ProjectGroupHeader.vue`
- 修改：`src/components/explorer/SessionList.vue`
- 测试：`src/components/explorer/__tests__/ProjectGroupHeader.archive.test.ts`

- [ ] **步骤 1：编写失败的测试**

mock vue-i18n（照 ArchiveSettings.test.ts 的 `vi.mock('vue-i18n')`，t 返回 key）。

```ts
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ProjectGroupHeader from '../ProjectGroupHeader.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

function mountHeader(workingDirectory: string) {
  return mount(ProjectGroupHeader, {
    props: {
      workingDirectory,
      displayName: 'SpaceCode',
      isCollapsed: false,
      isFolderHovered: true,
      isCurrent: false,
      showRemoveButton: true,
    },
  })
}

describe('ProjectGroupHeader archive menu item', () => {
  it('offers archive for a real project and emits archive-project on click', async () => {
    const wrapper = mountHeader('D:\\AI\\SpaceCode')
    await wrapper.find('.menu-trigger, .action-btn[aria-label="explorer.projectMenuAria"]').trigger('click')
    const item = wrapper.find('[data-testid="project-archive-menu-item"]')
    expect(item.exists()).toBe(true)
    expect(item.text()).toContain('sidebar.archiveWorkspace')
    await item.trigger('click')
    expect(wrapper.emitted('archive-project')).toEqual([['D:\\AI\\SpaceCode']])
  })

  it('hides archive for the no-project group', async () => {
    const wrapper = mountHeader('')
    await wrapper.find('.action-btn[aria-label="explorer.projectMenuAria"]').trigger('click')
    expect(wrapper.find('[data-testid="project-archive-menu-item"]').exists()).toBe(false)
  })
})
```

注意：三点按钮的 aria-label 是 `t('explorer.projectMenuAria')`，mock 后为字面 key；选择器用 `.action-btn[aria-label="explorer.projectMenuAria"]`。

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/components/explorer/__tests__/ProjectGroupHeader.archive.test.ts`
预期：FAIL，找不到 `project-archive-menu-item`。

- [ ] **步骤 3：实现菜单项**

ProjectGroupHeader.vue：
- lucide import 加 `Archive`。
- emits 加 `'archive-project': [workingDirectory: string]`。
- 菜单模板：把现有 `<template v-if="showRemoveButton && workingDirectory !== ''">` 块替换为：

```html
            <template v-if="workingDirectory !== ''">
              <div class="menu-divider" />
              <button
                class="menu-item destructive"
                data-testid="project-archive-menu-item"
                @click="handleArchiveProject"
              >
                <Archive :size="14" />
                <span>{{ t('sidebar.archiveWorkspace') }}</span>
              </button>
              <button
                v-if="showRemoveButton"
                class="menu-item destructive"
                @click="handleRemoveProject"
              >
                <FolderMinus :size="14" />
                <span>{{ t('sidebar.removeFromList') }}</span>
              </button>
            </template>
```

- script 加：

```ts
function handleArchiveProject() {
  menuOpen.value = false
  emit('archive-project', props.workingDirectory)
}
```

SessionList.vue：
- emits 加 `'archive-project': [workingDirectory: string]`。
- ProjectGroupHeader 标签加 `@archive-project="(wd) => $emit('archive-project', wd)"`。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/components/explorer/__tests__/ProjectGroupHeader.archive.test.ts`
预期：PASS。

---

### 任务 5：Sidebar 归档处理

**文件：**
- 修改：`src/components/layout/Sidebar.vue`（SessionList 事件绑定 + handleRemoveProject 附近新增 handler）

- [ ] **步骤 1：绑定事件**

SessionList 标签（`@remove-project` 附近）加：

```html
              @archive-project="handleArchiveWorkspace"
```

- [ ] **步骤 2：实现 handler**

`handleRemoveProject` 之前加（`pathsEqual`、`showConfirm`、`useSplitLayoutStore` 均已 import）：

```ts
/**
 * 工作区归档：整组移出侧栏，可逆。先确认（用户拍板），再把界面从被归档
 * 工作区的会话上挪开 —— 分屏每个 pane 各自绑定 tabId，只改全局
 * activeCenterTab 会让其它 pane 继续显示已隐藏的会话。
 */
async function handleArchiveWorkspace(workingDirectory: string) {
  const name = workingDirectory.split(/[\\/]/).filter(Boolean).pop() || workingDirectory
  const count = sessionStore.sessions.filter(s =>
    !s.ephemeral
    && !s.observedSession
    && !!s.workingDirectory
    && pathsEqual(s.workingDirectory, workingDirectory),
  ).length
  if (!await showConfirm(
    t('sidebar.confirmArchiveWorkspace', { name, count }),
    { title: t('sidebar.confirmArchiveWorkspaceTitle') },
  )) return

  const tabIds = new Set(
    sessionStore.sessions
      .filter(s => !!s.workingDirectory && pathsEqual(s.workingDirectory, workingDirectory))
      .map(s => `session-${s.id}`),
  )
  const wasCurrent = !!sessionStore.currentSession?.workingDirectory
    && pathsEqual(sessionStore.currentSession.workingDirectory, workingDirectory)
  if (!sessionStore.archiveWorkspace(workingDirectory)) return

  const splitLayout = useSplitLayoutStore()
  const fallbackTabId = sessionStore.currentSessionId
    ? `session-${sessionStore.currentSessionId}`
    : 'chat'
  for (const leaf of splitLayout.leaves) {
    if (leaf.content.tabId && tabIds.has(leaf.content.tabId)) {
      splitLayout.setPaneContent(leaf.id, { kind: 'session', tabId: fallbackTabId })
    }
  }
  if (appStore.activeCenterTab && tabIds.has(appStore.activeCenterTab)) {
    appStore.activeCenterTab = fallbackTabId
  }
  if (pathsEqual(appStore.projectRoot, workingDirectory)) {
    appStore.closeProject()
  }
  if (wasCurrent && sessionStore.currentSessionId) {
    await handleSelectSession(sessionStore.currentSessionId)
  }
}
```

- [ ] **步骤 3：类型检查**

运行：`npx vue-tsc --noEmit`
预期：无新增报错（leaf.content.tabId 的可访问性与 handleArchiveSession 现有用法一致）。

---

### 任务 6：设置·已归档页工作区 tab

**文件：**
- 修改：`src/components/settings/ArchiveSettings.vue`
- 测试：`src/components/settings/__tests__/ArchiveSettings.workspaces.test.ts`

- [ ] **步骤 1：编写失败的测试**

mock 块照抄 `ArchiveSettings.test.ts`（useDialog / vue-i18n / electronAPI，真实 store）。

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ArchiveSettings from '../ArchiveSettings.vue'
import { useChatSessionStore } from '@/stores/chatSession'

const mocks = vi.hoisted(() => ({
  showConfirm: vi.fn(),
  showAlert: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/composables/useDialog', () => ({
  useDialog: () => ({ showConfirm: mocks.showConfirm, showAlert: mocks.showAlert }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
    locale: { value: 'en-US' },
  }),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {
      getSessionStatus: vi.fn().mockResolvedValue({ isRunning: false }),
      startSession: vi.fn().mockResolvedValue(undefined),
      stop: mocks.stop,
      resumeSession: vi.fn().mockResolvedValue(undefined),
      setPermissionMode: vi.fn().mockResolvedValue(undefined),
      listAgents: vi.fn().mockResolvedValue([]),
      listAllSessions: vi.fn().mockResolvedValue([]),
      getFullSession: vi.fn().mockResolvedValue({ messages: [] }),
    },
    image: null,
    agents: { install: vi.fn().mockResolvedValue({ success: true }) },
    skills: { installLocal: vi.fn().mockResolvedValue({ success: true }) },
    trace: { event: vi.fn() },
    session: {
      getTurnCheckpoints: vi.fn().mockResolvedValue({ ok: true, checkpoints: [], error: null }),
      getTurnRewindPreviewFiles: vi.fn().mockResolvedValue({ ok: true, files: [], error: null }),
      rewindTurn: vi.fn().mockResolvedValue({ ok: true, error: null }),
    },
    getCwd: vi.fn().mockResolvedValue(''),
    injectGuiModelsToSettings: vi.fn().mockResolvedValue({ success: true }),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
    getEnv: vi.fn().mockResolvedValue(undefined),
    notifyEngineSourceChanged: vi.fn().mockResolvedValue(undefined),
  },
}))

let store: ReturnType<typeof useChatSessionStore>
let wrapper: ReturnType<typeof mount>

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.stop.mockResolvedValue(undefined)
  mocks.showConfirm.mockResolvedValue(true)
  mocks.showAlert.mockResolvedValue(undefined)
  store = useChatSessionStore()
})

function mountPage() {
  wrapper = mount(ArchiveSettings)
  return wrapper
}

async function openWorkspacesTab() {
  await wrapper!.find('[data-testid="archive-tab-workspaces"]').trigger('click')
  await flushPromises()
}

describe('ArchiveSettings workspaces tab', () => {
  it('defaults to the sessions tab and shows the workspace count on the tab', async () => {
    store.createSession('A', 'D:/repo', 'a')
    store.archiveWorkspace('D:/repo')
    mountPage()
    await flushPromises()

    expect(wrapper!.find('[data-testid="archive-empty"]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid="archive-tab-workspaces"]').text()).toContain('1')
  })

  it('lists archived workspaces with session counts and restores them', async () => {
    store.createSession('A', 'D:/AI/SpaceCode', 'a')
    store.createSession('B', 'D:/AI/SpaceCode', 'b')
    store.archiveWorkspace('D:/AI/SpaceCode')
    mountPage()
    await openWorkspacesTab()

    const rows = wrapper!.findAll('[data-testid="archive-workspace-row"]')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('SpaceCode')
    expect(rows[0].text()).toContain('archive.sessionCount:2')

    await wrapper!.find('[data-testid="archive-workspace-restore"]').trigger('click')
    await flushPromises()

    expect(store.archivedWorkspaceList).toHaveLength(0)
    expect(store.normalSessions.map(s => s.id)).toEqual(['b', 'a'])
    expect(wrapper!.find('[data-testid="archive-workspace-empty"]').exists()).toBe(true)
  })

  it('filters workspaces by search and scopes delete-all to the filter', async () => {
    store.createSession('A', 'D:/AI/SpaceCode', 'a')
    store.createSession('B', 'D:/AI/Proma', 'b')
    store.archiveWorkspace('D:/AI/SpaceCode')
    store.archiveWorkspace('D:/AI/Proma')
    mountPage()
    await openWorkspacesTab()

    await wrapper!.find('[data-testid="archive-workspace-search"]').setValue('proma')
    expect(wrapper!.findAll('[data-testid="archive-workspace-row"]')).toHaveLength(1)

    await wrapper!.find('[data-testid="archive-workspace-delete-all"]').trigger('click')
    await flushPromises()

    expect(mocks.showConfirm).toHaveBeenCalledTimes(1)
    expect(store.archivedWorkspaceList.map(w => w.displayName)).toEqual(['SpaceCode'])
    expect(store.getSession('a')).not.toBeNull()
    expect(store.getSession('b')).toBeNull()
  })

  it('asks for confirmation before permanently deleting a workspace', async () => {
    store.createSession('A', 'D:/repo', 'a')
    store.archiveWorkspace('D:/repo')
    mountPage()
    await openWorkspacesTab()

    mocks.showConfirm.mockResolvedValueOnce(false)
    await wrapper!.find('[data-testid="archive-workspace-delete"]').trigger('click')
    await flushPromises()
    expect(store.getSession('a')).not.toBeNull()

    await wrapper!.find('[data-testid="archive-workspace-delete"]').trigger('click')
    await flushPromises()
    expect(store.getSession('a')).toBeNull()
    expect(store.archivedWorkspaceList).toHaveLength(0)
  })

  it('shows the empty state when nothing is archived', async () => {
    mountPage()
    await openWorkspacesTab()
    expect(wrapper!.find('[data-testid="archive-workspace-empty"]').exists()).toBe(true)
    expect(wrapper!.find('[data-testid="archive-workspace-delete-all"]').attributes('disabled')).toBeDefined()
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/components/settings/__tests__/ArchiveSettings.workspaces.test.ts`
预期：FAIL，找不到 `archive-tab-workspaces`。

- [ ] **步骤 3：实现 tab 与工作区视图**

template：masthead 之后插入 tab 栏：

```html
    <!-- Tabs: sessions / workspaces -->
    <div class="archive-tabs" role="tablist">
      <button
        class="archive-tab"
        :class="{ active: activeTab === 'sessions' }"
        data-testid="archive-tab-sessions"
        role="tab"
        :aria-selected="activeTab === 'sessions'"
        @click="activeTab = 'sessions'"
      >
        {{ t('archive.sessionsTab') }}
        <em>{{ archivedSessions.length }}</em>
      </button>
      <button
        class="archive-tab"
        :class="{ active: activeTab === 'workspaces' }"
        data-testid="archive-tab-workspaces"
        role="tab"
        :aria-selected="activeTab === 'workspaces'"
        @click="activeTab = 'workspaces'"
      >
        {{ t('archive.workspacesTab') }}
        <em>{{ archivedWorkspaces.length }}</em>
      </button>
    </div>
```

把现有 toolbar → filters → empty/groups 整块包进 `<template v-if="activeTab === 'sessions'">…</template>`，其后加：

```html
    <template v-else>
      <div class="archive-toolbar">
        <span class="archive-chip" data-testid="archive-workspace-count">
          <Archive :size="14" />
          {{ t('archive.workspacesTab') }}
          <em>{{ archivedWorkspaces.length }}</em>
        </span>
        <button
          class="archive-delete-all"
          data-testid="archive-workspace-delete-all"
          :disabled="visibleWorkspaces.length === 0 || busy"
          @click="handleDeleteAllWorkspaces"
        >
          <Trash2 :size="14" />
          {{ t('archive.deleteAll') }}
        </button>
      </div>

      <div class="archive-filters">
        <div class="archive-search">
          <Search :size="14" class="archive-search-icon" />
          <input
            v-model="workspaceQuery"
            type="text"
            class="archive-search-input"
            data-testid="archive-workspace-search"
            :placeholder="t('archive.workspacesSearchPlaceholder')"
            :aria-label="t('archive.workspacesSearchPlaceholder')"
          />
          <button
            v-if="workspaceQuery"
            class="archive-search-clear"
            :aria-label="t('common.cancel')"
            @click="workspaceQuery = ''"
          >
            <X :size="12" />
          </button>
        </div>
      </div>

      <div v-if="archivedWorkspaces.length === 0" class="archive-empty" data-testid="archive-workspace-empty">
        <Archive :size="26" />
        <p>{{ t('archive.workspacesEmpty') }}</p>
      </div>
      <div v-else-if="visibleWorkspaces.length === 0" class="archive-empty" data-testid="archive-workspace-no-match">
        <Search :size="26" />
        <p>{{ t('archive.workspacesNoMatch') }}</p>
      </div>
      <div v-else class="archive-groups">
        <ul class="archive-rows">
          <li v-for="ws in visibleWorkspaces" :key="ws.path" class="archive-row" data-testid="archive-workspace-row">
            <div class="archive-row-main">
              <span class="archive-row-title with-icon" :title="ws.path">
                <FolderOpen :size="14" class="archive-row-icon" />
                <span class="archive-row-text">{{ ws.displayName }}</span>
              </span>
              <span class="archive-row-time">
                {{ t('archive.sessionCount', { count: ws.sessionCount }) }} · {{ formatArchivedAtValue(ws.archivedAt) }}
              </span>
            </div>
            <div class="archive-row-actions">
              <button
                class="archive-icon-btn"
                data-testid="archive-workspace-delete"
                :disabled="busy"
                :title="t('archive.delete')"
                :aria-label="t('archive.delete')"
                @click="handleDeleteWorkspace(ws)"
              >
                <Trash2 :size="15" />
              </button>
              <button
                class="archive-restore-btn"
                data-testid="archive-workspace-restore"
                :disabled="busy"
                @click="handleUnarchiveWorkspace(ws)"
              >
                <ArchiveRestore :size="14" />
                {{ t('archive.unarchive') }}
              </button>
            </div>
          </li>
        </ul>
      </div>
    </template>
```

script 追加：

```ts
const activeTab = ref<'sessions' | 'workspaces'>('sessions')
const workspaceQuery = ref('')

const archivedWorkspaces = computed(() => sessionStore.archivedWorkspaceList)

const visibleWorkspaces = computed(() => {
  const query = workspaceQuery.value.trim().toLowerCase()
  if (!query) return archivedWorkspaces.value
  return archivedWorkspaces.value.filter(ws =>
    ws.displayName.toLowerCase().includes(query) || ws.path.toLowerCase().includes(query),
  )
})

function formatArchivedAtValue(at: number): string {
  if (!at) return ''
  return new Date(at).toLocaleString(locale.value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function handleUnarchiveWorkspace(ws: { path: string }) {
  sessionStore.unarchiveWorkspace(ws.path)
}

async function handleDeleteWorkspace(ws: { path: string; displayName: string; sessionCount: number }) {
  const confirmed = await showConfirm(
    t('archive.confirmDeleteWorkspace', { name: ws.displayName, count: ws.sessionCount }),
    { title: t('archive.confirmDeleteWorkspaceTitle'), variant: 'danger' },
  )
  if (!confirmed) return
  await deleteWorkspaces([ws.path])
}

/** 「全部删除」只作用于当前筛选结果，与会话 tab 同契约。 */
async function handleDeleteAllWorkspaces() {
  const paths = visibleWorkspaces.value.map(ws => ws.path)
  if (paths.length === 0) return
  const confirmed = await showConfirm(
    t('archive.confirmDeleteAllWorkspaces', { count: paths.length }),
    { title: t('archive.confirmDeleteAllWorkspacesTitle'), variant: 'danger' },
  )
  if (!confirmed) return
  await deleteWorkspaces(paths)
}

async function deleteWorkspaces(paths: string[]) {
  busy.value = true
  try {
    for (const path of paths) {
      await sessionStore.deleteWorkspace(path)
    }
  } catch (error) {
    console.error('[ArchiveSettings] Failed to delete archived workspaces:', error)
    await showAlert(t('archive.deleteWorkspaceFailed'))
  } finally {
    busy.value = false
  }
}
```

现有 `formatArchivedAt(session)` 改为复用：

```ts
function formatArchivedAt(session: Session): string {
  return formatArchivedAtValue(getArchivedAt(session))
}
```

style 追加：

```scss
.archive-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1.5px solid var(--border-default);
}

.archive-tab {
  @include reset-button;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -1.5px;
  cursor: pointer;
  transition: all var(--transition-fast);

  em {
    font-style: normal;
    font-variant-numeric: tabular-nums;
    color: var(--accent-primary);
  }

  &:hover {
    color: var(--text-primary);
  }

  &.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent-primary);
  }
}

.archive-row-title.with-icon {
  display: flex;
  align-items: center;
  gap: 6px;
}

.archive-row-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.archive-row-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/components/settings/__tests__/ArchiveSettings.workspaces.test.ts src/components/settings/__tests__/ArchiveSettings.test.ts`
预期：PASS（新用例 + 既有会话 tab 契约不回归）。

---

### 任务 7：验证与 UI 实测

- [ ] **步骤 1：受影响测试**

运行：`npm run test:changed`
预期：全部 PASS。若 0 个受影响测试（不应发生，新测试文件直接 import 被测模块），手动跑任务 1-6 的测试文件。

- [ ] **步骤 2：类型检查 + 构建**

运行：`npm run build`
预期：vue-tsc 无错误，vite build 成功。

- [ ] **步骤 3：浏览器实测金路径**

运行：`npm run dev`（后台），browser-use 打开 vite URL。
用 evaluate_script 向 localStorage 种子 `chat_sessions_v2`（两条会话，workingDirectory 分别为 D:\AI\SpaceCode 与 D:\AI\Proma）与 `chat_projects_v2`，刷新。
走查：hover 项目头 → 三点菜单 → 红色「归档工作区」→ 确认框 → 组消失 → 设置·已归档 → 工作区 tab → 取消归档 → 组恢复 → 再归档 → 永久删除 → 会话清空。
暗色主题下展开菜单确认红色项可读。若浏览器无法渲染（依赖 electronAPI 的阻塞点），明确说明未实测部分。

- [ ] **步骤 4：收尾**

向用户报告变更与验证证据，等「提交吧」再 commit。