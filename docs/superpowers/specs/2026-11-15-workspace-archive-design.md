# 工作区归档设计

日期：2026-11-15
状态：已批准（待实现）

## 背景与目标

侧栏会话按项目目录分组（`SessionList.vue` → `ProjectGroupHeader.vue`）。会话级归档已上线
（commit 3a154c3c）：归档是导航动作而非删除，消息、草稿与运行中的引擎全部保留，
设置「已归档」页可恢复。本设计把同一哲学扩展到工作区：在项目目录三点菜单新增
红色「归档工作区」项，整组隐藏、可整组恢复。

截图参考中的「置顶 / 编辑」是其它产品的菜单样式，不在本次范围；只新增「归档工作区」。

## 已确认决策

1. **归档语义**：工作区级独立标记。会话自身的 `archived` 标记完全不动；
   取消归档后所有会话原样回到侧栏（新鲜度位置不变）。
2. **恢复入口**：设置「已归档」页新增「工作区」标签页（i18n 已预留 `archive.sessionsTab`）。
3. **二次确认**：点「归档工作区」弹确认框（用户明确选择，区别于会话归档的无确认）。
4. **永久删除**：工作区标签页支持永久删除 = 删除该工作区下全部会话 + 移除项目，二次确认。
5. **过滤缝（方案 A）**：工作区过滤并入 `normalSessions` computed，所有消费者
   （侧栏、模式切换、归档/删除后的当前会话回退）一处过滤、处处正确。
   否决方案 B（独立 visibleSessions 逐处改，缝多易漏）与 C（仅 UI 层过滤，
   store 回退仍会选中隐藏会话）。

## 数据模型与持久化

`src/services/sessionPersistence.ts` 新增（照抄 projects 的容错模式）：

- `loadArchivedWorkspacesFromStorage(): Record<string, number>`
  — localStorage 键 `archived_workspaces`；加载时路径归一化（`normalizeAbsolutePath`）、
  按归一化小写去重、校验 value 为有限数字；坏 JSON 返回 `{}`。
- `saveArchivedWorkspacesToStorage(map: Record<string, number>): boolean`
  — 失败 console.error 并返回 false。

`src/stores/chatSession.ts`：

- `const archivedWorkspaces = ref<Record<string, number>>(loadArchivedWorkspacesFromStorage())`
- `isWorkspaceArchived(path?: string): boolean` — 空/undefined 路径返回 false；
  归一化后查表。
- `normalSessions` 追加条件 `&& !isWorkspaceArchived(s.workingDirectory)`，
  更新 doc 注释说明工作区归档层。
- `archivedWorkspaceList` computed：`{ path, displayName, sessionCount, archivedAt }[]`，
  按 archivedAt 倒序。displayName 取路径末段；sessionCount 统计该目录下
  非 ephemeral、非 observedSession 的会话总数（含会话级已归档的）。

## Store actions

- `archiveWorkspace(path: string): boolean`
  — 归一化；已归档返回 false；写入 `archivedWorkspaces[normalized] = Date.now()`；
  若 `currentProjectRoot === normalized` 则清空为 `''`；
  若当前会话属于该工作区，`currentSessionId` 回退到第一个可见非 ephemeral 的
  normalSession（没有则 null）；持久化；返回 true。
  刻意不停引擎（与会话归档一致）：正在跑的任务照常跑完。
- `unarchiveWorkspace(path: string): boolean`
  — 删标记并持久化；不动任何会话字段，不动 currentProjectRoot。
- `deleteWorkspace(path: string): Promise<void>`
  — 对该目录下所有非 observedSession 的会话逐个 `deleteSession`（停引擎、留墓碑、清草稿；
  observedSession 是流水线只读镜像，删它会破坏观察面板引用，跳过），
  然后 `removeProject(path)`、删归档标记、持久化。
- `runAutoArchive` 跳过已归档工作区下的会话：收集 id 后按 `isWorkspaceArchived`
  过滤再归档。否则恢复工作区时会话已被悄悄单独归档，回不到原位。
  `collectAutoArchiveIds` 工具函数签名不变，过滤放在 store action 里。

## 菜单与 Sidebar 交互

`src/components/explorer/ProjectGroupHeader.vue`：

- divider 后新增菜单项：`Archive` 图标 + `t('sidebar.archiveWorkspace')`，
  `menu-item destructive` 样式（红色，与截图一致），仅 `workingDirectory !== ''` 时渲染。
  顺序：打开文件夹 / 复制路径 / divider / 归档工作区 / 从列表移除（最破坏性的放最后）。
- 新增 emit `'archive-project': [workingDirectory: string]`。

`src/components/explorer/SessionList.vue`：透传 `@archive-project` → emit 同名事件。

`src/components/layout/Sidebar.vue` 新增 `handleArchiveWorkspace(workingDirectory)`：

1. `showConfirm(t('sidebar.confirmArchiveWorkspace', { name, count }), { title: t('sidebar.confirmArchiveWorkspaceTitle') })`，
   取消则返回。文案说明整组隐藏、可在设置·已归档恢复。
2. 记录该工作区下的会话 id 集合与 `wasCurrent`。
3. `sessionStore.archiveWorkspace(path)`，返回 false 则退出。
4. 照 `handleArchiveSession`（Sidebar.vue:876）的模式：回退 tab = 新 currentSessionId
   对应的 `session-<id>`，没有则 `'chat'`；遍历 splitLayout.leaves，
   把 content.tabId 命中被归档会话的 pane 指向回退 tab；`activeCenterTab` 命中 likewise。
5. `pathsEqual(appStore.projectRoot, path)` 时 `appStore.closeProject()`
   （照 handleRemoveProject 的模式）。
6. 若 wasCurrent 且 store 已回退出新的 currentSessionId，`await handleSelectSession(...)`
   （其内部处理 H5 mirror 同步）。

## 设置·已归档页

`src/components/settings/ArchiveSettings.vue`：

- masthead 下新增标签栏：「会话」(现有 `archive.sessionsTab`，计数) /
  「工作区」(`archive.workspacesTab`，计数)。默认选中「会话」，现有行为不变。
- 工作区 tab：
  - 搜索框按 displayName / path 过滤（前端）；隐藏项目下拉（那是会话 tab 的）。
  - 行：FolderOpen 图标 + displayName（title 显示完整路径）+ 会话数 + 归档时间
    （复用会话 tab 的 toLocaleString 格式）+ 「永久删除」图标按钮 + 「取消归档」按钮。
    复用 archive-row / archive-restore-btn / archive-icon-btn 样式。
  - 「全部删除」在工作区 tab 作用于当前筛选出的工作区，逐个 deleteWorkspace，二次确认。
  - 空态 / 无匹配态文案独立（`archive.workspacesEmpty` / `archive.workspacesNoMatch`）。
  - 永久删除单个：`showConfirm(t('archive.confirmDeleteWorkspace', { name, count }), { variant: 'danger' })`。
  - 取消归档：直接 `unarchiveWorkspace`，无确认（可逆动作）。
- busy 状态两 tab 共用，删除期间禁用按钮。

## i18n

zh-CN 与 en-US 同名模块同步新增：

- `sidebar.archiveWorkspace`：归档工作区 / Archive Workspace
- `sidebar.confirmArchiveWorkspaceTitle`：归档工作区 / Archive Workspace
- `sidebar.confirmArchiveWorkspace`：「{name}」及其 {count} 个会话将从侧栏隐藏，可在设置·已归档中恢复。/ "{name}" and its {count} sessions will be hidden from the sidebar. You can restore them in Settings > Archived.
- `archive.workspacesTab`：工作区 / Workspaces
- `archive.workspacesEmpty`、`archive.workspacesNoMatch`
- `archive.confirmDeleteWorkspaceTitle`、`archive.confirmDeleteWorkspace`（含 {name} {count}，说明消息记录无法恢复）
- `archive.confirmDeleteAllWorkspacesTitle`、`archive.confirmDeleteAllWorkspaces`（{count}）
- `archive.deleteWorkspaceFailed`
- 复用：`archive.unarchive`、`archive.delete`、`archive.deleteAll`、`archive.sessionCount`

## 边界情况

- 无项目分组（workingDirectory === ''）：不显示归档项。
- Work 模式顶部的 workWorkspace chip 不在本次范围（它是独立的工作目录指针，
  不是项目分组）；归档只影响项目分组列表，两种模式的会话分组都受过滤。
- 归档当前工作区后新建会话：currentProjectRoot 已清空，新会话落到无项目分组，
  与 removeProject 后的行为一致。
- H5 模式：过滤在 renderer store 层生效，侧栏渲染即正确；当前会话切换经
  handleSelectSession 同步 mirror。
- 会话级归档与工作区级归档正交：工作区归档页的 sessionCount 含会话级已归档者；
  恢复工作区后会话级已归档者仍留在会话归档页。

## 测试计划（TDD，先写测试）

- `src/stores/__tests__/chatSession.workspaceArchive.test.ts`
  — 归档后 normalSessions 不含该组会话且会话 archived 标记不变；
  取消归档原样恢复；当前会话/当前项目回退；持久化往返；
  runAutoArchive 跳过已归档工作区；deleteWorkspace 清会话 + 项目 + 标记。
- `src/services/__tests__/sessionPersistence.workspaceArchive.test.ts`
  — 新 helper 的归一化、去重、坏 JSON 容错。
- `src/components/explorer/__tests__/ProjectGroupHeader.archive.test.ts`
  — 菜单项渲染条件（空目录不渲染）、点击 emit archive-project。
- `src/components/settings/__tests__/ArchiveSettings.workspaces.test.ts`
  — tab 切换、列表渲染、搜索过滤、取消归档、永久删除确认流、全部删除只作用筛选结果。

## 验证

- `npm run test:changed` + `npm run build`（vue-tsc 类型检查）。
- UI 实测：优先 H5 dev 模式在浏览器走金路径（归档 → 侧栏消失 → 设置恢复 → 永久删除），
  暗色主题下展开菜单确认红色项可读；无法实测的部分明确说明。

## 范围外

- 置顶 / 编辑菜单项（截图参考样式，非本次需求）。
- Work 模式 workWorkspace chip 的归档。
- 引擎侧（engine/ 只读）与主进程 IPC：归档纯 renderer 状态，无需新 channel。