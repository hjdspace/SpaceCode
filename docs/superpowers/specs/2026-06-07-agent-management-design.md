# Agent 管理与编排设计文档

日期: 2026-06-07

## 概述

为 SpaceCode 桌面应用实现本地 Agent 管理机制，包含两个核心功能：

1. **Agent 安装**：将 `agents-lib` 目录下的预定义 agent 一键安装到 Claude Code 的 agent 目录
2. **Agent 编排**：可视化编排多个 agent 的执行流程，支持桌面端调度执行和导出为 .md 文件

## 背景

### Claude Code Agent 机制

Claude Code 支持自定义 subagent，定义方式为 Markdown 文件（YAML frontmatter + system prompt），存放位置：

- 项目级：`.claude/agents/<name>.md`
- 全局：`~/.claude/agents/<name>.md`

Frontmatter 字段：`name`（必填）、`description`（必填）、`tools`、`model`、`color`、`permissionMode`、`skills` 等。

### 现有架构

- SpaceCode 已有完善的 Skills 管理体系（SkillsManager、localSkills store、skillsService）
- `ClaudeCodeEngine.listAgents()` 已能扫描已安装 agent，但无独立管理界面
- `agents-lib/` 目录包含 60+ 预定义 agent
- Sidebar 的 `feature-nav` 区域已有 Skills 和 MCP 入口

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| UI 位置 | Sidebar feature-nav 中 Skills 下方，中心面板展示 | 与 Skills/MCP 平级，用户习惯一致 |
| 编排方式 | 可视化编排器 | 直观易用 |
| 执行方式 | 桌面端调度 + 导出 .md 两者兼备 | 精确可控 + 轻量分享 |
| 编排编辑器 | SVG + 拖拽（不引入重型图形库） | 轻量、可控 |

## 数据模型

### AgentDef — Agent 定义

```typescript
interface AgentDef {
  name: string           // frontmatter 中的 name
  description: string    // frontmatter 中的 description
  content: string        // 完整 .md 文件内容
  tools?: string[]       // 允许的工具列表
  model?: string         // sonnet / opus / haiku / inherit
  color?: string         // 显示颜色
  sourceDir: string      // 来源目录（agents-lib 中的路径）
  agentPath: string      // .md 文件绝对路径
  isInstalled: boolean   // 是否已安装
  installedScope?: 'global' | 'project'  // 安装范围
  category: string       // 分类（reviewer / builder / architect / security / general）
}
```

### WorkflowDef — 编排工作流

```typescript
interface WorkflowDef {
  id: string
  name: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: Date
  updatedAt: Date
}

interface WorkflowNode {
  id: string
  type: 'agent' | 'condition' | 'merge' | 'input' | 'output'
  position: { x: number; y: number }
  data: AgentNodeData | ConditionNodeData | MergeNodeData
}

interface AgentNodeData {
  agentName: string
  inputTemplate?: string  // 可用变量：{{prevOutput}}, {{input}}
  label?: string
}

interface ConditionNodeData {
  condition: string       // 自然语言条件描述，由 LLM 判断
  trueLabel?: string
  falseLabel?: string
}

interface MergeNodeData {
  strategy: 'concat' | 'summarize'
  prompt?: string
}

interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourcePort?: 'true' | 'false' | 'default'
}
```

## Agent 安装功能

### 安装流程

1. 后端扫描 `agents-lib` 目录，解析每个 `.md` 文件的 YAML frontmatter
2. 检查 `~/.claude/agents/` 和 `.claude/agents/` 中是否已存在同名 agent
3. 用户点击安装 → 选择 scope（全局/项目）→ 复制 `.md` 文件到目标目录
4. 卸载 → 删除目标目录中的 `.md` 文件

### 分类推断

根据 agent name 中的关键词自动分类：

- `*-reviewer` → reviewer（代码审查）
- `*-resolver` / `*-builder` / `build-*` → builder（构建修复）
- `architect` / `planner` → architect（架构设计）
- `security-*` → security（安全）
- 其他 → general（通用）

### IPC 接口

| 通道 | 参数 | 返回 |
|------|------|------|
| `agents:scanLibrary` | `cwd?: string` | `{ agents: AgentDef[] }` |
| `agents:install` | `name, scope, cwd?` | `{ success: boolean }` |
| `agents:uninstall` | `name, scope, cwd?` | `{ success: boolean }` |
| `agents:getInstalled` | `cwd?: string` | `{ agents: AgentDef[] }` |

## Agent 编排功能

### 可视化编排编辑器

采用 SVG + 拖拽实现的简化流程图编辑器，支持 5 种节点类型：

- **Input**：工作流输入，用户填写初始 prompt
- **Agent**：执行某个已安装的 agent
- **Condition**：条件分支，根据上一步输出判断走 true/false 分支
- **Merge**：合并多个分支输出（concat 直接拼接 / summarize 由 LLM 总结）
- **Output**：工作流最终输出

### 桌面端调度执行

执行流程：

1. 用户点击"执行"，填写 Input 节点的初始 prompt
2. 从 Input 节点开始，按 edges 拓扑排序
3. 对每个 Agent 节点：
   a. 通过 `claudeCode.startSession()` 创建新会话
   b. 将 `inputTemplate` 渲染后作为初始消息发送
   c. 监听 `onResult` 获取输出
   d. 将输出传递给下游节点
4. 条件节点：将上一步输出 + condition 发送给 LLM 判断 true/false
5. 聚合节点：按 strategy 合并多个输入
6. 执行完毕，展示最终 Output

### 导出为编排 agent .md

将工作流转换为 Claude Code 原生 agent 文件，写入 `.claude/agents/` 目录。编排逻辑以结构化 prompt 形式写入 system prompt，由 Claude Code 原生 spawn 机制执行。

### 编排 IPC 接口

| 通道 | 参数 | 返回 |
|------|------|------|
| `agents:listWorkflows` | — | `{ workflows: WorkflowDef[] }` |
| `agents:saveWorkflow` | `workflow: WorkflowDef` | `{ success: boolean }` |
| `agents:deleteWorkflow` | `id: string` | `{ success: boolean }` |
| `agents:runWorkflow` | `id, input, cwd?` | `{ sessionId: string }` |
| `agents:exportWorkflow` | `id` | `{ content: string, path: string }` |

### 编排存储

工作流配置保存到 `~/.claude/agent-workflows/` 目录，每个工作流一个 JSON 文件。

## 前端组件

### 新增文件清单

| 层级 | 文件 | 职责 |
|------|------|------|
| 前端 Store | `src/stores/agents.ts` | Agent 状态管理（列表、安装、编排） |
| 前端组件 | `src/components/agents/AgentManager.vue` | 主面板（3 tabs） |
| 前端组件 | `src/components/agents/AgentLibrary.vue` | Agent 库浏览 |
| 前端组件 | `src/components/agents/AgentCard.vue` | Agent 卡片 |
| 前端组件 | `src/components/agents/AgentDetail.vue` | Agent 详情/编辑 |
| 前端组件 | `src/components/agents/InstalledAgents.vue` | 已安装列表 |
| 前端组件 | `src/components/agents/WorkflowEditor.vue` | 可视化编排编辑器 |
| 前端组件 | `src/components/agents/WorkflowRunner.vue` | 编排执行面板 |
| 后端服务 | `electron/agentsService.ts` | Agent IPC 处理（扫描、安装、卸载、编排执行） |

### 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `src/stores/app.ts` | 新增 `showAgentManager` 状态 |
| `src/components/layout/Sidebar.vue` | feature-nav 中新增 Agents 按钮 |
| `src/App.vue` | 中心面板新增 AgentManager 条件渲染 |
| `electron/preload.ts` | 新增 agents 相关 IPC 通道 |
| `electron/main.ts` | 注册 agentsService IPC handlers |
| `src/i18n/locales/zh-CN.ts` | 新增 agents 相关翻译 |
| `src/i18n/locales/en-US.ts` | 新增 agents 相关翻译 |

### UI 布局

**Sidebar 入口**：在 feature-nav 中 Skills 下方添加 Agents 按钮（Cpu 图标）。

**AgentManager 主面板**：3 个 tab — Agent 库 / 已安装 / 编排。

**Agent 库 tab**：左侧分类侧栏 + 右侧卡片网格，支持搜索和分类过滤。点击卡片进入详情页，可查看完整 prompt、选择安装范围并安装。

**已安装 tab**：分全局/项目两组展示已安装 agent，支持卸载和编辑。

**编排 tab**：列表展示已创建的工作流，每个可编辑/执行/导出/删除。点击"新建编排"进入 WorkflowEditor。

**WorkflowEditor**：SVG 画布 + 底部节点面板，拖拽添加节点，连线定义流程。顶部工具栏包含保存和执行按钮。

**WorkflowRunner**：模态面板，实时展示每个节点的执行状态和输出。

## 错误处理

- 安装时目标已存在同名 agent → 提示用户是否覆盖
- 编排执行中某个 agent 失败 → 标记失败节点，终止下游节点，展示已完成的输出
- 导出时目标已存在同名 agent → 提示用户是否覆盖
- agents-lib 目录不存在 → 返回空列表，不报错

## 测试策略

- 单元测试：agentsService 中的 frontmatter 解析、分类推断、安装/卸载逻辑
- 集成测试：IPC 通道端到端测试
- 手动测试：完整安装/卸载/编排/执行/导出流程
