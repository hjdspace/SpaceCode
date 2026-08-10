# Skill Manager V2 — 产品需求设计 (PRD)

> **状态**: ready-for-agent
> **更新时间**: 2026-08-10
> **适用范围**: SpaceCode 桌面端 Skill 管理模块
> **参考项目**: AgentBro (`D:\AI\agentbro`)
> **域术语**: 见 `CONTEXT.md`
> **架构决策**: 见 `docs/adr/0001-skill-manager-v2-architecture.md`

---

## Problem Statement

SpaceCode 用户在多个 AI Agent（Claude Code、Codex、Cursor、Trae）之间管理 Skill 时面临以下痛点：

1. **Case 1 — 手动复制分发**：自己写的 Skill，改完还要逐个复制到每个 Agent 目录。没有中心库，没有软链接。
2. **Case 2 — 存量不可见**：到底有多少 Skill 没被管起来？散落在各个 Agent 目录里的存量技能无法被统一发现和接管。
3. **Case 3 — 同名冲突**：扫描存量时发现同名 Skill，不知道该听谁的。同名不代表内容相同，可能是旧副本也可能是两套碰巧重名的 Skill。
4. **Case 4 — 社区 Skill 试用**：看到好用的社区 Skill，不敢直接塞进生产 Agent。需要试用区来安全验证。
5. **Case 5 — 开发中 Skill 误触发**：正在调试的 Skill 和生产 Skill 混在一起，Agent 自动触发了不该触发的 Skill。
6. **Case 6 — 切换太麻烦**：测试包和生产包分开后，每次切换都要打开设置、找到 Agent、翻到技能包页面，操作链路太长。

## Solution

参照 AgentBro Skill Manager v2 的设计，在 SpaceCode 中实现一套中心化的 Skill 管理系统：

- **中心库** (`~/.spacecode/skills`)：所有 Skill 的 single source of truth。
- **SQLite 数据库** (`~/.spacecode/skill-manager/skill-manager.db`)：记录 Skill 元数据、Agent 注册表、安装 Target、Claim、技能包、未管理项、诊断问题。
- **软链接分发**：中心库 Skill 以 symlink 分发到各 Agent 目录，中心库更新后自动生效。Windows 上 link 失败自动 fallback 为 copy。
- **Agent 扫描与接管**：扫描已安装 Agent 的 Skill 目录，发现未管理 Skill 并提供接管向导。
- **冲突处理**：同名 Skill 来自不同来源时，默认阻止，由用户选择覆盖/重命名/跳过。
- **技能包**：一组中心库 Skill ID，可一键应用到多个 Agent 或撤销。
- **诊断引擎**：扫描坏链接、未管理项、copy 分叉、过期快照等问题，提供修复建议。
- **全屏页面 UI**：左侧 Tab 导航 + 右侧内容区，包含 6 个 Tab：Skill 库、安装、技能包、Agent 管理、诊断与修复、设置。

## User Stories

### 中心库管理

1. As a SpaceCode user, I want a central Skill library at `~/.spacecode/skills`, so that all my Skills live in one place instead of being scattered across Agent directories.
2. As a SpaceCode user, I want to import a Skill from a local folder into the center library, so that it becomes managed by SpaceCode.
3. As a SpaceCode user, I want to import a Skill from a zip archive, so that I can add downloaded Skills without manual extraction.
4. As a SpaceCode user, I want to batch-import Skills from a directory containing multiple Skill subdirectories, so that I can onboard many Skills at once.
5. As a SpaceCode user, I want to see a card view of all center library Skills, so that I can browse Skills visually.
6. As a SpaceCode user, I want to switch to a list view of center library Skills, so that I can scan many Skills compactly.
7. As a SpaceCode user, I want to search Skills by name, description, source, or installed Agent, so that I can find a specific Skill quickly.
8. As a SpaceCode user, I want to filter Skills by status (ok, conflict, copyDiverged, unmanaged), so that I can find problematic Skills.
9. As a SpaceCode user, I want to filter Skills by source type, so that I can distinguish community Skills from my own.
10. As a SpaceCode user, I want to view a Skill's detail panel showing its path, source, frontmatter, installed Agents, and Claims, so that I understand its full lifecycle.
11. As a SpaceCode user, I want to delete a center library Skill with a preview of affected Agent installations, so that I don't accidentally break Agents.
12. As a SpaceCode user, I want to open a Skill's directory in my file manager, so that I can inspect or edit its files directly.
13. As a SpaceCode user, I want to see top-level metrics (center Skill count, Agent target count, unmanaged count, issue count), so that I have a health overview at a glance.

### Agent 分发

14. As a SpaceCode user, I want to distribute a center library Skill to one or more Agents via symlink, so that center library edits propagate automatically.
15. As a SpaceCode user, I want to distribute a Skill via copy instead of link, so that I can make Agent-specific modifications.
16. As a SpaceCode user, I want a distribution preview showing what will be created, reused, or blocked before execution, so that I can make informed decisions.
17. As a SpaceCode user, I want the system to auto-fallback to copy when symlink creation fails on Windows, so that distribution always succeeds.
18. As a SpaceCode user, I want to batch-distribute multiple Skills to the same set of Agents, so that I don't have to distribute one by one.
19. As a SpaceCode user, I want to see which Agents a Skill is installed in via icon badges on the Skill card, so that I know its distribution status at a glance.
20. As a SpaceCode user, I want to remove a Skill from a specific Agent without deleting it from the center library, so that I can selectively undistribute.

### 扫描与接管

21. As a SpaceCode user, I want the system to scan all known Agent directories for installed Skills, so that I can see what's already deployed.
22. As a SpaceCode user, I want to see unmanaged Skills (exist on disk but not in the database), so that I can decide whether to adopt them.
23. As a SpaceCode user, I want to adopt an unmanaged Skill into the center library, so that it becomes managed.
24. As a SpaceCode user, I want to choose how to adopt: keep the Agent file + import to center, replace Agent file with symlink, or replace with copy, so that I control the migration.
25. As a SpaceCode user, I want a first-run guided migration wizard that scans all Agents and presents a list for batch adoption, so that I don't have to adopt Skills one by one.
26. As a SpaceCode user, I want the wizard to auto-adopt non-conflicting Skills and only prompt me for conflicts, so that migration is fast but safe.
27. As a SpaceCode user, I want to batch-adopt multiple unmanaged Skills with a single confirmation, so that I can quickly onboard many Skills.

### 冲突处理

28. As a SpaceCode user, I want the system to detect same-name Skills from different sources, so that I don't accidentally overwrite one with another.
29. As a SpaceCode user, when a conflict is detected, I want to choose: overwrite center library, rename the incoming Skill, or skip, so that I have full control.
30. As a SpaceCode user, I want the default conflict resolution to be "center library version wins", so that I don't accidentally clobber my managed Skills.
31. As a SpaceCode user, I want to see a diff preview when choosing to overwrite, so that I understand what will change.
32. As a SpaceCode user, I want to reverse-overwrite the center library with an Agent's newer version when the Agent version is actually the one I want to keep, so that I can handle the case where the Agent directory has the latest edit.

### 技能包

33. As a SpaceCode user, I want to create a Skill Pack (named group of center library Skills), so that I can apply a set of Skills to an Agent in one action.
34. As a SpaceCode user, I want to apply a Skill Pack to multiple Agents, so that I can quickly set up a new Agent with the same Skill set.
35. As a SpaceCode user, I want to revoke a Skill Pack from an Agent, so that I can remove a group of Skills without affecting other Packs.
36. As a SpaceCode user, I want the revocation to only remove files when no other Claims remain on the Target, so that a Skill shared between Packs isn't deleted prematurely.
37. As a SpaceCode user, I want to see which Packs are applied to which Agents, so that I can manage Pack assignments.
38. As a SpaceCode user, I want to edit a Pack's membership (add/remove Skills), so that I can iterate on Pack composition.
39. As a SpaceCode user, I want to delete a Pack with a preview of affected Agent installations, so that I understand the impact.
40. As a SpaceCode user, I want to use a "NiceTry-测试" Pack for community Skills I'm evaluating, so that I can safely try them before promoting to a stable Pack.
41. As a SpaceCode user, I want to use a "SZ-内容创作-测试" Pack for dev Skills and a "SZ-内容创作" Pack for production Skills, so that dev and prod don't interfere.

### Copy 同步

42. As a SpaceCode user, I want to see when a copy Target is outdated (center library updated), so that I can sync it.
43. As a SpaceCode user, I want to see when a copy Target has been modified locally, so that I can decide whether to push it back to center.
44. As a SpaceCode user, I want to see when a copy Target has diverged (both sides changed), so that I can manually resolve the conflict.
45. As a SpaceCode user, I want to sync an outdated copy by overwriting it with the center library version, so that it catches up.
46. As a SpaceCode user, I want to push an Agent's modified copy back to the center library, so that I can promote local edits.

### Agent 管理

47. As a SpaceCode user, I want to see a list of all known Agents (Claude Code, Codex, Cursor, Trae) with their Skill directory paths, so that I know what's being managed.
48. As a SpaceCode user, I want to view an Agent's detail page showing its Skills, applied Packs, and health issues, so that I can troubleshoot per-Agent.
49. As a SpaceCode user, I want to scan a specific Agent on demand, so that I can refresh its state after external changes.
50. As a SpaceCode user, I want to add a custom Agent with a name and Skill directory path, so that I can support Agents not in the built-in registry.
51. As a SpaceCode user, I want to see whether an Agent's Skill directory exists and is writable, so that I can detect path issues.

### 诊断与修复

52. As a SpaceCode user, I want to run a full diagnosis scan, so that I can see all health issues in one place.
53. As a SpaceCode user, I want diagnosis issues grouped by severity and type, so that I can prioritize fixes.
54. As a SpaceCode user, I want one-click safe fixes for low-risk issues (broken link cleanup, stale target cleanup), so that I don't have to fix them manually.
55. As a SpaceCode user, I want confirmation prompts for risky fixes (overwrite, delete, rename), so that I don't accidentally lose data.
56. As a SpaceCode user, I want to see "unmanaged Skill" diagnosis items with an "adopt" action, so that I can adopt directly from the diagnosis page.
57. As a SpaceCode user, I want to see "copy divergence" diagnosis items with sync options, so that I can resolve divergences directly.

### 设置

58. As a SpaceCode user, I want to configure the center library path, so that I can use a custom location.
59. As a SpaceCode user, I want to set the default distribution mode (link or copy), so that new distributions use my preference.
60. As a SpaceCode user, I want to set the link-fail policy (auto-fallback to copy or prompt), so that I control Windows symlink behavior.
61. As a SpaceCode user, I want to toggle startup scanning, so that I can skip the scan for faster startup.
62. As a SpaceCode user, I want to export a JSON snapshot of the entire Skill Manager state, so that I can backup or debug.
63. As a SpaceCode user, I want to see the SQLite database path, so that I can locate it for manual inspection.

### UI / UX

64. As a SpaceCode user, I want the Skill Manager to be a full-screen page (not a modal), so that I have enough space for the multi-tab layout.
65. As a SpaceCode user, I want a left-side tab navigation with icons, so that I can switch between Library, Install, Packs, Agents, Diagnostics, Settings quickly.
66. As a SpaceCode user, I want all destructive operations (delete, overwrite) to show a confirmation dialog with impact preview, so that I can't accidentally break things.
67. As a SpaceCode user, I want loading and error states on all async operations, so that I know when the system is working or has failed.
68. As a SpaceCode user, I want the UI to be fully internationalized (zh-CN + en-US), so that I can use it in my preferred language.

### 灵动岛菜单 (Case 6 — 后续迭代)

69. As a SpaceCode user, I want a quick-access menu (灵动岛风格) from the menu bar, so that I can toggle Skill Packs on/off without navigating to the full Skill Manager page.
70. As a SpaceCode user, I want the quick-access menu to show my Agents and their applied Packs with checkboxes, so that I can toggle Packs with one click.

---

## Implementation Decisions

### 架构总览

```
Vue 3 UI (src/components/skills-v2/*)
  ↓ Pinia store
Pinia Store (src/stores/skillManagerStore.ts)
  ↓ IPC invoke
Electron Preload (electron/preload.ts → contextBridge)
  ↓ ipcMain.handle
Electron Main (electron/skillManagerV2/index.ts)
  ├── Database (electron/skillManagerV2/db.ts) → better-sqlite3
  ├── Agent Registry (electron/skillManagerV2/agentRegistry.ts)
  ├── Scanner (electron/skillManagerV2/scanner.ts)
  ├── Service (electron/skillManagerV2/service.ts)
  ├── Diagnosis (electron/skillManagerV2/diagnosis.ts)
  └── Snapshot (electron/skillManagerV2/snapshot.ts)
```

### 技术栈映射

| AgentBro (源) | SpaceCode (目标) | 说明 |
|---|---|---|
| Tauri (Rust) | Electron (Node.js) | 后端语言从 Rust 改为 TypeScript |
| React + Zustand | Vue 3 + Pinia | 前端框架从 React 改为 Vue 3 |
| `src-tauri/src/skills/v2/` | `electron/skillManagerV2/` | 后端目录 |
| `src/stores/skillStoreV2.ts` | `src/stores/skillManagerStore.ts` | 前端 Store |
| `src/services/skillApiV2.ts` | `src/services/skillManagerApi.ts` | 前端 API 封装 |
| `src/components/skills-v2/` | `src/components/skills-v2/` | 前端组件目录 |
| `rusqlite` (Rust crate) | `better-sqlite3` (npm) | SQLite 驱动 |
| `sha2` (Rust crate) | Node.js `crypto` | Hash 计算 |
| `std::fs::symlink` | Node.js `fs.symlinkSync` | 软链接创建 |
| Tauri `invoke` | Electron `ipcMain.handle` / `ipcRenderer.invoke` | IPC 通信 |

### AgentBro 参考代码路径索引

> 以下路径相对于 `D:\AI\agentbro`

#### 后端 (Rust → TypeScript 重写参考)

| 功能 | AgentBro 文件 | 说明 |
|---|---|---|
| DTO / Models | `src-tauri/src/skills/v2/models.rs` | 全部数据传输对象、枚举、DB 行模型 |
| SQLite Schema + Migration | `src-tauri/src/skills/v2/db.rs` | Schema v4、迁移语句、typed row access |
| 文件系统工具 | `src-tauri/src/skills/v2/fsutil.rs` | Hash 计算、frontmatter 解析、递归复制、symlink 创建+fallback、文件树构建 |
| Agent 路径注册表 | `src-tauri/src/skills/agent_paths.rs` | `paths_for_agent()` 函数，定义各 Agent 的 skill 目录 |
| 核心业务逻辑 | `src-tauri/src/skills/v2/service.rs` | 中心库扫描、分发、target/claim 规则、技能包 apply/remove、copy 同步、删除 (~6700 行) |
| 诊断引擎 | `src-tauri/src/skills/v2/diagnosis.rs` | 问题检测 + 修复生成 (~1200 行) |
| Agent 元数据 | `src-tauri/src/skills/v2/agent_meta.rs` | Agent 版本检测、MCP/Plugin 状态 |
| JSON 快照 | `src-tauri/src/skills/v2/snapshot.rs` | 快照导出/恢复 |
| Tauri Commands | `src-tauri/src/skills/v2/commands.rs` | 对外 command 注册，参数校验 |
| Marketplace | `src-tauri/src/skills/marketplace.rs` | skills.sh API 搜索/安装 |
| Scanner (v1) | `src-tauri/src/skills/scanner.rs` | 旧版扫描逻辑参考 |
| Installer (v1) | `src-tauri/src/skills/installer.rs` | 旧版安装逻辑参考 |
| Sync | `src-tauri/src/skills/sync.rs` | 同步逻辑参考 |

#### 前端 (React → Vue 3 重写参考)

| 功能 | AgentBro 文件 | 说明 |
|---|---|---|
| Store | `src/stores/skillStoreV2.ts` | Zustand store，状态管理、过滤逻辑 |
| API 封装 + DTO | `src/services/skillApiV2.ts` | Tauri invoke 封装、全部 TypeScript 类型定义 |
| 主 Shell | `src/components/skills-v2/SkillManagerShell.tsx` | Tab 路由容器 |
| Skill 库页面 | `src/components/skills-v2/SkillLibraryPage.tsx` | 卡片/列表视图、搜索、筛选、批量管理 |
| Skill 详情 | `src/components/skills-v2/SkillDetailSlider.tsx` | 右侧滑出详情面板 |
| 安装页面 | `src/components/skills-v2/InstallPage.tsx` | 安装来源选择 (official/agent/local/git) |
| 技能包页面 | `src/components/skills-v2/SkillPackPage.tsx` | 技能包列表、创建、编辑、应用、撤销 |
| Agent 管理页面 | `src/components/skills-v2/AgentManagementPage.tsx` | Agent 列表、详情、Skills/Packs/MCP/Plugins |
| 诊断页面 | `src/components/skills-v2/DiagnosisPage.tsx` | 问题分组、一键修复、确认修复 |
| 设置页面 | `src/components/skills-v2/SettingsPageV2.tsx` | 中心库路径、默认分发方式、扫描设置 |
| 分发对话框 | `src/components/skills-v2/DistributeDialog.tsx` | 分发预览 + 执行 |
| 接管对话框 | `src/components/skills-v2/AdoptDialog.tsx` | 接管选项 + 执行 |
| 预览对话框 | `src/components/skills-v2/PreviewDialog.tsx` | 通用确认/预览弹窗 |
| 项目管理 | `src/components/skills-v2/ProjectManagementPage.tsx` | 项目级 Skill 扫描 |
| Agent 图标 | `src/components/skills-v2/AgentIconBadge.tsx` | Agent 图标徽章 |
| 样式 | `src/components/skills-v2/SkillManagerV2.css` | 全部样式 |
| 标签 | `src/components/skills-v2/skillLabels.ts` | 来源/状态标签映射 |
| Frontmatter 解析 | `src/components/skills-v2/frontmatter.ts` | 前端 frontmatter 解析 |
| 文件预览 | `src/components/skills-v2/filePreview.ts` | 文件内容预览 |

#### 设计文档参考

| 文档 | AgentBro 路径 |
|---|---|
| 产品需求 | `docs/plans/2026-06-13-skill-manager-v2-product-requirements.md` |
| 技术方案 | `docs/plans/2026-06-13-skill-manager-v2-technical-design.md` |
| 验收标准 | `docs/plans/2026-06-13-skill-manager-v2-acceptance-criteria.md` |
| 交付索引 | `docs/plans/2026-06-13-skill-manager-v2-handoff.md` |
| UI Demo | `docs/design-demos/agentbro-skill-manager-v2-demo.html` |

### SQLite Schema (从 AgentBro schema v4 移植)

> 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\db.rs` MIGRATIONS 数组

核心表:

```sql
-- Skill Manager v2 Schema (TypeScript 重写)
CREATE TABLE skills (
  id TEXT PRIMARY KEY,              -- 目录名作为默认 Skill ID
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  skill_type TEXT NOT NULL DEFAULT 'skill',
  center_path TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_scanned_at TEXT
);

CREATE TABLE skill_sources (
  skill_id TEXT PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,        -- local_folder | archive | github | url | agent_import | manual_center | marketplace
  source_uri TEXT,
  source_ref TEXT,
  imported_from_agent TEXT,
  imported_from_path TEXT,
  installed_via TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  skills_dir TEXT,
  config_path TEXT,
  mcp_config_path TEXT,
  plugin_dir TEXT,
  version TEXT,
  latest_version TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scanned_at TEXT
);

CREATE TABLE skill_targets (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_path TEXT NOT NULL,
  install_mode TEXT NOT NULL,       -- link | copy
  actual_mode TEXT NOT NULL,        -- link | copy (实际安装模式，可能与 install_mode 不同)
  source_hash TEXT NOT NULL,        -- 安装时的中心库 hash
  current_hash TEXT,                -- Agent copy 当前 hash
  status TEXT NOT NULL,             -- ok | unmanaged | conflict | broken_link | copy_outdated | copy_modified | copy_diverged | missing
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(skill_id, agent_id, target_path)
);

CREATE TABLE skill_target_claims (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES skill_targets(id) ON DELETE CASCADE,
  claim_type TEXT NOT NULL,         -- direct | pack
  pack_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(target_id, claim_type, pack_id)
);

CREATE TABLE skill_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE skill_pack_members (
  pack_id TEXT NOT NULL REFERENCES skill_packs(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(pack_id, skill_id)
);

CREATE TABLE unmanaged_items (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL,
  agent_id TEXT,
  path TEXT NOT NULL,
  inferred_skill_id TEXT,
  hash TEXT,
  reason TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE diagnosis_issues (
 D  id TEXT PRIMARY KEY,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL,           -- info | warning | error
  entity_type TEXT NOT NULL,        -- skill | target | pack | agent | snapshot
  entity_id TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  fix_kind TEXT NOT NULL,           -- auto | confirm | manual | info
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
```

### Agent 注册表

> 参考: `D:\AI\agentbro\src-tauri\src\skills\agent_paths.rs` `paths_for_agent()` 函数

内置 Agent 定义:

| Agent ID | Display Name | Skills Directory | Config Path |
|---|---|---|---|
| `claude-code` | Claude Code | `~/.claude/skills` | `~/.claude/settings.json` |
| `codex` | Codex | `~/.codex/skills` | `~/.codex/config.toml` |
| `cursor` | Cursor | `~/.cursor/skills` | `~/.cursor/config.json` |
| `trae` | Trae | `~/.trae/skills` | `~/.trae/config.json` |

额外支持共享目录 `~/.agents/skills`（被 Codex 等通过 `~/.agents/skills` 引用）。

### IPC Command 列表

> 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\commands.rs`

SpaceCode 需实现的 IPC channel（命名前缀 `skill-manager:`）:

**Overview & Settings**
- `skill-manager:bootstrap` — 确保目录和数据库可用
- `skill-manager:init` — 执行启动扫描
- `skill-manager:overview` — 返回 SkillManagerOverview DTO
- `skill-manager:refresh` — 全量刷新
- `skill-manager:settings` — 获取设置
- `skill-manager:update-settings` — 更新设置

**Skill 库**
- `skill-manager:list-center-skills` — 列出中心库 Skills
- `skill-manager:get-skill-detail` — 获取 Skill 详情
- `skill-manager:preview-add-center-skill` — 预览添加到中心库
- `skill-manager:execute-add-center-skill` — 执行添加
- `skill-manager:preview-delete-center-skill` — 预览删除
- `skill-manager:execute-delete-center-skill` — 执行删除
- `skill-manager:open-path` — 在文件管理器中打开

**分发与接管**
- `skill-manager:preview-distribute` — 预览分发
- `skill-manager:execute-distribute` — 执行分发
- `skill-manager:scan-agent-inventory` — 扫描 Agent
- `skill-manager:preview-adopt` — 预览接管
- `skill-manager:execute-adopt` — 执行接管
- `skill-manager:execute-adopt-batch` — 批量接管
- `skill-manager:preview-sync-copy` — 预览 copy 同步
- `skill-manager:execute-sync-copy` — 执行 copy 同步
- `skill-manager:delete-target` — 删除单个 Target

**技能包**
- `* `skill-manager:list-packs`
- `skill-manager:get-pack-detail`
- `skill-manager:upsert-pack`
- `skill-manager:delete-pack`
- `skill-manager:preview-apply-pack`
- `skill-manager:execute-apply-pack`
- `skill-manager:preview-remove-pack-from-agent`
- `skill-manager:execute-remove-pack-from-agent`

**诊断**
- `skill-manager:run-diagnosis`
- `skill-manager:list-diagnosis-issues`
- `skill-manager:execute-safe-fixes`
- `skill-manager:export-snapshot`

### 前端 Pinia Store 状态

> 参考: `D:\AI\agentbro\src\stores\skillStoreV2.ts`

```typescript
interface SkillManagerState {
  activeTab: 'library' | 'install' | 'packs' | 'agents' | 'diagnostics' | 'settings'
  viewMode: 'cards' | 'list'
  overview: SkillManagerOverview | null
  settings: SkillManagerSettings | null
  skills: SkillSummary[]
  selectedSkillId: string | null
  selectedSkillDetail: SkillDetail | null
  selectedPackId: string | null
  selectedPackDetail: SkillPackDetail | null
  selectedAgentId: string | null
  selectedAgentDetail: AgentDetail | null
  agents: AgentSummary[]
  packs: SkillPackSummary[]
  issues: DiagnosisIssue[]
  unmanaged: UnmanagedItemDto[]
  filters: { query: string; source: string; status: string; type: string }
  loading: boolean
  error: string | null
  busyAction: string | null
  initialized: boolean
}
```

### 前端组件清单

> 参考: `D:\AI\agentbro\src\components\skills-v2/`

| 组件 | 对应 AgentBro 组件 | 职责 |
|---|---|---|
| `SkillManagerShell.vue` | `SkillManagerShell.tsx` | 主容器 + 左侧 Tab 导航 |
| `SkillLibraryPage.vue` | `SkillLibraryPage.tsx` | 中心库卡片/列表 + 搜索 + 筛选 + 批量管理 |
| `SkillDetailSlider.vue` | `SkillDetailSlider.tsx` | Skill 详情滑出面板 |
| `InstallPage.vue` | `InstallPage.tsx` | 安装来源选择 |
| `SkillPackPage.vue` | `SkillPackPage.tsx` | 技能包列表 + 创建 + 编辑 + 应用 |
| `AgentManagementPage.vue` | `AgentManagementPage.tsx` | Agent 列表 + 详情 |
| `DiagnosisPage.vue` | `DiagnosisPage.tsx` | 诊断问题列表 + 修复 |
| `SkillSettingsPage.vue` | `SettingsPageV2.tsx` | 设置 |
| `DistributeDialog.vue` | `DistributeDialog.tsx` | 分发预览对话框 |
| `AdoptDialog.vue` | `AdoptDialog.tsx` | 接管对话框 |
| `PreviewDialog.vue` | `PreviewDialog.tsx` | 通用确认对话框 |
| `AgentIconBadge.vue` | `AgentIconBadge.tsx` | Agent 图标徽章 |

### 目录哈希算法

> 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\fsutil.rs` `hash_dir()` 函数

- 遍历目录内所有文件
- 排除: `.git`, `.DS_Store`, `node_modules`, `target`, `__pycache__`, `.idea`, `.venv`, `venv`, `output`, `*.tmp`, `*.swp`
- 按相对路径排序
- SHA-256 哈希: 对每个文件，哈希其相对路径名 + 文件内容
- 输出 hex digest

### 软链接创建 + Fallback

> 参考: `D:\AI\agentbro\src-tauri\src\skills\v2\fsutil.rs` `create_link()` 函数

```
1. 尝试 fs.symlinkSync(centerPath, targetPath)
2. 如果成功 → actualMode = 'link'
3. 如果失败 (Windows EPERM/EXDEV) →
   a. 如果 linkFailPolicy === 'copy' → fs.cpSync(centerPath, targetPath, {recursive: true})
   b. actualMode = 'copy'
4. 返回 actualMode
```

### UI 导航集成

- 从 `appStore.showSkillsManager` (modal) 改为 `appStore.currentView = 'skill-manager'` (全屏页面)
- 在 `App.vue` 中，当 `currentView === 'skill-manager'` 时渲染 `<SkillManagerShell />`
- 侧边栏新增技能管理入口图标

---

## Testing Decisions

### 测试缝 (Seam)

**唯一测试缝**: Electron IPC 边界 (`ipcMain.handle` / `ipcRenderer.invoke`)。

- **后端测试**: 对 `electron/skillManagerV2/` 下的模块写单元测试，测试 `service.ts` 的公开方法。使用临时目录模拟 `~/.spacecode/skills` 和 Agent 目录。不测试 `better-sqlite3` 内部，只测试我们的 schema + query 逻辑。
- **前端测试**: 对 Pinia store 写测试，mock IPC 调用。测试状态流转（init → loadOverview → selectSkill → distribute → refresh）。不测试组件渲染（现有 SpaceCode 测试模式不含组件渲染测试）。
- **集成测试**: 在 `tests/electron/` 下用 Node test runner 测试端到端 IPC 流程：创建中心库 → 导入 Skill → 分发到 Agent → 扫描 → 诊断。

### 测试优先参考

- AgentBro 测试: `D:\AI\agentbro\src-tauri\src\skills\v2\tests.rs` (Rust 集成测试)
- AgentBro 前端测试: `D:\AI\agentbro\src\test\` (Vitest)
- SpaceCode 现有 Electron 测试模式: `tests/electron/*.test.ts` (Node test runner)
- SpaceCode 现有 composable 测试模式: `tests/composables/*.test.ts` (Vitest)

### 关键测试用例

1. Hash 稳定性: 同一目录两次哈希结果相同
2. Hash 排除: 包含 `node_modules` 的目录 hash 等于不包含的
3. Source conflict: 同名不同来源 → blocked
4. Target/Claim 删除: 删除一个 claim 时文件保留/删除逻辑
5. Pack apply/remove: 幂等性（重复 apply 不产生重复 claim）
6. Copy sync: outdated / modified / diverged 状态判断
7. Symlink fallback: Windows 上 link 失败 → copy + actualMode 正确
8. Migration: 旧 Skills 被正确扫描和标记为 unmanaged

---

## Out of Scope

1. **灵动岛菜单栏快捷操作 (Case 6)**: 标记为后续迭代，本 PRD 只定义全屏页面 UI。灵动岛菜单需要一个独立的 Electron Tray/Menu 组件，不在本次范围内。
2. **远程团队协作市场**: 不做云端账号同步、团队共享。
3. **Agent 自身版本自动更新**: 只展示版本信息，不执行更新。
4. **完整 Plugin 安装/升级**: Plugin 只读展示，不执行安装/升级。
5. **高级搜索和标签体系**: 基础搜索够用，不做 faceted search。
6. **操作历史回滚 UI**: 数据库记录操作但不提供回滚 UI。
7. **Project-level Skill 扫描**: AgentBro 有 ProjectManagementPage，本次不做项目级扫描，只做全局中心库。

## Further Notes

- `better-sqlite3` 已安装 (`npm install better-sqlite3 @types/better-sqlite3`)，需要在 `electron-builder` 配置中添加 `asarUnpack` 条目。
- Windows 上需要 Developer Mode 或管理员权限才能创建 symlink。SpaceCode 的策略是自动 fallback 为 copy，并在设置中记录 `linkFailPolicy: 'copy'`。
- 旧 `skillsService.ts` 不删除，新 `skillManagerV2/` 并行存在。旧 IPC handler 保留兼容，新页面只调用新 IPC。
- i18n: 所有新增 UI 文案需要同时添加 `zh-CN` 和 `en-US` 翻译。
- ADR 0001 已记录在 `docs/adr/0001-skill-manager-v2-architecture.md`。
- 域术语已记录在 `CONTEXT.md`。
