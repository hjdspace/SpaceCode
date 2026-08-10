# Skill Manager V2 — Issues 拆解文档

> **状态**: ready-for-agent
> **更新时间**: 2026-08-10
> **适用范围**: SpaceCode 桌面端 Skill 管理模块
> **PRD**: 见 `docs/plans/2026-08-10-skill-manager-v2-prd.md`
> **域术语**: 见 `CONTEXT.md`
> **架构决策**: 见 `docs/adr/0001-skill-manager-v2-architecture.md`
> **参考项目**: AgentBro (`D:\AI\agentbro`)

---

## 拆分原则

每个 Issue 是一条**垂直切片**（tracer bullet），切穿所有集成层（DB → IPC → Store → UI → 测试），完成后可独立演示或验证。

---

## Slice 1: 基础设施 — SQLite + 中心库 + Agent 注册表 + 页面骨架

**Blocked by**: None — 可立即开始

### What to build

搭建 Skill Manager v2 的基础骨架：

1. **SQLite 数据库层** (`electron/skillManagerV2/db.ts`)
   - 使用 `better-sqlite3` 创建数据库连接
   - 实现 schema v4 的全部表（skills, skill_sources, agents, skill_targets, skill_target_claims, skill_packs, skill_pack_members, unmanaged_items, diagnosis_issues, settings）
   - 实现迁移机制（schema_migrations 表）
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\db.rs` 的 `MIGRATIONS` 数组和 `Db` struct

2. **文件系统工具** (`electron/skillManagerV2/fsutil.ts`)
   - 目录哈希（SHA-256，排除 `.git`/`node_modules`/`target` 等）
   - YAML frontmatter 解析
   - 递归复制
   - 软链接创建 + Windows fallback 为 copy
   - 文件树构建
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\fsutil.rs` 的 `hash_dir()`, `parse_frontmatter()`, `create_link()`, `build_file_tree()` 函数

3. **Agent 注册表** (`electron/skillManagerV2/agentRegistry.ts`)
   - 内置 4 个 Agent: Claude Code, Codex, Cursor, Trae
   - 每个返回 Skill 目录路径、配置路径
   - 支持自定义 Agent
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\agent_paths.rs` 的 `paths_for_agent()` 函数（行 61-100+）

4. **核心服务骨架** (`electron/skillManagerV2/service.ts`)
   - `bootstrap()`: 确保 `~/.spacecode/skills` 和 `~/.spacecode/skill-manager/` 目录存在，初始化 SQLite
   - `getOverview()`: 返回 SkillManagerOverview DTO（metrics + skills + agents + packs + issues + settings）
   - `refresh()`: 全量扫描中心库目录 + 已知 Agent 目录
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\service.rs` 的 `Service` struct 和 `bootstrap()`, `overview()`, `refresh()` 方法

5. **IPC 注册** (`electron/skillManagerV2/index.ts`)
   - 注册 `skill-manager:bootstrap`, `skill-manager:init`, `skill-manager:overview`, `skill-manager:refresh`, `skill-manager:settings`, `skill-manager:update-settings`
   - 在 `electron/main.ts` 中调用 `registerSkillManagerV2IPCHandlers()`
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\commands.rs`

6. **Preload 桥接** (`electron/preload.ts`)
   - 在 `skills` 对象下新增 `skillManager` 子对象，暴露上述 IPC channel
   - 参考: `D:\AI\agentbro\src\services\skillApiV2.ts` 的 `skillApiV2` 对象（行 1072-1104）

7. **Pinia Store** (`src/stores/skillManagerStore.ts`)
   - 状态: activeTab, viewMode, overview, settings, skills, agents, packs, issues, unmanaged, filters, loading, error, initialized
   - Actions: init(), loadOverview(), refresh(), setTab(), setViewMode(), setFilter(), updateSettings()
   - 参考: `D:\AI\agentbro\src\stores\skillStoreV2.ts` 的 `useSkillStoreV2` (行 147-710)

8. **类型定义** (`src/types/skillManagerV2.d.ts`)
   - SkillManagerOverview, SkillManagerSettings, SkillSummary, SkillDetail, AgentSummary, AgentDetail, SkillPackSummary, SkillPackDetail, DiagnosisIssue, UnmanagedItemDto, DistributionPreview 等
   - 参考: `D:\AI\agentbro\src\services\skillApiV2.ts` 的全部 interface (行 25-912)

9. **Vue 组件骨架**
   - `src/components/skills-v2/SkillManagerShell.vue`: 左侧 Tab 导航 + 右侧内容区。Tab: 库、安装、技能包、Agent、诊断、设置。
   - 顶部 metrics bar（中心库 Skill 数、Agent target 数、未管理数、诊断问题数）
   - 参考: `D:\AI\agentbro\src\components\skills-v2\SkillManagerShell.tsx` + `SkillManagerV2.css`

10. **App.vue 集成**
    - 将技能管理从 modal (`SkillsManagerModal.vue`) 改为全屏页面
    - `appStore.showSkillsManager` → `appStore.currentView === 'skill-manager'`
    - 在 `App.vue` 中当 `currentView === 'skill-manager'` 时渲染 `<SkillManagerShell />`
    - 侧边栏新增技能管理入口图标

11. **设置页面基础** (`src/components/skills-v2/SkillSettingsPage.vue`)
    - 中心库路径（只读展示）
    - 默认分发方式（link/copy 下拉选择）
    - link 失败策略（ask/copy 下拉选择）
    - 启动扫描开关
    - 显示未管理开关
    - 参考: `D:\AI\agentbro\src\components\skills-v2\SettingsPageV2.tsx`

### Acceptance criteria

- [ ] 首次启动自动创建 `~/.spacecode/skills` 和 `~/.spacecode/skill-manager/skill-manager.db`
- [ ] SQLite schema 包含全部 10 张表，schema_migrations 记录版本 4
- [ ] `skill-manager:overview` 返回包含 metrics、agents（4个内置）、空 skills/packs/issues 的 DTO
- [ ] Pinia store `init()` 后 `overview` 不为 null，`agents` 长度为 4
- [ ] 全屏页面可见，左侧 6 个 Tab 可点击切换
- [ ] Settings 页面可修改默认分发方式和 link 失败策略，保存后 overview 刷新
- [ ] 侧边栏技能管理入口可见，点击进入全屏页面
- [ ] `npm run build` 通过

### AgentBro 参考路径

| SpaceCode 目标文件 | AgentBro 参考文件 |
|---|---|
| `electron/skillManagerV2/db.ts` | `src-tauri/src/skills/v2/db.rs` |
| `electron/skillManagerV2/fsutil.ts` | `src-tauri/src/skills/v2/fsutil.rs` |
| `electron/skillManagerV2/agentRegistry.ts` | `src-tauri/src/skills/agent_paths.rs` |
| `electron/skillManagerV2/service.ts` | `src-tauri/src/skills/v2/service.rs` |
| `electron/skillManagerV2/index.ts` | `src-tauri/src/skills/v2/commands.rs` |
| `electron/preload.ts` (新增 skillManager) | `src/services/skillApiV2.ts` (行 1072-1104) |
| `src/stores/skillManagerStore.ts` | `src/stores/skillStoreV2.ts` |
| `src/types/skillManagerV2.d.ts` | `src/services/skillApiV2.ts` (全部 interface) |
| `src/components/skills-v2/SkillManagerShell.vue` | `src/components/skills-v2/SkillManagerShell.tsx` |
| `src/components/skills-v2/SkillSettingsPage.vue` | `src/components/skills-v2/SettingsPageV2.tsx` |
| `src/components/skills-v2/SkillManagerV2.scss` | `src/components/skills-v2/SkillManagerV2.css` |

---

## Slice 2: Skill 库页面 — 列表、搜索、筛选、详情、删除

**Blocked by**: Slice 1

### What to build

以 Skill 为中心浏览和管理中心库：

1. **中心库扫描逻辑** (`electron/skillManagerV2/scanner.ts`)
   - 扫描 `~/.spacecode/skills` 目录，发现 Skill 子目录（含 `SKILL.md`）
   - 解析 frontmatter（name, description）
   - 计算目录 hash
   - 写入或更新 `skills` 表和 `skill_sources` 表
   - 检测中心库未入库目录（存在文件但 DB 无记录）
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\service.rs` 的 `scan_center_library()` 方法

2. **IPC 命令**
   - `skill-manager:list-center-skills`: 返回 `SkillSummary[]`
   - `skill-manager:get-skill-detail`: 返回 `SkillDetail`（含 frontmatter、files 树、targets、source）
   - `skill-manager:preview-delete-center-skill`: 返回 `DeleteCenterSkillPreview`（受影响 targets）
   - `skill-manager:execute-delete-center-skill`: 执行删除
   - `skill-manager:open-path`: 在文件管理器中打开
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\commands.rs` 对应 command

3. **SkillLibraryPage.vue**
   - 卡片视图: Skill 头像、名称、来源标签、状态标签、已安装 Agent 图标
   - 列表视图: 紧凑展示名称、来源、状态、Agent 图标
   - 搜索栏: 按名称、描述、来源、Agent 搜索
   - 筛选下拉: 状态、来源
   - 视图切换按钮: 卡片 / 列表
   - 批量管理模式: 多选、批量分发、批量删除
   - 参考: `D:\AI\agentbro\src\components\skills-v2\SkillLibraryPage.tsx`

4. **SkillDetailSlider.vue**
   - 右侧滑出面板
   - 展示: 名称、描述、中心库路径、来源、hash、frontmatter、已安装 Agent 列表（link/copy/状态）、Claims
   - 操作: 分发到 Agent、加入技能包、删除、打开目录
   - 参考: `D:\AI\agentbro\src\components\skills-v2\SkillDetailSlider.tsx`

5. **AgentIconBadge.vue**
   - Agent 图标徽章组件，展示已安装 Agent
   - 参考: `D:\AI\agentbro\src\components\skills-v2\AgentIconBadge.tsx`

6. **PreviewDialog.vue** (通用确认对话框)
   - 标题、内容区、确认/取消按钮、busy 状态、destructive 样式
   - 参考: `D:\AI\agentbro\src\components\skills-v2\PreviewDialog.tsx`

### Acceptance criteria

- [ ] 进入 Skill 库 Tab 时，显示中心库 Skills 的卡片视图
- [ ] 搜索框输入关键字时，列表实时过滤
- [ ] 状态筛选下拉选择"冲突"时，只显示冲突状态 Skills
- [ ] 点击"列表"切换为列表视图，内容不丢失
- [ ] 点击 Skill 卡片/行时，右侧详情面板滑出，显示该 Skill 的完整信息
- [ ] 详情面板中"已安装 Agent"显示 Agent 图标和安装模式
- [ ] 点击删除时弹出确认对话框，显示受影响 Agent targets
- [ ] 删除后列表刷新，该 Skill 消失
- [ ] 点击"打开目录"在文件管理器中打开 Skill 目录
- [ ] `npm run build` 通过

### AgentBro 参考路径

| SpaceCode 目标文件 | AgentBro 参考文件 |
|---|---|
| `electron/skillManagerV2/scanner.ts` | `src-tauri/src/skills/v2/service.rs` (scan_center_library 方法) |
| IPC handlers (list/get/delete) | `src-tauri/src/skills/v2/commands.rs` |
| `src/components/skills-v2/SkillLibraryPage.vue` | `src/components/skills-v2/SkillLibraryPage.tsx` |
| `src/components/skills-v2/SkillDetailSlider.vue` | `src/components/skills-v2/SkillDetailSlider.tsx` |
| `src/components/skills-v2/AgentIconBadge.vue` | `src/components/skills-v2/AgentIconBadge.tsx` |
| `src/components/skills-v2/PreviewDialog.vue` | `src/components/skills-v2/PreviewDialog.tsx` |
| `src/components/skills-v2/skillLabels.ts` | `src/components/skills-v2/skillLabels.ts` |

---

## Slice 3: 导入到中心库 — 哈希、冲突检测、预览/执行

**Blocked by**: Slice 2

### What to build

将外部 Skill 文件夹导入中心库，含冲突检测和安全预览：

1. **导入逻辑** (`electron/skillManagerV2/service.ts` 扩展)
   - `previewAddCenterSkill(input)`: 解析来源路径，验证是有效 Skill（含 SKILL.md），计算 hash，检查同名冲突
   - `executeAddCenterSkill(input, decisions)`: 复制到中心库，写入 DB source 记录
   - 冲突规则: 同名同来源→更新，同名不同来源→阻止，用户选覆盖/重命名/跳过
   - 来源类型: `local_folder`, `archive`, `github`, `url`, `agent_import`, `manual_center`, `marketplace`
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\service.rs` 的 `preview_add_center_skill()` 和 `execute_add_center_skill()` 方法

2. **IPC 命令**
   - `skill-manager:preview-add-center-skill`
   - `skill-manager:execute-add-center-skill`
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\commands.rs`

3. **ImportDialog.vue**
   - 来源选择: 选择文件夹（Electron `dialog.showOpenDialog`）
   - 预览: 显示候选 Skill 列表（ID、名称、hash、操作 create/update/blocked）
   - 冲突处理: 对 blocked 项显示覆盖/重命名/跳过选项
   - 执行: 确认后导入
   - 参考: AgentBro 的 InstallPage 中 local 导入部分

4. **InstallPage.vue** (安装页面 Tab)
   - 三个子 Tab: 本地导入、GitHub 导入、市场安装
   - 本地导入复用 ImportDialog 逻辑
   - 参考: `D:\AI\agentbro\src\components\skills-v2\InstallPage.tsx`

### Acceptance criteria

- [ ] 选择包含 `SKILL.md` 的文件夹，预览显示"将创建新 Skill"
- [ ] 选择不含 `SKILL.md` 的文件夹，显示阻止原因
- [ ] 导入同名同来源 Skill，显示"将更新"
- [ ] 导入同名不同来源 Skill，显示阻止，提供覆盖/重命名/跳过选项
- [ ] 选择重命名时，输入新 ID 后导入成功
- [ ] 导入后 Skill 库列表刷新，新 Skill 出现
- [ ] 中心库目录中可见新 Skill 的文件夹
- [ ] `npm run build` 通过

### AgentBro 参考路径

| SpaceCode 目标文件 | AgentBro 参考文件 |
|---|---|
| `electron/skillManagerV2/service.ts` (导入逻辑) | `src-tauri/src/skills/v2/service.rs` (preview_add_center_skill, execute_add_center_skill) |
| IPC handlers | `src-tauri/src/skills/v2/commands.rs` |
| `src/components/skills-v2/InstallPage.vue` | `src/components/skills-v2/InstallPage.tsx` |

---

## Slice 4: 分发到 Agent — 软链接/Copy、预览/执行、Fallback

**Blocked by**: Slice 2

### What to build

将中心库 Skill 以 link 或 copy 方式分发到 Agent 目录：

1. **分发逻辑** (`electron/skillManagerV2/service.ts` 扩展)
   - `previewDistribute(skillIds, targetAgents, requestedMode)`: 生成 DistributionPreview（changes + blockers）
   - `executeDistribute(preview)`: 执行文件操作 + 写入 target + claim
   - link 创建: `fs.symlinkSync(centerPath, targetPath)`，失败时根据 linkFailPolicy fallback 为 copy
   - copy 创建: `fs.cpSync(centerPath, targetPath, {recursive: true})`
   - 阻止规则: 目标存在且未管理同名→blocked，需先接管
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\service.rs` 的 `preview_distribute()` 和 `execute_distribute()` 方法

2. **IPC 命令**
   - `skill-manager:preview-distribute`
   - `skill-manager:execute-distribute`
   - `skill-manager:delete-target` (从单个 Agent 移除)
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\commands.rs`

3. **DistributeDialog.vue**
   - 选择目标 Agent（多选 checkbox）
   - 选择分发方式（link/copy radio）
   - 预览: 显示每个 Skill×Agent 的操作（create/reuse/blocked）
   - 执行: 确认后执行，显示结果
   - 参考: `D:\AI\agentbro\src\components\skills-v2\DistributeDialog.tsx`

4. **Skill 卡片更新**
   - 在 SkillCard 上显示已安装 Agent 的图标徽章
   - 鼠标 hover 显示 Agent 名称、模式、状态
   - 参考: `D:\AI\agentbro\src\components\skills-v2\SkillLibraryPage.tsx` 的 `AgentBadges` 组件

### Acceptance criteria

- [ ] 选择 1 个 Skill + 2 个 Agent，预览显示 2 个 create 操作
- [ ] 选择 link 模式，执行后 Agent 目录中存在软链接，DB target.actualMode = 'link'
- [ ] Windows 上 link 失败时自动 fallback 为 copy，DB target.actualMode = 'copy'
- [ ] 对已存在且已管理的 target 再次分发，显示 reuse，不重复写文件
- [ ] 对存在未管理同名的 Agent 分发，显示 blocked，提示先接管
- [ ] 分发后 Skill 卡片上出现 Agent 图标徽章
- [ ] 从 Agent 详情中删除 target 后，Agent 目录中的文件/链接被移除
- [ ] `npm run build` 通过

### AgentBro 参考路径

| SpaceCode 目标文件 | AgentBro 参考文件 |
|---|---|
| `electron/skillManagerV2/service.ts` (分发逻辑) | `src-tauri/src/skills/v2/service.rs` (preview_distribute, execute_distribute) |
| `electron/skillManagerV2/fsutil.ts` (create_link) | `src-tauri/src/skills/v2/fsutil.rs` (create_link 函数) |
| `src/components/skills-v2/DistributeDialog.vue` | `src/components/skills-v2/DistributeDialog.tsx` |

---

## Slice 5: Agent 扫描与接管 — 未管理检测、接管向导、批量接管

**Blocked by**: Slice 1 (需要 agent registry)

### What to build

扫描 Agent 目录发现未管理 Skill，提供接管向导：

1. **扫描逻辑** (`electron/skillManagerV2/service.ts` 扩展)
   - `scanAgentInventory(agentId)`: 扫描 Agent 的 skills_dir，对比 DB，分类: managed / unmanaged / conflict
   - `listUnmanaged()`: 返回所有未管理项
   - `previewAdopt(agentId, unmanagedId)`: 返回 AdoptPreview（中心库是否已有同名、可否快速接管、选项列表）
   - `executeAdopt(agentId, unmanagedId, option, renamedId?)`: 执行接管
   - `executeAdoptBatch(items)`: 批量接管
   - 接管选项: `import_to_center`（导入中心库，保留 Agent 文件）、`replace_with_link`（替换为软链接）、`replace_with_copy`（替换为 copy）
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\service.rs` 的 `scan_agent_inventory()`, `preview_adopt()`, `execute_adopt()` 方法

2. **IPC 命令**
   - `skill-manager:scan-agent-inventory`
   - `skill-manager:list-unmanaged`
   - `skill-manager:preview-adopt`
   - `skill-manager:execute-adopt`
   - `skill-manager:execute-adopt-batch`
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\commands.rs`

3. **首次启动迁移向导** (`src/components/skills-v2/MigrationWizard.vue`)
   - 首次进入 Skill Manager 时检测：如果中心库为空但 Agent 目录有 Skills，自动弹出向导
   - 步骤 1: 扫描所有 Agent 目录
   - 步骤 2: 展示发现列表（Agent 名、Skill 名、状态: 可接管/冲突）
   - 步骤 3: 无冲突的批量选择接管方式（默认 replace_with_link）
   - 步骤 4: 有冲突的逐个确认（覆盖/重命名/跳过）
   - 步骤 5: 执行并显示结果

4. **AdoptDialog.vue**
   - 单个接管的选项选择
   - 冲突时的覆盖/重命名/跳过选择
   - 参考: `D:\AI\agentbro\src\components\skills-v2\AdoptDialog.tsx`

### Acceptance criteria

- [ ] Agent 目录中有 Skill 但 DB 无记录时，扫描结果显示"未管理"
- [ ] 选择"导入中心库"接管后，中心库出现该 Skill，Agent 文件保留不变
- [ ] 选择"替换为 link"接管后，Agent 目录中的原文件变为软链接，DB actualMode = 'link'
- [ ] 同名但 hash 不同时，标记为冲突，不自动接管
- [ ] 首次启动中心库为空但 Agent 有 Skills 时，自动弹出迁移向导
- [ ] 向导中批量接管无冲突 Skills 后，中心库和 Agent 目录状态正确
- [ ] 向导中有冲突的 Skills 需要逐个确认
- [ ] `npm run build` 通过

### AgentBro 参考路径

| SpaceCode 目标文件 | AgentBro 参考文件 |
|---|---|
| `electron/skillManagerV2/service.ts` (扫描+接管) | `src-tauri/src/skills/v2/service.rs` (scan_agent_inventory, preview_adopt, execute_adopt, execute_adopt_batch) |
| `src/components/skills-v2/MigrationWizard.vue` | 无直接对应（AgentBro 无首次向导，需新建） |
| `src/components/skills-v2/AdoptDialog.vue` | `src/components/skills-v2/AdoptDialog.tsx` |

---

## Slice 6: 技能包 — 创建、编辑、应用、撤销

**Blocked by**: Slice 4 (需要分发逻辑)

### What to build

技能包管理：一组中心库 Skill ID 的命名集合，可一键应用到多个 Agent 或撤销：

1. **技能包逻辑** (`electron/skillManagerV2/service.ts` 扩展)
   - `listPacks()`: 返回 SkillPackSummary[]
   - `getPackDetail(packId)`: 返回 SkillPackDetail（成员 + 已应用 Agent）
   - `upsertPack(input)`: 创建或更新技能包
   - `deletePack(packId)`: 删除技能包（预览影响）
   - `previewApplyPack(packId, targetAgents, requestedMode)`: 复用分发逻辑生成预览
   - `executeApplyPack(packId, targetAgents, requestedMode)`: 执行分发 + 写入 pack claim
   - `previewRemovePackFromAgent(packId, agentId)`: 预览撤销（哪些 target 会被删除，哪些保留）
   - `removePackFromAgent(packId, agentId)`: 执行撤销（只删 pack claim，保留其他 claim 的 target）
   - Claim 规则: 一个 target 可以有多个 claim（direct + 多个 pack），只有所有 claim 都删除时才删文件
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\service.rs` 的技能包相关方法

2. **IPC 命令**
   - `skill-manager:list-packs`
   - `skill-manager:get-pack-detail`
   - `skill-manager:upsert-pack`
   - `skill-manager:delete-pack`
   - `skill-manager:preview-apply-pack`
   - `skill-manager:execute-apply-pack`
   - `skill-manager:preview-remove-pack-from-agent`
   - `skill-manager:execute-remove-pack-from-agent`
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\commands.rs`

3. **SkillPackPage.vue**
   - 左侧技能包列表: 名称、成员数、已应用 Agent 数、健康状态
   - 右侧技能包详情: 基本信息、成员 Skills、已应用 Agent、操作按钮
   - 创建/编辑流程: 名称 → 选 Skills → 预览 → 保存
   - 应用流程: 选 Agent → 预览影响 → 执行
   - 撤销流程: 预览（显示哪些 target 保留/删除）→ 执行
   - 参考: `D:\AI\agentbro\src\components\skills-v2\SkillPackPage.tsx`

### Acceptance criteria

- [ ] 创建技能包: 输入名称、选择 3 个 Skill，保存成功
- [ ] 空名称保存时阻止并提示
- [ ] 应用技能包到 2 个 Agent: 每个 Skill 在每个 Agent 中创建 target + pack claim
- [ ] 重复应用同一技能包到同一 Agent: 不产生重复 claim
- [ ] 两个包包含同一 Skill，都应用到同一 Agent: target 有 2 个 pack claim，文件只有 1 份
- [ ] 撤销一个包: 只删该包的 claim，另一个包的 claim 保留，文件保留
- [ ] 撤销最后一个 claim: 删除 Agent 文件/link 和 target
- [ ] 删除技能包时预览受影响 Agent
- [ ] `npm run build` 通过

### AgentBro 参考路径

| SpaceCode 目标文件 | AgentBro 参考文件 |
|---|---|
| `electron/skillManagerV2/service.ts` (技能包逻辑) | `src-tauri/src/skills/v2/service.rs` (upsert_pack, apply_pack, remove_pack_from_agent) |
| `src/components/skills-v2/SkillPackPage.vue` | `src/components/skills-v2/SkillPackPage.tsx` |

---

## Slice 7: Copy 同步 — 过期/修改/分叉检测、同步操作

**Blocked by**: Slice 4 (需要 copy target 存在)

### What to build

检测 copy 安装的 Skill 副本与中心库的差异，提供同步操作：

1. **同步逻辑** (`electron/skillManagerV2/service.ts` 扩展)
   - `previewSyncCopy(targetId)`: 计算中心库 hash + Agent copy hash，判断状态:
     - `ok`: hash 一致
     - `copy_outdated`: 中心库更新了，Agent copy 没变
     - `copy_modified`: Agent copy 改了，中心库没变
     - `copy_diverged`: 两边都变了
   - `executeSyncCopy(targetId, action)`: 执行同步
     - `center_over_agent`: 中心库覆盖 Agent，更新 source_hash
     - `agent_over_center`: Agent 覆盖中心库，记录来源为 agent_override
     - `manual`: 保留分叉状态
   - `previewCopyTargetDiff(targetId)`: 文件级 diff 预览
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\service.rs` 的 `preview_sync_copy()` 和 `execute_sync_copy()` 方法

2. **IPC 命令**
   - `skill-manager:preview-sync-copy`
   - `skill-manager:execute-sync-copy`
   - `skill-manager:preview-copy-diff`
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\commands.rs`

3. **CopySyncDialog.vue**
   - 显示状态: ok / outdated / modified / diverged
   - 提供操作按钮: 中心覆盖 Agent / Agent 覆盖中心 / 保留分叉
   - diverged 时禁止自动覆盖
   - 参考: AgentBro SkillDetailSlider 中的 copy sync 部分

4. **Skill 卡片/列表标记**
   - 有 copy diff 的 Skill 显示 "Diff" 标记
   - 参考: `D:\AI\agentbro\src\components\skills-v2\SkillLibraryPage.tsx` 的 `CopyDiffMarker`

### Acceptance criteria

- [ ] 修改中心库 Skill 文件后，copy target 状态变为 `copy_outdated`
- [ ] 修改 Agent copy 后，状态变为 `copy_modified`
- [ ] 两边都修改后，状态变为 `copy_diverged`
- [ ] `center_over_agent` 执行后，Agent copy 被更新，source_hash 更新
- [ ] `agent_over_center` 执行后，中心库被更新，source 记录 agent_override
- [ ] `copy_diverged` 时不允许自动覆盖
- [ ] 有 diff 的 Skill 卡片上显示 "Diff" 标记
- [ ] `npm run build` 通过

### AgentBro 参考路径

| SpaceCode 目标文件 | AgentBro 参考文件 |
|---|---|
| `electron/skillManagerV2/service.ts` (copy 同步) | `src-tauri/src/skills/v2/service.rs` (preview_sync_copy, execute_sync_copy, preview_copy_target_diff) |
| `src/components/skills-v2/CopySyncDialog.vue` | AgentBro SkillDetailSlider 中的 copy sync 部分 |

---

## Slice 8: 诊断引擎 — 问题检测、一键修复、确认修复

**Blocked by**: Slice 5 (需要 unmanaged 检测), Slice 7 (需要 copy sync 检测)

### What to build

扫描整个系统生成诊断问题列表，提供分级修复：

1. **诊断引擎** (`electron/skillManagerV2/diagnosis.ts`)
   - `run()`: 扫描 DB + 文件系统，生成 DiagnosisIssue 列表
   - 检测项:
     - 中心库未入库目录
     - Agent 目录未管理 Skill
     - 坏链接（link 指向不存在的中心库目录）
     - 失效 target（DB 有记录但文件不存在）
     - copy 分叉
     - 技能包成员缺失
     - 孤立 claim（pack claim 存在但 target 不存在）
     - JSON 快照落后
   - 修复分级: `auto`（一键修复）/ `confirm`（需确认）/ `manual`（手动处理）/ `info`（只读建议）
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\diagnosis.rs` 的 `run()` 函数和各检测函数

2. **IPC 命令**
   - `skill-manager:run-diagnosis`
   - `skill-manager:list-diagnosis-issues`
   - `skill-manager:execute-safe-fixes` (只执行 auto 级别)
   - `skill-manager:preview-fix-issue` / `skill-manager:execute-fix-issue`
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\commands.rs`

3. **DiagnosisPage.vue**
   - 顶部: "运行诊断" 按钮 + 问题计数
   - 问题分组: 按严重度（error/warning/info）和类型
   - 每个问题: 标题、详情、操作按钮
   - 一键修复: 只执行 auto 级别问题
   - 确认修复: 弹出 PreviewDialog 确认
   - 修复后自动重新扫描
   - 参考: `D:\AI\agentbro\src\components\skills-v2\DiagnosisPage.tsx`

### Acceptance criteria

- [ ] 点击"运行诊断"后生成问题列表
- [ ] Agent 目录有未管理 Skill 时，显示"可接管"建议
- [ ] link 指向不存在的中心库目录时，显示"坏链接"问题，可一键清理
- [ ] DB 有 target 记录但文件不存在时，显示"失效 target"问题，可一键清理
- [ ] copy 分叉显示为需要确认，不进入一键修复
- [ ] 一键修复只执行 auto 级别问题
- [ ] 修复后重新扫描，已修复的问题消失
- [ ] `npm run build` 通过

### AgentBro 参考路径

| SpaceCode 目标文件 | AgentBro 参考文件 |
|---|---|
| `electron/skillManagerV2/diagnosis.ts` | `src-tauri/src/skills/v2/diagnosis.rs` |
| `src/components/skills-v2/DiagnosisPage.vue` | `src/components/skills-v2/DiagnosisPage.tsx` |

---

## Slice 9: Agent 管理页面 — Agent 列表、详情、健康

**Blocked by**: Slice 1 (需要 agent registry), Slice 5 (需要扫描逻辑)

### What to build

以 Agent 为中心查看完整状态：

1. **Agent 详情逻辑** (`electron/skillManagerV2/service.ts` 扩展)
   - `getAgentDetail(agentId)`: 返回 AgentDetail（版本、路径、Skills 列表、已应用 Packs、健康问题）
   - `scanAgentDetail(agentId)`: 刷新单个 Agent 状态
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\service.rs` 的 `get_agent_detail()` 方法

2. **IPC 命令**
   - `skill-manager:get-agent-detail`
   - `skill-manager:scan-agent-detail`
   - `skill-manager:list-agents`
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\commands.rs`

3. **AgentManagementPage.vue**
   - 左侧 Agent 列表: 名称、图标、已管理 Skill 数、未管理数、安装状态
   - 右侧 Agent 详情:
     - 版本信息（当前版本、安装路径）
     - Skills 列表（已管理 link/copy/冲突、未管理）
     - 已应用技能包列表
     - 健康问题（目录缺失、权限问题等）
   - 操作: 扫描当前 Agent、应用技能包、打开 Agent 目录
   - 参考: `D:\AI\agentbro\src\components\skills-v2\AgentManagementPage.tsx`

### Acceptance criteria

- [ ] Agent 列表显示 4 个内置 Agent（Claude Code, Codex, Cursor, Trae）
- [ ] 点击 Agent 后右侧详情显示其 Skills 目录路径和已安装 Skills
- [ ] 已管理 Skill 显示 link/copy 模式和状态
- [ ] 未管理 Skill 标记并显示"接管"按钮
- [ ] 已应用技能包列表正确显示
- [ ] 点击"扫描"刷新 Agent 状态
- [ ] 点击"打开目录"在文件管理器中打开 Agent 的 skills 目录
- [ ] `npm run build` 通过

### AgentBro 参考路径

| SpaceCode 目标文件 | AgentBro 参考文件 |
|---|---|
| `electron/skillManagerV2/service.ts` (agent detail) | `src-tauri/src/skills/v2/service.rs` (get_agent_detail) |
| `src/components/skills-v2/AgentManagementPage.vue` | `src/components/skills-v2/AgentManagementPage.tsx` |

---

## Slice 10: i18n + 收尾 — 翻译、错误/空/加载状态、样式打磨

**Blocked by**: Slice 2-9 全部完成

### What to build

1. **i18n 翻译**
   - 在 `src/i18n/locales/zh-CN.ts` 和 `src/i18n/locales/en-US.ts` 中添加 `skillManager` 命名空间
   - 所有 UI 文案使用 `t('skillManager.xxx')` 调用
   - 翻译键覆盖: Tab 标题、按钮文案、状态标签、来源标签、空状态、错误提示、确认对话框文案

2. **状态完善**
   - Loading 状态: 所有异步操作显示 loading 指示器
   - Error 状态: 所有操作失败显示可读错误信息和建议
   - Empty 状态: 中心库为空、无技能包、无诊断问题时的友好空状态
   - Disabled 状态: 操作按钮在 loading 或数据不满足时禁用

3. **样式打磨**
   - 参考 `D:\AI\agentbro\src\components\skills-v2\SkillManagerV2.css` 的视觉风格
   - 适配 SpaceCode 的 CSS 变量体系（`var(--bg-primary)` 等）
   - 响应式: 1280px 和 390px 宽度下无横向溢出

4. **JSON 快照**
   - `skill-manager:export-snapshot`: 导出 JSON 快照到 `~/.spacecode/skills/spacecode-skills.snapshot.json`
   - 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\snapshot.rs`

### Acceptance criteria

- [ ] 所有 UI 文案有 zh-CN 和 en-US 翻译
- [ ] 切换语言后所有文案正确切换
- [ ] 中心库为空时显示友好的空状态提示
- [ ] 异步操作时按钮显示 loading 状态
- [ ] 操作失败时显示错误信息和修复建议
- [ ] 导出快照生成有效 JSON 文件
- [ ] `npm run build` 通过
- [ ] `npm run typecheck` 通过

### AgentBro 参考路径

| SpaceCode 目标文件 | AgentBro 参考文件 |
|---|---|
| `src/i18n/locales/zh-CN.ts` (skillManager 命名空间) | `src/i18n/locales/zh-CN.json` (skills 命名空间) |
| `src/i18n/locales/en-US.ts` (skillManager 命名空间) | `src/i18n/locales/en-US.json` (skills 命名空间) |
| `src/components/skills-v2/SkillManagerV2.scss` | `src/components/skills-v2/SkillManagerV2.css` |
| `electron/skillManagerV2/snapshot.ts` | `src-tauri/src/skills/v2/snapshot.rs` |

---

## 依赖关系图

```
Slice 1 (Foundation)
  ├── Slice 2 (Library) ──── Slice 3 (Import)
  │                └──────── Slice 4 (Distribute) ── Slice 6 (Packs)
  │                └──────── Slice 7 (Copy Sync)
  ├── Slice 5 (Scan & Adopt)
  └── Slice 9 (Agent Mgmt)
                                    Slice 8 (Diagnosis) ← 5, 7
                                              Slice 10 (i18n) ← 2-9
```

可并行的组合:
- Slice 3 + Slice 4 (都依赖 Slice 2，无互相依赖)
- Slice 5 + Slice 9 (都依赖 Slice 1，无互相依赖)
- Slice 6 + Slice 7 (都依赖 Slice 4，无互相依赖)

---

## 新会话续接指南

如果你在一个新的 AI 会话中接手这个任务，按以下步骤开始：

1. **阅读域术语**: 读 `CONTEXT.md` 了解 Center Library、Target、Claim、Skill Pack 等概念定义。
2. **阅读架构决策**: 读 `docs/adr/0001-skill-manager-v2-architecture.md` 了解技术选型。
3. **阅读 PRD**: 读 `docs/plans/2026-08-10-skill-manager-v2-prd.md` 了解完整需求和用户故事。
4. **阅读本文档**: 了解切片拆分和依赖关系。
5. **选择一个 Slice**: 从未完成的 Slice 开始，确认其前置依赖已完成。
6. **研究 AgentBro 参考**: 按 Slice 文档中的 "AgentBro 参考路径" 表格，阅读对应的 AgentBro 源码文件。
7. **实现**: 按 SpaceCode 的技术栈（Electron + Vue 3 + Pinia + better-sqlite3）重写。
8. **验证**: 运行 `npm run build` 和 `npm run typecheck` 确保通过。
