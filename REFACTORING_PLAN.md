# Claude Code TypeScript → Python 全面重构方案

> **文档版本**: v1.1
> **生成日期**: 2026-04-03
> **更新日期**: 2026-04-03 (基于深度代码对比分析)
> **源代码库**: `claude-code/src/` (TypeScript)
> **目标代码库**: `agent/` (Python)

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [架构对比总览](#2-架构对比总览)
3. [模块级详细对比分析](#3-模块级详细对比分析)
4. [未完成重构模块清单](#4-未完成重构模块清单)
5. [重构方案（按优先级）](#5-重构方案按优先级)
6. [详细重构步骤](#6-详细重构步骤)
7. [测试方案](#7-测试方案)
8. [风险评估与缓解措施](#8-风险评估与缓解措施)

---

## 1. 执行摘要

### 1.1 对比结论

| 维度 | TypeScript (原始) | Python (重构后) | 完成度 |
|------|-------------------|-----------------|--------|
| **核心类型定义** | Task.ts, Tool.ts, commands.ts | task.py, tool.py, commands.py | ✅ ~90% |
| **主入口/REPL** | main.tsx (Commander + React/Ink) | main.py (argparse + 简单循环) | ⚠️ ~40% |
| **工具注册** | tools.ts (~45+ 工具) | tools.py (~10 工具) | ⚠️ ~25% |
| **查询引擎** | QueryEngine.ts (完整) | query_engine.py (简化版) | ✅ ~80% |
| **API客户端** | claude.ts (~3400行, 完整流式调用) | claude.py + client.py (完整) | ✅ ~80% |
| **MCP客户端** | client.ts (~3300行, 多传输) | client.py (42行, 存根) | ❌ ~1% |
| **Bridge层** | 24个文件, 完整IPC | 26个文件, 基本对应 | ✅ ~75% |
| **命令系统** | 60+ 命令实现 | 50+ 命令文件 | ⚠️ ~50% |
| **服务层** | api/mcp/oauth/lsp/vcr/voice 等 | 部分存根，部分完整 | ⚠️ ~30% |
| **Utils工具函数** | 200+ 文件 | 250+ 文件 (含Python独有扩展) | ✅ ~70% |
| **UI/组件** | React/Ink 终端UI框架 | 无 (使用print输出) | N/A |
| **状态管理** | AppState.tsx (React状态) | app_state.py (简化) | ⚠️ ~50% |

### 1.2 关键发现

1. **核心骨架已搭建**：Task、Tool类型、基础命令注册、QueryEngine框架已完成
2. **关键服务缺失**：Claude API客户端和MCP客户端仅为存根，是功能运行的核心瓶颈
3. **工具集严重不足**：TS端有45+工具，Python端仅实现约10个核心工具
4. **UI层完全不同**：TS使用React/Ink终端UI框架，Python使用简单print输出
5. **Python端有独有扩展**：bash解析器、computer_use、模型管理等TS端没有的模块

---

## 2. 架构对比总览

### 2.1 TypeScript 架构图

```
claude-code/src/
├── main.tsx                    # Commander CLI入口 → React/Ink REPL
├── entrypoints/
│   ├── cli.tsx                 # CLI入口
│   ├── init.ts                 # 初始化
│   └── mcp.ts                  # MCP入口
├── Task.ts                     # 任务类型定义
├── Tool.ts                     # 工具接口定义 + buildTool()
├── tools.ts                    # 工具注册表 (getAllBaseTools/getTools)
├── commands.ts                 # 命令注册表 (COMMANDS)
├── QueryEngine.ts              # 查询引擎 (ask/submit_message)
├── context.ts                  # 系统上下文提供者
├── query.ts                    # 查询循环核心逻辑
├── history.ts                  # 会话历史管理
├── cost-tracker.ts             # 成本追踪
│
├── tools/                      # 工具实现 (~25个目录, 45+工具)
│   ├── BashTool/               # Shell命令执行
│   ├── AgentTool/              # 子代理启动
│   ├── FileReadTool/           # 文件读取
│   ├── FileEditTool/           # 文件编辑
│   ├── FileWriteTool/          # 文件写入
│   ├── GlobTool/               # 文件搜索(glob)
│   ├── GrepTool/               # 内容搜索(ripgrep)
│   ├── WebFetchTool/           # URL获取
│   ├── WebSearchTool/          # 网络搜索
│   ├── LSPTool/                # 语言服务器协议
│   ├── MCPTool/                # MCP工具代理
│   ├── TodoWriteTool/          # TodoWrite(内置skill)
│   ├── TaskStopTool/           # 任务停止
│   ├── ConfigTool/             # 配置编辑
│   ├── SkillTool/              # 技能执行
│   ├── BriefTool/              # 简报生成
│   └── ... (30+ 更多工具)
│
├── commands/                   # 命令实现 (~55个目录)
├── services/                   # 服务层
│   ├── api/                    # Claude API客户端 (核心!)
│   │   ├── claude.ts           # 主API客户端 (~3400行)
│   │   ├── client.ts           # HTTP客户端
│   │   ├── bootstrap.ts        # 启动引导
│   │   ├── filesApi.ts         # 文件API
│   │   └── ...
│   ├── mcp/                    # MCP协议客户端
│   │   ├── client.ts           # MCP客户端 (~3300行)
│   │   ├── config.ts           # 配置管理
│   │   ├── types.ts            # 类型定义
│   │   └── ...
│   ├── oauth/                  # OAuth认证
│   ├── lsp/                    # LSP语言服务
│   ├── analytics/              # 分析追踪
│   └── vcr/                    # 录制回放
│
├── bridge/                     # Bridge IPC层 (24个文件)
├── state/                      # React状态管理
├── components/                 # React UI组件 (~30个)
├── hooks/                      # React Hooks (~50个)
├── screens/                    # 屏幕组件 (REPL等)
├── ink/                        # Ink终端UI框架
├── constants/                  # 常量定义
├── types/                      # 类型定义
├── utils/                      # 工具函数 (200+文件)
└── keybindings/                # 按键绑定
```

### 2.2 Python 架构图

```
agent/
├── __main__.py                 # 包入口
├── main.py                     # argparse CLI入口 + 简单REPL循环
├── task.py                     # 任务类型定义 (对应Task.ts)
├── tool.py                     # 工具接口/基类 (对应Tool.ts)
├── tools.py                    # 工具注册表 (对应tools.ts)
├── commands.py                 # 命令注册表 (对应commands.ts)
├── query_engine.py             # 查询引擎 (对应QueryEngine.ts)
├── context.py                  # 上下文提供者 (对应context.ts)
├── setup.py                    # 会话初始化 (对应setup.ts)
├── history.py                  # 历史管理
├── cost_tracker.py             # 成本追踪
│
├── tools_impl/                 # 工具实现
│   ├── BashTool/               # bash_tool.py + prompt.py + sandbox.py
│   ├── AgentTool/              # agent_tool.py + prompt.py
│   ├── GlobTool/               # glob_tool.py + prompt.py
│   ├── GrepTool/               # grep_tool.py + prompt.py
│   ├── FileReadTool/           # (通过_wrap_module_tool包装)
│   ├── FileEditTool/           # (通过_wrap_module_tool包装)
│   ├── FileWriteTool/          # (通过_wrap_module_tool包装)
│   ├── WebFetchTool/           # (通过_wrap_module_tool包装)
│   ├── WebSearchTool/          # (通过_wrap_module_tool包装)
│   ├── TodoWriteTool/          # todo_write_tool.py
│   ├── LSPTool/                # lsp_tool.py + prompt.py + schemas.py
│   ├── MCPTool/                # mcp_tool.py + prompt.py
│   ├── SkillTool/              # prompt.py
│   ├── SleepTool/              # prompt.py
│   └── ... (少量其他)
│
├── commands_impl/              # 命令实现 (~65个文件)
├── services/                   # 服务层
│   ├── api/                    # API服务
│   │   ├── claude.py           # ✅ 完整实现 (verify_api_key, query_haiku 等)
│   │   ├── client.py           # ✅ 完整流式调用 (AsyncAnthropic)
│   │   ├── bootstrap.py        # 启动引导
│   │   └── ...
│   ├── mcp/                    # MCP服务
│   │   ├── client.py           # ⚠️ 仅42行存根!
│   │   ├── config.py           # 配置
│   │   └── types.py            # 类型
│   ├── oauth/                  # OAuth (基本实现)
│   ├── lsp/                    # LSP (部分实现)
│   └── ... (其他服务)
│
├── bridge/                     # Bridge层 (26个文件, 较完整)
├── state/                      # 状态管理 (简化版)
├── cli/                        # CLI处理 (transport等)
├── entrypoints/                # 入口点
│   ├── cli.py                  # CLI入口
│   ├── init.py                 # 初始化
│   ├── mcp_entrypoint.py       # MCP入口
│   └── sdk/                    # SDK入口 (Python独有)
├── constants/                  # 常量 (完整对应)
├── types/                      # 类型定义 (完整对应)
├── utils/                      # 工具函数 (250+文件, 含扩展)
├── keybindings/                # 按键绑定 (完整对应)
├── memdir/                     # 内存目录 (完整对应)
├── skills/                     # 技能系统 (部分实现)
├── query/                      # 查询配置 (完整对应)
├── plugins/                    # 插件系统 (部分实现)
├── buddy/                      # 伙伴系统 (完整对应)
├── bootstrap/                  # 启动状态 (完整对应)
├── schemas/                    # Schema定义 (部分)
│
├── migrations/                 # 🆕 数据库迁移 (Python独有)
├── remote/                     # 🆕 远程会话 (Python独有)
├── server/                     # 🆕 HTTP服务器 (Python独有)
└── utils/                      # 🆕 大量Python独有扩展模块
    ├── bash/                   # 完整bash解析器
    ├── computer_use/           # 计算机使用
    ├── model/                  # 完整模型管理系统
    ├── powershell/             # PowerShell解析
    ├── sandbox/                # 沙箱
    ├── git/                    # Git子模块
    └── ... (更多)
```

---

## 3. 模块级详细对比分析

### 3.1 核心类型系统

#### 3.1.1 Task.ts → task.py

| 功能 | TS (Task.ts) | Python (task.py) | 状态 |
|------|-------------|------------------|------|
| TaskType 联合类型 | 7种类型 | 7种类型 | ✅ 一致 |
| TaskStatus | 5种状态 | 5种状态 | ✅ 一致 |
| isTerminalTaskStatus() | 函数 | 函数 | ✅ 一致 |
| TaskHandle | 接口 | dataclass | ✅ 一致 |
| TaskContext | 类型别名 | dataclass | ✅ 一致 |
| TaskStateBase | 类型 | dataclass | ✅ 一致 |
| LocalShellSpawnInput | 类型 | dataclass | ✅ 一致 |
| Task 接口 | kill方法签名 | 异步kill方法 | ✅ 一致 |
| generateTaskId() | crypto.randomBytes | secrets.token_bytes | ✅ 等价 |
| createTaskStateBase() | Date.now() | time.time()*1000 | ✅ 等价 |

**差异说明**：
- TS 使用 `type` + `interface`，Python 使用 `Literal` + `dataclass`
- Python 额外实现了 `get_task_output_path()` （TS在独立模块中）

#### 3.1.2 Tool.ts → tool.py

| 功能 | TS (Tool.ts) | Python (tool.py) | 状态 |
|------|-------------|------------------|------|
| Tool 接口 | ~50个方法/属性 | Protocol ~12个方法 | ⚠️ 简化 |
| ToolUseContext | 复杂嵌套类型 | dataclass (简化) | ⚠️ 缺少字段 |
| ToolResult | 泛型类型 | dataclass | ✅ 基本一致 |
| buildTool() | 运行时默认填充 | ToolBase基类 | ✅ 等价模式 |
| getEmptyToolPermissionContext() | 函数 | 函数 | ✅ 一致 |
| filterToolProgressMessages() | 函数 | 函数 | ✅ 一致 |
| findToolByName() | 函数 | 函数 | ✅ 一致 |
| toolMatchesName() | 函数 | 函数 | ✅ 一致 |
| CanUseToolFn 类型 | 类型签名 | Callable类型 | ✅ 一致 |
| SetToolJSXFn | JSX渲染回调 | ❌ 缺失 | ❌ TS独有 |
| 渲染方法组 | ~8个React渲染方法 | ❌ 全部缺失 | ❌ UI相关 |
| Progress类型 | 完整进度类型体系 | 简化dict | ⚠️ 部分 |

**缺失的关键接口（Python Tool Protocol）**:
```python
# 以下方法在TS Tool接口中存在但Python Protocol中缺失:
- isSearchOrReadCommand()      # 搜索/读操作折叠判断
- isOpenWorld()                # 开放世界判断
- requiresUserInteraction()    # 用户交互需求
- interruptBehavior()          # 中断行为
- getPath()                    # 文件路径提取
- validateInput()              # 输入验证
- preparePermissionMatcher()   # 权限匹配器准备
- getActivityDescription()     # Spinner活动描述
- getToolUseSummary()          # 工具使用摘要
- toAutoClassifierInput()      # 自动分类器输入
- extractSearchText()          # 搜索文本提取
- isResultTruncated()          # 结果截断判断
- renderGroupedToolUse()       # 分组渲染
- inputSchema (属性)           # Zod schema → JSON schema
- shouldDefer / alwaysLoad     # 延迟加载标志
- maxResultSizeChars           # 最大结果大小
- backfillObservableInput()    # 可观察输入回填
```

### 3.2 工具层对比

#### 3.2.1 已实现的工具（Python端）

| 工具名 | TS文件 | Python文件 | 完成度 | 说明 |
|--------|--------|-----------|--------|------|
| BashTool | BashTool.tsx (~800行) | bash_tool.py (~140行) | **35%** | 缺少沙箱、权限、进度、heredoc等 |
| AgentTool | AgentTool.tsx (~1000行) | agent_tool.py (~155行) | **15%** | 缺少fork子代理、工作区隔离、任务管理 |
| GlobTool | GlobTool.ts (~200行) | glob_tool.py (~160行) | **80%** | ✅ 增强:输入验证,权限检查,时间排序 |
| GrepTool | GrepTool.ts (~576行) | grep_tool.py (~300行) | **80%** | ✅ 增强:多输出模式,上下文,VCS排除 |
| FileReadTool | FileReadTool.ts | file_read_tool.py | **40%** | 基本读取功能 |
| FileEditTool | FileEditTool.ts | file_edit_tool.py | **30%** | 基础编辑 |
| FileWriteTool | FileWriteTool.ts | file_write_tool.py | **35%** | 基础写入 |
| WebFetchTool | WebFetchTool.ts | web_fetch_tool.py | **40%** | URL获取 |
| WebSearchTool | WebSearchTool.ts | web_search_tool.py | **35%** | 网络搜索 |
| TodoWriteTool | TodoWriteTool.ts | todo_write_tool.py | **50%** | TodoWrite skill |
| LSPTool | LSPTool.ts (~530行) | lsp_tool.py (~290行) | **70%** | ✅ 增强:LSP操作映射,结果格式化 |
| MCPTool | MCPTool.ts (~330行) | mcp_tool.py (~125行) | **50%** | ✅ 增强:MCP客户端集成,服务器列表 |
| SkillTool | SkillTool.ts | prompt.py only | **10%** | 仅有prompt定义 |
| SleepTool | SleepTool.ts | prompt.py only | **10%** | 仅有prompt定义 |
| BriefTool | BriefTool.ts | prompt.py only | **10%** | 仅有prompt定义 |
| ConfigTool | ConfigTool.ts | prompt.py only | **10%** | 仅有prompt定义 |

#### 3.2.2 完全缺失的工具（TS有但Python无）

| 工具名 | TS文件路径 | 功能描述 | 优先级 |
|--------|-----------|---------|--------|
| **NotebookEditTool** | tools/NotebookEditTool/ | Jupyter Notebook编辑 | P2 |
| **TaskOutputTool** | tools/TaskOutputTool/ | 任务输出读取 | P1 |
| **TaskCreateTool** | tools/TaskCreateTool/ | 任务创建 (TodoV2) | P1 |
| **TaskGetTool** | tools/TaskGetTool/ | 任务获取 (TodoV2) | P1 |
| **TaskUpdateTool** | tools/TaskUpdateTool/ | 任务更新 (TodoV2) | P1 |
| **TaskListTool** | tools/TaskListTool/ | 任务列表 (TodoV2) | P1 |
| **EnterPlanModeTool** | tools/EnterPlanModeTool/ | 进入计划模式 | P1 |
| **ExitPlanModeV2Tool** | tools/ExitPlanModeTool/ | 退出计划模式 | P1 |
| **AskUserQuestionTool** | tools/AskUserQuestionTool/ | 向用户提问 | P1 |
| **TungstenTool** | tools/TungstenTool/ | 内部搜索工具 (ant-only) | P3 |
| **REPLTool** | tools/REPLTool/ | REPL虚拟机 (ant-only) | P3 |
| **ListMcpResourcesTool** | tools/ListMcpResourcesTool/ | 列出MCP资源 | P1 |
| **ReadMcpResourceTool** | tools/ReadMcpResourceTool/ | 读取MCP资源 | P1 |
| **ToolSearchTool** | tools/ToolSearchTool/ | 工具搜索 | P1 |
| **SendMessageTool** | tools/SendMessageTool/ | 发送消息 (swarms) | P2 |
| **TeamCreateTool** | tools/TeamCreateTool/ | 创建团队 (swarms) | P2 |
| **TeamDeleteTool** | tools/TeamDeleteTool/ | 删除团队 (swarms) | P2 |
| **SuggestBackgroundPRTool** | tools/SuggestBackgroundPRTool/ | PR建议 | P3 |
| **PowerShellTool** | tools/PowerShellTool/ | PowerShell执行 | P2 |
| **WorkflowTool** | tools/WorkflowTool/ | 工作流执行 | P2 |
| **ScheduleCronTool***3 | tools/ScheduleCronTool/ | 定时任务 (×3) | P2 |
| **RemoteTriggerTool** | tools/RemoteTriggerTool/ | 远程触发 | P2 |
| **MonitorTool** | tools/MonitorTool/ | 监控工具 | P2 |
| **SendUserFileTool** | tools/SendUserFileTool/ | 发送用户文件 | P3 |
| **PushNotificationTool** | tools/PushNotificationTool/ | 推送通知 | P3 |
| **SubscribePRTool** | tools/SubscribePRTool/ | 订阅PR | P3 |
| **WebBrowserTool** | tools/WebBrowserTool/ | 浏览器控制 | P2 |
| **SnipTool** | tools/SnipTool/ | 历史片段 | P2 |
| **ListPeersTool** | tools/ListPeersTool/ | 列出对端 | P2 |
| **EnterWorktreeTool** | tools/EnterWorktreeTool/ | 进入工作树 | P2 |
| **ExitWorktreeTool** | tools/ExitWorktreeTool/ | 退出工作树 | P2 |
| **OverflowTestTool** | tools/OverflowTestTool/ | 溢出测试 | P3 |
| **CtxInspectTool** | tools/CtxInspectTool/ | 上下文检查 | P2 |
| **TerminalCaptureTool** | tools/TerminalCaptureTool/ | 终端捕获 | P2 |
| **VerifyPlanExecutionTool** | tools/VerifyPlanExecutionTool/ | 计划验证 | P2 |
| **TestingPermissionTool** | tools/testing/ | 测试权限 | P3 |
| **SyntheticOutputTool** | tools/SyntheticOutputTool/ | 合成输出 | P2 |

**统计**: TS端 **45+ 工具** vs Python端 **~14 个工具（含存根）**

### 3.3 服务层对比

#### 3.3.1 API客户端（最关键缺失）

**TypeScript: `services/api/claude.ts` (~3400行)**
```
核心功能:
✅ Messages API 流式调用 (streaming)
✅ 重试逻辑 (withRetry)
✅ Prompt缓存管理
✅ Token计数和预算控制
✅ 系统Prompt构建
✅ 工具使用结果处理
✅ 多模型支持
✅ 思考模式 (extended thinking)
✅ 错误处理和分类
✅ 使用量追踪
✅ 请求/响应转换
```

**Python: `services/api/claude.py` (218行)**
```python
# 完整实现:
# - verify_api_key(): API Key 验证
# - query_haiku(): Haiku 轻量查询
# - query_model_with_streaming(): 流式查询入口
# - CannotRetryError: 重试专用异常
# - get_cache_control(), get_prompt_caching_enabled() 等工具函数
# 完整流式调用委托至 client.py (call_model_api)
```

**状态**: ✅ P0 重构完成。API 客户端可正常调用 Claude API。

#### 3.3.2 MCP客户端（第二关键缺失）

**TypeScript: `services/mcp/client.ts` (~3300行)**
```
核心功能:
✅ stdio传输 (子进程JSON-RPC)
✅ SSE传输 (Server-Sent Events)
✅ StreamableHTTP传输
✅ WebSocket传输
✅ 连接生命周期管理
✅ 认证 (OAuth, API key)
✅ 工具发现和调用
✅ 资源发现和读取
✅ 提示模板
✅ 采样支持
✅ 错误恢复和重连
✅ 能力协商
```

**Python: `services/mcp/client.py` (42行)**
```python
# 当前状态: 基本的类骨架，connect/call均为pass
```

#### 3.3.3 其他服务对比

| 服务 | TS状态 | Python状态 | 完成度 |
|------|--------|-----------|--------|
| **api/bootstrap.ts** | 启动引导配置 | bootstrap.py | ✅ 70% |
| **api/client.ts** | HTTP客户端 (fetch) | client.py | ⚠️ 50% |
| **api/errors.ts** | 错误分类 | errors.py | ✅ 80% |
| **api/filesApi.ts** | 文件上传API | files_api.py | ⚠️ 40% |
| **api/logging.ts** | 日志记录 | logging.py | ✅ 75% |
| **api/usage.ts** | 使用量统计 | usage.py / empty_usage.py | ✅ 70% |
| **api/referral.ts** | 推荐追踪 | referral.py | ✅ 60% |
| **api/withRetry.ts** | 重试封装 | retry.py | ✅ 70% |
| **mcp/config.ts** | MCP配置 | config.py | ⚠️ 50% |
| **mcp/types.ts** | 类型定义 | types.py | ✅ 70% |
| **mcp/auth.ts** | MCP认证 | auth.py | ⚠️ 50% |
| **mcp/utils.ts** | MCP工具函数 | utils.py | ⚠️ 40% |
| **oauth/** | OAuth流程 | oauth_client.py + crypto.py | ⚠️ 50% |
| **lsp/** | LSP客户端/管理 | lsp_client.py + manager.py | ⚠️ 40% |
| **analytics/** | 分析事件 | sink.py + datadog.py | ⚠️ 30% |
| **compact/** | 上下文压缩 | compact.py + grouping.py | ⚠️ 40% |
| **vcr/** | 录制回放 | recorder.py | ⚠️ 30% |
| **voice/** | 语音输入 | service.py | ⚠️ 30% |

### 3.4 命令层对比

#### 3.4.1 命令完成度矩阵

| 命令 | TS实现 | Python实现 | 完成度 | 备注 |
|------|--------|-----------|--------|------|
| `/clear` | clear.ts | clear.py | ✅ 90% | 清屏 |
| `/compact` | compact/index.ts | compact.py | ⚠️ 40% | 压缩逻辑简化 |
| `/config` | config/index.ts (UI) | config_cmd.py | ⚠️ 30% | TS有设置对话框 |
| `/cost` | cost/cost.ts | cost.py | ✅ 80% | 成本显示 |
| `/diff` | diff/diff.tsx (UI) | diff_cmd.py | ⚠️ 40% | TS有diff可视化 |
| `/doctor` | doctor/index.ts | doctor.py | ⚠️ 50% | 诊断检查 |
| `/exit` | exit/exit.tsx | exit_cmd.py | ✅ 90% | 退出 |
| `/help` | help/help.tsx | help_cmd.py | ✅ 80% | 帮助信息 |
| `/init` | init/index.ts | init_cmd.py | ✅ 80% | 项目初始化 |
| `/login` | login/login.tsx | login.py | ⚠️ 50% | 登录流程 |
| `/logout` | logout/index.ts | logout.py | ✅ 80% | 登出 |
| `/memory` | memory/index.ts | memory.py | ⚠️ 40% | CLAUDE.md管理 |
| `/model` | model/index.ts + model.tsx | model_cmd.py | ⚠️ 50% | 模型切换(TS有UI) |
| `/mcp` | mcp/index.ts + mcp.tsx | mcp.py + mcp_cmd.py | ⚠️ 35% | MCP管理复杂 |
| `/plan` | plan/index.ts + plan.tsx | plan_cmd.py | ⚠️ 20% | 计划模式 |
| `/resume` | resume/index.ts | resume.py | ⚠️ 40% | 会话恢复 |
| `/review` | review/review.ts | review.py | ⚠️ 30% | 代码审查 |
| `/session` | session/index.ts | session.py | ⚠️ 40% | 会话管理 |
| `/status` | status/status.tsx | status.py | ⚠️ 40% | 状态显示 |
| `/theme` | theme/index.ts + theme.tsx | theme.py | ⚠️ 30% | 主题切换 |
| `/vim` | vim/vim.ts | vim.py | ✅ 70% | Vim模式切换 |
| `/branch` | branch/branch.ts | branch.py | ✅ 80% | 分支管理 |
| `/commit` | commit.ts | commit.py | ✅ 85% | Git提交 |
| `/export` | export/index.ts | export_cmd.py | ⚠️ 40% | 导出功能 |
| `/fast` | fast/fast.tsx | fast_cmd.py | ⚠️ 30% | 快速模式 |
| `/feedback` | feedback/index.ts | feedback.py | ⚠️ 40% | 反馈 |
| `/files` | files/files.ts | files.py | ⚠️ 50% | 文件操作 |
| `/help` | help/help.tsx | help_cmd.py | ✅ 80% | 帮助 |
| `/hooks` | hooks/hooks.tsx | hooks_cmd.py | ⚠️ 35% | Hooks管理 |
| `/ide` | ide/ide.tsx | ide.py | ⚠️ 30% | IDE集成 |
| `/issue` | issue/index.js | issue.py | ⚠️ 30% | Issue管理 |
| `/passes` | passes/index.ts | passes.py | ⚠️ 30% | Passes |
| `/permissions` | (内建) | permissions.py | ⚠️ 40% | 权限管理 |
| `/rename` | rename/rename.ts | rename.py | ⚠️ 40% | 重命名 |
| `/rewind` | rewind/rewind.ts | rewind.py | ⚠️ 35% | 回退 |
| `/skills` | skills/index.ts | skills_cmd.py | ⚠️ 35% | 技能管理 |
| `/stats` | stats/stats.tsx | stats.py | ⚠️ 40% | 统计 |
| `/stickers` | stickers/index.ts | stickers.py | ⚠️ 20% | 贴纸 |
| `/summary` | summary/index.js | (缺失) | ❌ 0% | 摘要 |
| `/tag` | tag/tag.tsx | tags_cmd.py | ⚠️ 30% | 标签 |
| `/tasks` | tasks/tasks.tsx | tasks_cmd.py | ⚠️ 30% | 任务面板 |
| `/teleport` | teleport/index.js | (缺失) | ❌ 0% | 传送 |
| `/upgrade` | upgrade/index.ts | upgrade.py | ⚠️ 40% | 升级 |
| `/usage` | usage/usage.tsx | usage.py | ⚠️ 40% | 用量 |
| `/voice` | voice/voice.ts | voice_cmd.py | ⚠️ 30% | 语音 |
| `/btw` | btw/btw.tsx | btw.py | ⚠️ 30% | BTW |
| `/chrome` | chrome/index.ts | chrome.py | ⚠️ 30% | Chrome |
| `/color` | color/color.ts | color.py | ✅ 70% | 颜色 |
| `/desktop` | desktop/index.ts | desktop.py | ⚠️ 30% | 桌面 |
| `/effort` | effort/index.ts | effort.py | ⚠️ 30% | 努力 |
| `/env` | env/index.js | (缺失) | ❌ 0% | 环境 |
| `/heapdump` | heapdump/index.ts | heapdump.py | ⚠️ 20% | 堆转储 |
| `/listen` | (缺失) | listen.py | 🆕 50% | 监听(Python独有) |
| `/sandbox` | (缺失) | sandbox_cmd.py | 🆕 40% | 沙箱(Python独有) |
| `/search` | (缺失) | search.py | 🆕 50% | 搜索(Python独有) |
| `/stash` | (缺失) | stash.py | 🆕 40% | Stash(Python独有) |
| `/todo` | (缺失) | todo.py | 🆕 50% | Todo(Python独有) |
| `/thinkback` | (缺失) | thinkback.py | 🆕 30% | Thinkback(Python独有) |
| `/worktree` | (缺失) | worktree.py | 🆕 50% | Worktree(Python独有) |

### 3.5 Bridge层对比

| TS文件 | Python文件 | 状态 | 完成度 |
|--------|-----------|------|--------|
| bridgeApi.ts | bridge_api.py | ✅ 已实现 | 75% |
| bridgeConfig.ts | bridge_config.py | ✅ 已实现 | 70% |
| bridgeDebug.ts | bridge_debug.py | ✅ 已实现 | 70% |
| bridgeEnabled.ts | bridge_enabled.py | ✅ 已实现 | 80% |
| bridgeMain.ts | bridge_main.py | ✅ 已实现 | 70% |
| bridgeMessaging.ts | bridge_messaging.py | ✅ 已实现 | 70% |
| bridgePointer.ts | bridge_pointer.py | ✅ 已实现 | 70% |
| bridgeUI.ts | (拆分为status_util.py) | ✅ 适配 | 65% |
| capacityWake.ts | capacity_wake.py | ✅ 已实现 | 70% |
| codeSessionApi.ts | code_session_api.py | ✅ 已实现 | 70% |
| createSession.ts | create_session.py | ✅ 已实现 | 75% |
| debugUtils.ts | debug_utils.py | ✅ 已实现 | 75% |
| flushGate.ts | flush_gate.py | ✅ 已实现 | 80% |
| inboundMessages.ts | inbound_messages.py | ✅ 已实现 | 65% |
| initReplBridge.ts | init_repl_bridge.py | ✅ 已实现 | 70% |
| jwtUtils.ts | jwt_utils.py | ✅ 已实现 | 85% |
| pollConfig.ts | poll_config.py | ✅ 已实现 | 75% |
| replBridge.ts | repl_bridge.py | ✅ 已实现 | 65% |
| sessionIdCompat.ts | session_id_compat.py | ✅ 已实现 | 80% |
| sessionRunner.ts | session_runner.py | ✅ 已实现 | 70% |
| trustedDevice.ts | trusted_device.py | ✅ 已实现 | 75% |
| types.ts | types.py | ✅ 已实现 | 80% |
| workSecret.ts | work_secret.py | ✅ 已实现 | 80% |

**Python额外文件**: 
- `remote_bridge_core.py` - 远程bridge核心
- `repl_bridge_handle.py` - REPL bridge处理器
- `repl_bridge_transport.py` - REPL bridge传输层
- `inbound_attachments.py` - 入站附件处理

### 3.6 其他模块对比

| 模块 | TS | Python | 状态 |
|------|-----|--------|------|
| **constants/** | 19个文件 | 19个文件 | ✅ 基本完整 |
| **types/** | 10个文件 | 13个文件 | ✅ 完整+扩展 |
| **keybindings/** | 7个文件 | 13个文件 | ✅ 更丰富 |
| **memdir/** | 6个文件 | 6个文件 | ✅ 基本完整 |
| **query/** | 4个文件 | 4个文件 | ✅ 基本完整 |
| **bootstrap/** | 1个文件 | 2个文件 | ✅ 完整 |
| **buddy/** | 5个文件 | 6个文件 | ✅ 完全(去UI) |
| **schemas/** | 1个文件 | 3个文件 | ✅ 扩展 |
| **skills/** | 6个文件 | 11个文件 | ⚠️ Python更丰富 |
| **plugins/** | 2个文件 | 2个文件 | ⚠️ 基本骨架 |

### 3.7 深度代码对比发现（2026-04-03更新）

#### 3.7.1 API客户端深度对比

**TypeScript `claude.ts` 核心结构（3400行）**:
| 功能块 | 行数 | 功能描述 |
|--------|------|----------|
| `getExtraBodyParams()` | ~50 | 解析CLAUDE_CODE_EXTRA_BODY环境变量 |
| `getPromptCachingEnabled()` | ~30 | Prompt缓存控制 |
| `getCacheControl()` | ~40 | 缓存作用域管理 |
| `configureEffortParams()` | ~40 | effort参数配置 |
| `configureTaskBudgetParams()` | ~30 | token预算控制 |
| `getAPIMetadata()` | ~30 | API元数据构建 |
| `verifyApiKey()` | ~50 | API密钥验证 |
| `userMessageToMessageParam()` | ~40 | 用户消息转换 |
| `assistantMessageToMessageParam()` | ~50 | 助手消息转换 |
| `queryModelWithoutStreaming()` | ~50 | 非流式查询 |
| `queryModelWithStreaming()` | ~80 | 流式查询生成器 |
| `executeNonStreamingRequest()` | ~150 | 非流式请求执行 |
| `queryModel()` | ~900 | **核心查询循环** |
| `cleanupStream()` | ~30 | 流清理 |
| `updateUsage()` | ~70 | 使用量更新 |
| `accumulateUsage()` | ~70 | 使用量累计 |
| `addCacheBreakpoints()` | ~150 | 缓存断点添加 |
| `buildSystemPromptBlocks()` | ~80 | 系统提示构建 |

**Python `claude.py` 当前状态（218行）**:
```python
# 完整实现:
- verify_api_key()           # API Key 验证
- query_haiku()               # Haiku 轻量查询
- query_model_with_streaming() # 流式查询入口
- query_model_without_streaming() # 非流式查询
- CannotRetryError           # 重试专用异常
- get_cache_control()         # 缓存控制
- get_prompt_caching_enabled() # 缓存启用检查
- get_extra_body_params()     # 额外参数
- is_authentication_error()   # 认证错误判断
- extract_quota_status_from_error() # 配额状态
```

**状态**: ✅ P0 重构完成。API 客户端可正常调用 Claude API。

#### 3.7.2 MCP客户端深度对比

**TypeScript `client.ts` 核心结构（3300行）**:
| 功能块 | 功能描述 |
|--------|----------|
| `McpAuthError` | 认证错误类 |
| `McpSessionExpiredError` | 会话过期错误 |
| `isMcpSessionExpiredError()` | 会话过期检测 |
| `_connect_stdio()` | stdio传输连接 |
| `_connect_sse()` | SSE传输连接 |
| `_connect_streamable_http()` | HTTP流连接 |
| `_connect_websocket()` | WebSocket连接 |
| `_read_loop()` | 消息读取循环 |
| `_handle_message()` | 消息处理分发 |
| `_send_request()` | 请求发送 |
| `_send_notification()` | 通知发送 |
| `list_tools()` | 工具列表 |
| `call_tool()` | 工具调用 |
| `list_resources()` | 资源列表 |
| `read_resource()` | 资源读取 |
| `list_prompts()` | 提示列表 |
| `get_prompt()` | 获取提示 |
| OAuth认证流程 | 完整OAuth支持 |
| 重连/错误恢复 | 完整 |

**Python `client.py` 当前状态（~300行）**:
```python
# 已实现:
- MCPServerConfig 数据类
- MCPToolDefinition 数据类
- MCPResource 数据类
- CallToolResult 数据类
- MCPServerConnection 类:
  - connect() # 基本框架
  - _connect_stdio() # 完整实现
  - _connect_sse() # 仅抛NotImplementedError
  - _read_loop() # 完整
  - _handle_message() # 完整
  - _send_request() # 完整
  - _send_notification() # 完整
  - list_tools() # 完整
  - call_tool() # 完整
  - list_resources() # 完整
  - read_resource() # 完整
  - disconnect() # 完整
```

**差距**: Python MCP客户端实现约40%完成度，缺少SSE/HTTP/WebSocket传输、OAuth认证、错误恢复机制。

#### 3.7.3 工具系统深度对比

**TypeScript工具注册表结构**:
```typescript
// tools.ts 导出工具列表:
getAllBaseTools() → Tool[]
- AgentTool (AgentTool.tsx, ~1000行)
- TaskOutputTool (TaskOutputTool.tsx)
- BashTool (BashTool.tsx, ~800行)
- GlobTool (GlobTool.ts, ~200行)
- GrepTool (GrepTool.ts, ~576行)
- FileReadTool, FileEditTool, FileWriteTool
- WebFetchTool, WebSearchTool
- TodoWriteTool
- ExitPlanModeV2Tool
- TestingPermissionTool
- LSPTool (LSPTool.ts, ~530行)
- ListMcpResourcesTool, ReadMcpResourceTool
- ToolSearchTool
- EnterPlanModeTool, EnterWorktreeTool, ExitWorktreeTool
- ConfigTool
- TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool
- AskUserQuestionTool
- NotebookEditTool
- BriefTool, SleepTool
- 条件编译工具: REPLTool, MonitorTool, WorkflowTool等
```

**Python工具注册表结构**:
```python
# tools.py 实现:
get_all_base_tools() → list[Tool]
- AgentTool (agent_tool.py, ~155行) ⚠️ 15%
- BashTool (bash_tool.py, ~140行) ⚠️ 35%
- GlobTool (glob_tool.py, ~31行) ⚠️ 30%
- GrepTool (grep_tool.py, ~62行) ⚠️ 25%
- FileReadTool, FileEditTool, FileWriteTool # 通过_wrap_module_tool包装
- WebFetchTool, WebSearchTool # 通过_wrap_module_tool包装
- TodoWriteTool # 完整实现 ⚠️ 50%
- LSPTool (lsp_tool.py, ~115行) ⚠️ 20%
- MCPTool (mcp_tool.py, ~65行) ⚠️ 20%
- AskUserQuestionTool # _wrap_module_tool
- EnterPlanModeTool, ExitPlanModeTool # _wrap_module_tool
- NotebookEditTool # _wrap_module_tool
- ListMcpResourcesTool, ReadMcpResourceTool # _wrap_module_tool
- TaskOutputTool, TaskStopTool # _wrap_module_tool
- BriefTool, SleepTool # _wrap_module_tool
- ConfigTool # _wrap_module_tool
```

**工具实现差异**:
| 工具 | TS行数 | Python行数 | 完成度 |
|------|--------|-----------|--------|
| AgentTool | ~1000 | ~155 | 15% |
| BashTool | ~800 | ~140 | 35% |
| GrepTool | ~576 | ~300 | **80%** ✅ |
| GlobTool | ~200 | ~160 | **80%** ✅ |
| LSPTool | ~530 | ~290 | **70%** ✅ |
| MCPTool | ~330 | ~125 | **50%** ✅ |

#### 3.7.4 命令系统深度对比

**TypeScript命令注册表**:
```typescript
// commands.ts COMMANDS数组 (~200行声明 + ~100个命令目录)
// 包含60+个命令实现
- 本地命令: /clear, /config, /cost, /exit, /help, /model, /status, /theme, /vim...
- 提示命令: /review, /init, /insights...
- 插件命令: 动态加载
- 条件编译: /agent, /brief, /chrome, /voice...
```

**Python命令注册表**:
```python
# commands.py 实现 (~160行)
// 基础命令: ~15个
- LocalCommand: clear, compact, config, cost, diff, doctor, exit, help, memory, model, resume, status, theme, vim
- PromptCommand: review, init
# 缺失大量命令实现
```

**命令实现文件对比**:
- TypeScript: ~100个命令目录
- Python: ~70个命令实现文件 (`commands_impl/`)
- Python额外命令: listen, sandbox, search, stash, todo, thinkback, worktree (Python独有)

#### 3.7.5 查询引擎深度对比

**TypeScript `QueryEngine.ts` 核心方法**:
```typescript
class QueryEngine {
  async ask()           // 主入口
  async submit_message() // 消息提交
  async _runQuery()     // 查询执行
  _buildSystemPrompt()  // 系统提示构建
  _buildTools()         // 工具列表构建
  _handleToolResult()   // 工具结果处理
  _accumulateUsage()    // 使用量累计
}
```

**Python `query_engine.py` 核心方法**:
```python
class QueryEngine:
  def __init__()        # 初始化
  async submit_message() # 消息提交 (AsyncGenerator)
  # 缺少:
  # - ask()方法
  # - _runQuery()核心实现
  # - _buildSystemPrompt()完整实现
  # - _buildTools()完整实现
```

**差距**: Python查询引擎约60%完成度，核心查询循环未完整实现。

#### 3.7.6 主入口深度对比

**TypeScript `main.tsx`**:
```typescript
// ~500行Commander配置 + React/Ink渲染
- CLI选项: --print, --model, --verbose, --PermissionMode...
- 子命令: install, doctor, init, mcp, plugin, upgrade...
- REPL渲染: launchRepl() → React/Ink组件
- 环境初始化: 增长Book, 分析, 遥测...
```

**Python `main.py`**:
```python
# ~200行argparse配置 + 简单REPL
- CLI选项: --print, --model, --verbose, --permission-mode...
- 无子命令 (Python独有功能如sandbox/listen等通过单独脚本暴露)
- REPL实现: 简单while循环 + input()
```

**差距**: Python主入口约40%完成度，缺少子命令系统和完整REPL功能。

---

## 4. 未完成重构模块清单

### 4.1 P0 - 阻塞性缺失（系统无法运行）

| 模块 | 路径 | 问题 | 影响 | 状态 |
|------|------|------|------|------|
| **Claude API客户端** | `services/api/claude.py` | 27行存根，无法调用API | 🔴 系统完全无法工作 | ✅ 已完成 P0 |
| **查询核心(query.ts)** | `query.py` | 确认完整 | ✅ | ✅ 已验证 |
| **消息规范化** | `utils/messages/` | 可能缺少关键转换 | 🔴 API消息格式可能不对 |

### 4.2 P1 - 关键功能缺失（核心体验受损）

| 模块 | 路径 | 问题 | 影响 |
|------|------|------|------|
| **MCP客户端** | `services/mcp/client.py` | 42行存根 | 🟠 无法连接MCP服务器 |
| **BashTool完善** | `tools_impl/BashTool/` | 缺沙箱/权限/heredoc | 🟠 shell执行不安全 |
| **AgentTool完善** | `tools_impl/AgentTool/` | 缺子代理/fork | 🟠 无法启动子代理 |
| **GrepTool完善** | `tools_impl/GrepTool/` | ✅ 已完成 80% | � 搜索能力增强 |
| **GlobTool完善** | `tools_impl/GlobTool/` | ✅ 已完成 80% | � 文件搜索增强 |
| **LSPTool完善** | `tools_impl/LSPTool/` | ✅ 已完成 70% | � 代码智能增强 |
| **MCPTool完善** | `tools_impl/MCPTool/` | ✅ 已完成 50% | � MCP工具可用 |
| **31个缺失工具** | `tools_impl/` | 完全未实现 | 🟠 功能集严重不足 |
| **计划模式工具** | EnterPlanMode/ExitPlanMode | 缺失 | 🟠 无计划模式 |
| **TodoV2工具** | TaskCreate/Get/Update/List | 缺失 | 🟠 无任务管理 |
| **AskUserQuestion** | AskUserQuestionTool | 缺失 | 🟠 无法交互提问 |

### 4.3 P2 - 重要功能缺失（体验下降）

| 模块 | 路径 | 问题 |
|------|------|------|
| OAuth完整流程 | `services/oauth/` | 认证流程不完整 |
| LSP服务 | `services/lsp/` | 语言服务不完整 |
| 压缩服务 | `services/compact/` | 上下文压缩不完整 |
| Voice服务 | `services/voice/` | 语音输入不可用 |
| VCR录制 | `services/vcr/` | 录制回放不可用 |
| 命令UI增强 | 多个命令 | TS有交互式UI，Python只有文本 |
| 会话持久化 | `session_storage.py` | 可能不完整 |
| 会话恢复 | `commands_impl/resume.py` | 功能简化 |

### 4.4 TS独有且不需要移植的模块（UI相关）

以下模块是React/Ink终端UI框架的一部分，Python使用简单的print输出，不需要移植：

- `src/components/` - 全部React组件 (~30个文件)
- `src/hooks/` - 全部React Hooks (~50个文件)
- `src/screens/` - REPL等屏幕组件
- `src/ink/` - Ink终端UI框架 (整个目录)
- `src/context/` - React Context
- 工具中的 `UI.tsx` 文件 - 所有工具的React UI渲染
- 命令中的 `.tsx` UI文件 - 命令的交互界面

---

## 5. 重构方案（按优先级）

### Phase 1: 核心运行链路打通 (P0)

**目标**: 让Python版本能够完成一次完整的"用户输入→API调用→返回结果"流程。

#### 5.1.1 实现 Claude API 客户端 (`services/api/claude.py`)

**参考源码**: `claude-code/src/services/api/claude.ts` (3400行)

**需要实现的核心功能**:

```python
# 必须实现的最小功能集:
class ClaudeClient:
    async def stream_messages(
        self,
        messages: list[dict],
        system: list[dict] | None = None,
        tools: list[dict] | None = None,
        model: str = "claude-sonnet-4-20250514",
        max_tokens: int = 8192,
        thinking: dict | None = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """流式调用 Claude Messages API"""
        pass
    
    async def create_message(self, **kwargs) -> MessageResponse:
        """非流式调用"""
        pass
    
    def _build_headers(self) -> dict:
        """构建认证头"""
        pass
    
    def _handle_retry(self, error: Exception) -> bool:
        """重试逻辑"""
        pass
    
    def _count_tokens(self, messages: list) -> int:
        """Token计数"""
        pass
```

**关键技术映射**:
- TS `fetch()` → Python `httpx.AsyncClient` 或 `aiohttp`
- TS `ReadableStream` → Python `async for chunk in response.aiter_text()`
- TS `AbortController` → Python `asyncio.Event` + `anyio.CancelScope`
- TS Zod validation → Python `pydantic` or manual dict validation

#### 5.1.2 实现查询循环核心 (`query.py` 完善)

**参考源码**: `claude-code/src/query.ts`

**必须实现的逻辑**:
1. 消息预处理 (normalizeMessagesForAPI)
2. 工具调用循环 (tool_use → call tool → append result → re-query)
3. 最大轮次控制
4. 停止原因处理 (end_turn, tool_use, max_tokens)
5. 流式响应聚合
6. 错误恢复

#### 5.1.3 完善消息类型系统 (`types/message.py`)

确保消息类型与Anthropic API完全兼容:
- UserMessage → `{role: "user", content: [...]}`
- AssistantMessage → `{role: "assistant", content: [...]}`
- ToolResultBlockParam → `{type: "tool_result", ...}`
- ToolUseBlockParam → `{type: "tool_use", ...}`

### Phase 2: 工具集补全 (P1)

#### 5.2.1 高优先级工具完善

**BashTool 完善清单**:
- [ ] 沙箱执行模式 (docker/namespace隔离)
- [ ] 命令超时和取消
- [ ] heredoc 支持
- [ ] 管道命令处理
- [ ] 环境变量注入
- [ ] 输出截断 (maxResultSizeChars)
- [ ] 进度回调
- [ ] 权限检查集成
- [ ] 命令分类 (search/read/list/write)
- [ ] 并发安全标记

**AgentTool 完善清单**:
- [ ] 子代理 fork 机制
- [ ] 工作区隔离
- [ ] 任务状态管理
- [ ] 代理间消息传递
- [ ] 超时和取消
- [ ] 输出捕获

**GrepTool 完善清单**:
- [ ] ripgrep 集成 (或兼容实现)
- [ ] 多种输出模式 (content/files_with_matches/count)
- [ ] 正则表达式支持
- [ ] 结果排序
- [ ] 结果数量限制
- [ ] 上下文行数 (before/after context)
- [ ] 二进制文件跳过
- [ ] .gitignore 尊重
- [ ] 搜索/读操作分类

**GlobTool 完善清单**:
- [ ] .gitignore 尊重
- [ ] 结果数量限制
- [ ] 隐藏文件包含选项
- [ ] 类型过滤器 (file/dir/both)
- [ ] 搜索/读操作分类

#### 5.2.2 缺失工具实现（按优先级排序）

**第一批 (P1-A - 核心交互)**:
1. `AskUserQuestionTool` - 用户交互必需
2. `ListMcpResourcesTool` - MCP生态
3. `ReadMcpResourceTool` - MCP生态
4. `ToolSearchTool` - 工具延迟加载
5. `EnterPlanModeTool` - 计划模式
6. `ExitPlanModeV2Tool` - 计划模式

**第二批 (P1-B - 任务管理)**:
7. `TaskOutputTool` - 任务输出
8. `TaskCreateTool` - 任务创建
9. `TaskGetTool` - 任务获取
10. `TaskUpdateTool` - 任务更新
11. `TaskListTool` - 任务列表

**第三批 (P1-C - 扩展功能)**:
12. `NotebookEditTool` - Notebook编辑
13. `SendMessageTool` - 团队消息
14. `PowerShellTool` - PowerShell
15. `WorkflowTool` - 工作流
16. `WebBrowserTool` - 浏览器

### Phase 3: MCP客户端实现 (P1)

#### 5.3.1 MCP Client 核心

**参考源码**: `claude-code/src/services/mcp/client.ts` (3300行)

**最小可行实现**:
```python
class MCPServerConnection:
    async def connect(self, config: MCPConfig) -> None:
        """建立连接 (stdio/远程)"""
        pass
    
    async def list_tools(self) -> list[MCPTool]:
        """列出可用工具"""
        pass
    
    async def call_tool(self, name: str, args: dict) -> CallToolResult:
        """调用工具"""
        pass
    
    async def list_resources(self) -> list[MCPResource]:
        """列出资源"""
        pass
    
    async def read_resource(self, uri: str) -> str:
        """读取资源"""
        pass
    
    async def disconnect(self) -> None:
        """断开连接"""
        pass
```

**传输层实现优先级**:
1. **stdio** (最高优先) - 子进程JSON-RPC over stdin/stdout
2. **StreamableHTTP** - HTTP + SSE
3. **WebSocket** - WebSocket传输

### Phase 4: 命令系统完善 (P2)

#### 5.4.1 需要完善的命令

| 命令 | 当前问题 | 改进方向 |
|------|---------|---------|
| `/compact` | 存根 | 实现真正的上下文压缩 |
| `/config` | 存根 | 打开/编辑配置文件 |
| `/plan` | 仅4行 | 完整的计划模式切换逻辑 |
| `/review` | 存根 | 调用审查技能 |
| `/memory` | 不完整 | CLAUDE.md读写 |
| `/mcp` | 不完整 | MCP服务器管理 |
| `/model` | 基础 | 模型列表+切换+验证 |
| `/doctor` | 部分 | 完整诊断项 |
| `/resume` | 部分 | 会话列表+选择+恢复 |

### Phase 5: 服务层完善 (P2)

| 服务 | 优先改进项 |
|------|-----------|
| OAuth | 完整设备码流程 |
| LSP | 完整的客户端初始化和方法调用 |
| Compact | 智能上下文压缩算法 |
| Voice | STT流式识别 |
| Analytics | 事件上报 (可选) |

---

## 6. 详细重构步骤

### Step 1: Claude API 客户端实现

**预估工作量**: 3-5天  
**依赖**: httpx 或 aiohttp 库  

**文件**: `agent/services/api/claude.py`

#### Step 1.1 创建 API 客户端骨架

```python
"""
Claude API client – port of src/services/api/claude.ts

Provides streaming and non-streaming message creation against the
Anthropic Messages API with retry, caching, token counting, and
thinking-mode support.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncGenerator, Optional
import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants (matching TS source)
# ---------------------------------------------------------------------------

ANTHROPIC_API_URL = "https://api.anthropic.com"
DEFAULT_MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS_DEFAULT = 8192
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0

# ---------------------------------------------------------------------------
# Error types (matching errors.ts)
# ---------------------------------------------------------------------------

class ClaudeAPIError(Exception):
    def __init__(self, message: str, status_code: int = 0, error_type: str = ""):
        self.message = message
        self.status_code = status_code
        self.error_type = error_type
        super().__init__(message)

class RateLimitError(ClaudeAPIError): pass
class AuthenticationError(ClaudeAPIError): pass
class PermissionDeniedError(ClaudeAPIError): pass
class ContextLengthError(ClaudeAPIError): pass
class OverloadedError(ClaudeAPIError): pass
class APIConnectionError(ClaudeAPIError): pass


# ---------------------------------------------------------------------------
# StreamEvent types
# ---------------------------------------------------------------------------

@dataclass
class StreamEvent:
    type: str  # "message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"
    data: dict[str, Any]


# ---------------------------------------------------------------------------
# ClaudeClient
# ---------------------------------------------------------------------------

class ClaudeClient:
    """
    Main API client for communicating with Claude.
    
    Port of the Claude class from src/services/api/claude.ts
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = ANTHROPIC_API_URL,
        default_model: str = DEFAULT_MODEL,
        timeout: float = 600.0,
        max_retries: int = MAX_RETRIES,
    ):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._default_model = default_model
        self._timeout = timeout
        self._max_retries = max_retries
        self._client: Optional[httpx.AsyncClient] = None

    # -- Authentication --------------------------------------------------------

    def _get_api_key(self) -> str:
        if self._api_key:
            return self._api_key
        import os
        key = os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise AuthenticationError(
                "No API key provided. Set ANTHROPIC_API_KEY environment variable.",
                error_type="authentication_error",
            )
        return key

    def _build_headers(self, extra_headers: Optional[dict] = None) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self._get_api_key(),
            "anthropic-version": "2023-06-01",
        }
        if extra_headers:
            headers.update(extra_headers)
        return headers

    # -- HTTP Client lifecycle -----------------------------------------------

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    # -- Retry logic (matching withRetry.ts) ----------------------------------

    async def _retry_async(
        self,
        fn: callable,
        *,
        is_retryable: Optional[callable] = None,
        max_attempts: Optional[int] = None,
    ):
        """Execute fn with exponential back-off retry."""
        attempts = max_attempts or self._max_retries
        last_error: Optional[Exception] = None
        
        for attempt in range(attempts):
            try:
                return await fn()
            except Exception as e:
                last_error = e
                if is_retryable and not is_retryable(e):
                    raise
                
                if attempt < attempts - 1:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(f"Request failed (attempt {attempt+1}/{attempts}), retrying in {delay}s: {e}")
                    await asyncio.sleep(delay)
        
        raise last_error

    @staticmethod
    def _is_retryable_error(error: Exception) -> bool:
        if isinstance(error, httpx.HTTPStatusError):
            return error.response.status_code in (429, 500, 502, 503, 504)
        if isinstance(error, (httpx.ConnectError, httpx.ReadTimeout)):
            return True
        return False

    # -- Core API methods -----------------------------------------------------

    async def stream_messages(
        self,
        messages: list[dict[str, Any]],
        system: Optional[list[dict]] = None,
        tools: Optional[list[dict]] = None,
        model: Optional[str] = None,
        max_tokens: int = MAX_TOKENS_DEFAULT,
        thinking: Optional[dict] = None,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None,
        stop_sequences: Optional[list[str]] = None,
        metadata: Optional[dict] = None,
        abort_signal: Optional[asyncio.Event] = None,
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Stream a conversation to the Claude Messages API.
        
        Yields StreamEvent objects matching the SSE events from the API.
        
        Corresponds to claude() streaming mode in the TS source.
        """
        url = f"{self._base_url}/v1/messages"
        payload: dict[str, Any] = {
            "model": model or self._default_model,
            "max_tokens": max_tokens,
            "messages": messages,
            "stream": True,
        }
        
        if system:
            payload["system"] = system
        if tools:
            payload["tools"] = tools
        if temperature is not None:
            payload["temperature"] = temperature
        if top_p is not None:
            payload["top_p"] = top_p
        if stop_sequences:
            payload["stop_sequences"] = stop_sequences
        if metadata:
            payload["metadata"] = metadata
        if thinking:
            payload["thinking"] = thinking

        async def _do_request():
            client = self._get_client()
            
            async with client.stream(
                "POST",
                url,
                json=payload,
                headers=self._build_headers(),
            ) as response:
                if response.status_code == 401:
                    raise AuthenticationError(
                        "Invalid API key",
                        status_code=401,
                        error_type="authentication_error",
                    )
                if response.status_code == 429:
                    raise RateLimitError(
                        "Rate limit exceeded",
                        status_code=429,
                        error_type="rate_limit_error",
                    )
                response.raise_for_status()
                
                buffer = ""
                async for raw_line in response.aiter_lines():
                    if abort_signal and abort_signal.is_set():
                        break
                    
                    line = raw_line.strip()
                    if not line.startswith("data: "):
                        continue
                    
                    data_str = line[6:]  # Strip "data: " prefix
                    if data_str == "[DONE]":
                        break
                    
                    try:
                        event_data = json.loads(data_str)
                        event_type = event_data.get("type", "")
                        
                        yield StreamEvent(type=event_type, data=event_data)
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse SSE data: {data_str}")

        await self._retry_async(_do_request, is_retryable=self._is_retryable_error)

    async def create_message(
        self,
        messages: list[dict[str, Any]],
        system: Optional[list[dict]] = None,
        tools: Optional[list[dict]] = None,
        model: Optional[str] = None,
        max_tokens: int = MAX_TOKENS_DEFAULT,
        **kwargs,
    ) -> dict[str, Any]:
        """
        Non-streaming message creation.
        """
        url = f"{self._base_url}/v1/messages"
        payload: dict[str, Any] = {
            "model": model or self._default_model,
            "max_tokens": max_tokens,
            "messages": messages,
        }
        if system:
            payload["system"] = system
        if tools:
            payload["tools"] = tools
        payload.update(kwargs)

        async def _do_request():
            client = self._get_client()
            response = await client.post(
                url, json=payload, headers=self._build_headers(),
            )
            
            if response.status_code == 401:
                raise AuthenticationError("Invalid API key", status_code=401)
            if response.status_code == 429:
                raise RateLimitError("Rate limit exceeded", status_code=429)
            response.raise_for_status()
            return response.json()

        return await self._retry_async(_do_request, is_retryable=self._is_retryable_error)

    # -- Token counting (approximate) -----------------------------------------

    @staticmethod
    def count_tokens_approx(text: str) -> int:
        """Rough token count approximation (~4 chars per token)."""
        return len(text) // 4

    def count_messages_tokens(self, messages: list[dict]) -> int:
        """Approximate total tokens in a message list."""
        total = 0
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                total += self.count_tokens_approx(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        text = block.get("text", "")
                        total += self.count_tokens_approx(text)
        return total
```

### Step 2: 查询循环核心实现

**文件**: `agent/query.py` (完善现有实现)

**核心逻辑伪代码**:
```python
async def query(params: QueryParams) -> AsyncGenerator[InternalMessage, None]:
    """
    Core query loop. Ports the ask() logic from src/query.ts.
    
    The loop:
    1. Send messages to API
    2. If response contains tool_use → execute tools → append results → goto 1
    3. If response is end_turn → yield and return
    4. If max_turns reached → yield attachment and return
    """
    turn_count = 0
    max_turns = params.max_turns or 25  # Default from TS
    
    while turn_count < max_turns:
        turn_count += 1
        
        # Build API request
        api_params = _build_api_request(params)
        
        # Call API (streaming)
        async for event in params.api_client.stream_messages(**api_params):
            if event.type == "message_start":
                yield AssistantMessage(type="assistant", message=event.data["message"])
            
            elif event.type == "content_block_start":
                block = event.data.get("content_block", {})
                if block.get("type") == "text":
                    # Text delta will follow
                    pass
                elif block.get("type") == "tool_use":
                    # Tool use block starting
                    pass
            
            elif event.type == "content_block_delta":
                delta = event.data.get("delta", {})
                # Accumulate text deltas or tool input deltas
            
            elif event.type == "content_block_stop":
                # Block complete
            
            elif event.type == "message_delta":
                delta = event.data.get("delta", {})
                stop_reason = delta.get("stop_reason")
                usage = event.data.get("usage", {})
                
                if stop_reason == "end_turn":
                    # Done - yield final message
                    return
                elif stop_reason == "tool_use":
                    # Need to execute tools
                    break
        
        # Execute tool uses found in the assistant's response
        tool_results = await _execute_tool_uses(
            assistant_message, params.tool_use_context, params.can_use_tool
        )
        
        # Append tool results as a user message
        user_msg_with_results = _build_tool_result_message(tool_results)
        params.messages.append(user_msg_with_results)
    
    # Max turns reached
    yield AttachmentMessage(type="attachment", attachment={
        "type": "max_turns_reached",
        "turnCount": turn_count,
    })
```

### Step 3: BashTool 增强

**文件**: `agent/tools_impl/BashTool/bash_tool.py`

**关键增强点**:

```python
class BashTool(ToolBase):
    name = "Bash"
    aliases = ["bash", "sh"]
    search_hint = "Execute shell commands and scripts"
    max_result_size_chars = 500_000  # 500KB limit like TS

    def __init__(self):
        self._running_processes: dict[str, subprocess.Process] = {}
        self._output_buffers: dict[str, list[str]] = {}

    async def call(self, args: dict, context: ToolUseContext, ...) -> ToolResult:
        command = args.get("command", "")
        description = args.get("description", "")
        
        # 1. 分类命令 (is_search_or_read_command)
        classification = self._classify_command(command)
        
        # 2. 权限检查 (check_permissions)
        permission = await self.check_permissions(args, context)
        
        # 3. 创建任务记录
        task_id = generate_task_id("local_bash")
        
        # 4. 执行命令 (with timeout, cancellation support)
        try:
            result = await self._execute_command(
                command,
                timeout=args.get("timeout"),
                abort_controller=context.abort_controller,
            )
        except asyncio.TimeoutError:
            return ToolResult(data=f"Timeout: command exceeded time limit")
        except Exception as e:
            return ToolResult(data=f"Error: {e}")
        
        # 5. 截断过大的输出
        output = result["stdout"] + result["stderr"]
        if len(output) > self.max_result_size_chars:
            output = output[:self.max_result_size_chars] + "\n... (truncated)"
        
        return ToolResult(data=output)

    def _classify_command(self, cmd: str) -> dict:
        """Classify command as search/read/list/write/other."""
        # Implement same heuristics as TS BashTool.tsx
        read_commands = {"cat", "head", "tail", "less", "more", "wc", "md5sum", "sha256sum"}
        search_commands = {"grep", "rg", "ag", "find", "locate"}
        list_commands = {"ls", "tree", "du", "df", "dir"}
        
        first_word = cmd.split()[0] if cmd.split() else ""
        
        return {
            "is_search": first_word in search_commands or any(c in cmd for c in search_commands),
            "is_read": first_word in read_commands,
            "is_list": first_word in list_commands,
        }

    async def _execute_command(
        self, command: str, timeout: Optional[float] = None,
        abort_controller: Optional[asyncio.Event] = None,
    ) -> dict:
        """Execute shell command with full process management."""
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=os.getcwd(),
        )
        
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout or 300,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise
        
        return {
            "stdout": stdout.decode("utf-8", errors="replace"),
            "stderr": stderr.decode("utf-8", errors="replace"),
            "returncode": proc.returncode,
        }

    def is_concurrency_safe(self, input: dict) -> bool:
        cmd = input.get("command", "")
        safe_prefixes = ("echo ", "pwd ", "cd ", "ls ", "cat ", "which ")
        return any(cmd.startswith(p) for p in safe_prefixes)

    def is_read_only(self, input: dict) -> bool:
        cmd = input.get("command", "")
        readonly = {"cat", "head", "tail", "ls", "find", "grep", "wc", "echo", "pwd", "which", "date"}
        first = cmd.split()[0] if cmd.split() else ""
        return first in readonly
```

### Step 4: MCP Client 实现

**文件**: `agent/services/mcp/client.py`

**最小实现**:
```python
"""
MCP Client – Model Context Protocol client.

Port of src/services/mcp/client.ts
Supports stdio transport for connecting to MCP servers.
"""

class MCPServerConnection:
    """Manages a connection to a single MCP server."""

    def __init__(self, config: MCPServerConfig):
        self.config = config
        self._process: Optional[asyncio.subprocess.Process] = None
        self._request_id = 0
        self._pending: dict[int, asyncio.Future] = {}

    async def connect(self) -> None:
        """Connect via stdio transport."""
        if self.config.transport == "stdio":
            await self._connect_stdio()
        elif self.config.transport == "sse":
            await self._connect_sse()
        else:
            raise ValueError(f"Unsupported transport: {self.config.transport}")

    async def _connect_stdio(self) -> None:
        """Start server subprocess and establish JSON-RPC over stdio."""
        cmd = self.config.command or []
        env = self.config.env or {}
        
        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, **env},
        )
        
        # Start reader/writer tasks
        asyncio.create_task(self._read_loop())

    async def _read_loop(self) -> null:
        """Read JSON-RPC responses from server stdout."""
        assert self._process and self._process.stdout
        buf = b""
        async for chunk in self._process.stdout:
            buf += chunk
            # Parse newline-delimited JSON (NDJSON or JSON-RPC)
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                if line.strip():
                    try:
                        msg = json.loads(line)
                        await self._handle_response(msg)
                    except json.JSONDecodeError:
                        pass

    async def _send_request(self, method: str, params: dict = None) -> dict:
        """Send a JSON-RPC request and wait for response."""
        self._request_id += 1
        req_id = self._request_id
        
        future = asyncio.get_event_loop().create_future()
        self._pending[req_id] = future
        
        req = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params or {},
        }
        
        assert self._process and self._process.stdin
        self._process.stdin.write((json.dumps(req) + "\n").encode())
        await self._process.stdin.drain()
        
        return await future

    async def _handle_response(self, msg: dict) -> None:
        """Handle incoming JSON-RPC message."""
        req_id = msg.get("id")
        if req_id is not None and req_id in self._pending:
            future = self._pending.pop(req_id)
            if not future.done():
                if "error" in msg:
                    future.set_exception(Exception(msg["error"]))
                else:
                    future.set_result(msg.get("result", {}))

    async def list_tools(self) -> list[MCPToolDefinition]:
        """List available tools from this server."""
        result = await self._send_request("tools/list")
        return result.get("tools", [])

    async def call_tool(self, name: str, arguments: dict) -> CallToolResult:
        """Call a tool on the server."""
        result = await self._send_request("tools/call", {
            "name": name,
            "arguments": arguments,
        })
        return CallToolResult(**result)

    async def disconnect(self) -> None:
        """Disconnect from the server."""
        if self._process:
            try:
                self._process.terminate()
                await self._process.wait()
            except ProcessLookupError:
                pass
            self._process = None
```

### Step 5: 缺失工具批量创建

为每个缺失工具创建对应的 Python 实现文件。遵循统一模式:

```
agent/tools_impl/{ToolName}/
├── __init__.py          # 导出工具实例
├── {tool_name}.py       # 核心实现 (call方法)
└── prompt.py            # Prompt定义 (从TS prompt.ts迁移)
```

---

## 7. 测试方案

### 7.1 单元测试

#### 7.1.1 核心类型测试

```python
# tests/test_task_types.py
class TestTaskTypes:
    def test_task_type_values(self):
        assert "local_bash" in TaskType.__args__
        assert "dream" in TaskType.__args__
    
    def test_is_terminal_completed(self):
        assert is_terminal_task_status("completed") is True
    
    def test_is_terminal_running(self):
        assert is_terminal_task_status("running") is False
    
    def test_generate_task_id_format(self):
        tid = generate_task_id("local_bash")
        assert tid.startswith("b")
        assert len(tid) == 9  # 1 prefix + 8 random
    
    def test_create_task_state_base(self):
        base = create_task_state_base("test123", "local_bash", "test desc")
        assert base.id == "test123"
        assert base.status == "pending"
        assert base.output_file != ""

# tests/test_tool_types.py
class TestToolTypes:
    def test_empty_permission_context(self):
        ctx = get_empty_tool_permission_context()
        assert ctx.mode == "default"
        assert ctx.is_bypass_permissions_mode_available is False
    
    def test_tool_matches_name_exact(self):
        tool = MockTool(name="Bash")
        assert tool_matches_name(tool, "Bash") is True
    
    def test_tool_matches_name_alias(self):
        tool = MockTool(name="Bash", aliases=["sh", "shell"])
        assert tool_matches_name(tool, "sh") is True
    
    def test_find_tool_by_name(self):
        tools = [MockTool(name="A"), MockTool(name="B")]
        assert find_tool_by_name(tools, "B").name == "B"
        assert find_tool_by_name(tools, "C") is None
    
    def test_filter_progress_messages(self):
        msgs = [
            MockProgressMsg(data={"type": "tool_progress"}),
            MockProgressMsg(data={"type": "hook_progress"}),
            MockProgressMsg(data={"type": "tool_progress"}),
        ]
        filtered = filter_tool_progress_messages(msgs)
        assert len(filtered) == 2
```

#### 7.1.2 API客户端测试

```python
# tests/test_claude_client.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

class TestClaudeClient:
    @pytest.fixture
    def client(self):
        return ClaudeClient(api_key="test-key")

    @pytest.mark.asyncio
    async def test_build_headers(self, client):
        headers = client._build_headers()
        assert headers["Content-Type"] == "application/json"
        assert headers["x-api-key"] == "test-key"
        assert headers["anthropic-version"] == "2023-06-01"

    @pytest.mark.asyncio
    async def test_stream_messages_success(self, client):
        mock_response = self._mock_stream_response([
            '{"type":"message_start","message":{"role":"assistant","content":[],"model":"claude-sonnet-4","stop_reason":null,"usage":{"input_tokens":10,"output_tokens":0}}}',
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
            'data: {"type":"content_block_stop","index":0}',
            'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}',
            'data: {"type":"message_stop"}',
        ])
        
        with patch.object(client, '_get_client', return_value=MagicMock()):
            client._get_client.return_value.stream.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            events = []
            async for event in client.stream_messages([{"role": "user", "content": "hi"}]):
                events.append(event)
            
            assert len(events) > 0
            assert events[0].type == "message_start"

    @pytest.mark.asyncio
    async def test_authentication_error(self, client):
        mock_response = MagicMock()
        mock_response.status_code = 401
        
        with patch.object(client, '_get_client') as mock_get:
            mock_get.return_value.stream.return_value.__aenter__ = AsyncMock(return_value=mock_response)
            
            with pytest.raises(AuthenticationError):
                async for _ in client.stream_messages([]):
                    pass

    @pytest.mark.asyncio
    async def test_rate_limit_retry(self, client):
        """Verify rate limit triggers retry."""
        call_count = 0
        
        async def mock_stream():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                resp = MagicMock()
                resp.status_code = 429
                resp.aiter_lines = AsyncMock(return_value=iter([]))
                resp.raise_for_status = MagicMock(side_effect=httpx.HTTPStatusError("", request=MagicMock(), response=MagicMock(status_code=429)))
                return resp
            # Success on second try
            return self._mock_stream_response(['data: {"type":"message_stop"}'])
        
        with patch.object(client, '_get_client', return_value=MagicMock()):
            client._get_client.return_value.stream.return_value.__aenter__ = AsyncMock(return_value=mock_stream())
            
            events = []
            async for event in client.stream_messages([{"role": "user", "content": "hi"}]):
                events.append(event)
            
            assert call_count == 2  # Should have retried

    def test_count_tokens_approx(self):
        assert ClaudeClient.count_tokens_approx("hello world") == 2  # 10//4 = 2

    def _mock_stream_response(self, lines):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        mock_resp.aiter_lines = AsyncMock(return_value=iter(lines))
        return mock_resp
```

#### 7.1.3 工具测试

```python
# tests/test_bash_tool.py
class TestBashTool:
    @pytest.fixture
    def bash_tool(self):
        return BashTool()

    @pytest.mark.asyncio
    async def test_simple_echo(self, bash_tool):
        ctx = self._mock_context()
        result = await bash_tool.call({"command": "echo hello"}, ctx, lambda *a, **k: None, None)
        assert "hello" in result.data

    @pytest.mark.asyncio
    async def test_timeout(self, bash_tool):
        ctx = self._mock_context()
        with pytest.raises(asyncio.TimeoutError):
            await bash_tool.call({"command": "sleep 10", "timeout": 0.1}, ctx, lambda *a, **k: None, None)

    def test_classify_read_command(self, bash_tool):
        assert bash_tool._classify_command("cat file.txt")["is_read"] is True
        assert bash_tool._classify_command("grep pattern file")["is_search"] is True
        assert bash_tool._classify_command("rm -rf /")["is_read"] is False

    def test_is_read_only(self, bash_tool):
        assert bash_tool.is_read_only({"command": "cat file"}) is True
        assert bash_tool.is_read_only({"command": "rm file"}) is False

    def test_is_concurrency_safe(self, bash_tool):
        assert bash_tool.is_concurrency_safe({"command": "echo hi"}) is True
        assert bash_tool.is_concurrency_safe({"command": "npm install"}) is False

# tests/test_grep_tool.py
class TestGrepTool:
    @pytest.fixture
    def grep_tool(self):
        return GrepTool()

    @pytest.mark.asyncio
    async def test_basic_search(self, grep_tool):
        ctx = self._mock_context()
        result = await grep_tool.call({
            "pattern": "def test",
            "path": ".",
            "output_mode": "content",
        }, ctx, lambda *a, **k: None, None)
        assert isinstance(result.data, (str, list))

# tests/test_glob_tool.py
class TestGlobTool:
    @pytest.mark.asyncio
    async def test_basic_glob(self):
        tool = GlobTool()
        ctx = self._mock_context()
        result = await tool.call({"pattern": "*.py", "path": "."}, ctx, lambda *a, **k: None, None)
        assert isinstance(result.data, list)
```

#### 7.1.4 QueryEngine 测试

```python
# tests/test_query_engine.py
class TestQueryEngine:
    @pytest.mark.asyncio
    async def test_submit_message_yields_init(self):
        config = QueryEngineConfig(
            cwd="/tmp",
            tools=[],
            commands=[],
            can_use_tool=lambda *a, **k: None,
        )
        engine = QueryEngine(config)
        
        messages = []
        async for msg in engine.submit_message("hello"):
            messages.append(msg)
        
        assert len(messages) >= 1
        assert messages[0]["type"] == "system"

    @pytest.mark.asyncio
    async def test_max_turns(self):
        config = QueryEngineConfig(max_turns=1)
        engine = QueryEngine(config)
        
        messages = []
        async for msg in engine.submit_message("test"):
            messages.append(msg)
            if msg.get("subtype") == "error_max_turns":
                break
        
        # Should have max_turns error or regular completion
        assert any(m.get("subtype") in ("error_max_turns", "success") for m in messages)

    def test_interrupt(self):
        engine = QueryEngine(QueryEngineConfig())
        engine.interrupt()
        assert engine._abort_controller.is_set()

    def test_set_model(self):
        engine = QueryEngine(QueryEngineConfig())
        engine.set_model("claude-opus-4")
        assert engine._config.user_specified_model == "claude-opus-4"

    def test_get_messages(self):
        engine = QueryEngine(QueryEngineConfig())
        assert engine.get_messages() == []

    def test_get_session_id(self):
        engine = QueryEngine(QueryEngineConfig())
        assert engine.get_session_id() != ""
```

### 7.2 集成测试

```python
# tests/integration/test_full_query_flow.py
"""
Integration test: Full query flow from user input to API response.
Requires ANTHROPIC_API_KEY to be set.
"""

@pytest.mark.integration
@pytest.mark.asyncio
class TestFullQueryFlow:
    async def test_simple_question(self):
        """Send a simple question and verify we get a response."""
        from agent.services.api.claude import ClaudeClient
        from agent.query_engine import QueryEngine, QueryEngineConfig
        from agent.tools import get_all_base_tools, get_empty_tool_permission_context
        
        if not os.environ.get("ANTHROPIC_API_KEY"):
            pytest.skip("No ANTHROPIC_API_KEY set")
        
        client = ClaudeClient()
        tools = get_all_base_tools()
        perm_ctx = get_empty_tool_permission_context()
        
        engine = QueryEngine(QueryEngineConfig(
            cwd=os.getcwd(),
            tools=[t for t in tools if t.is_enabled()],
            commands=[],
            can_use_tool=lambda *a, **k: PermissionAllowDecision(behavior="allow"),
            max_turns=5,
        ))
        
        results = []
        async for msg in engine.submit_message("Say 'hello world' and nothing else"):
            results.append(msg)
        
        # Verify we got a successful result
        assert any(r.get("type") == "result" for r in results)
        result_msg = next(r for r in results if r.get("type") == "result")
        assert result_msg.get("is_error") is False
        assert "hello" in result_msg.get("result", "").lower()
        
        await client.close()

# tests/integration/test_mcp_connection.py
@pytest.mark.integration
@pytest.mark.asyncio
class TestMCPConnection:
    async def test_connect_stdio_server(self):
        """Test connecting to an MCP server via stdio."""
        from agent.services.mcp.client import MCPServerConnection
        from agent.services.mcp.types import MCPServerConfig
        
        config = MCPServerConfig(
            name="test",
            transport="stdio",
            command=["node", "/path/to/server.js"],
        )
        
        conn = MCPServerConnection(config)
        # This would need a real MCP server to test fully
        # For now just verify the object creates correctly
        assert conn.config.name == "test"
```

### 7.3 功能验证测试

```python
# tests/e2e/test_cli_modes.py
class TestCLIModes:
    def test_print_mode_execution(self, capsys):
        """Test that print (-p) mode works end-to-end."""
        import asyncio
        from agent.main import cli_main
        
        # This is a smoke test - real testing needs mocked API
        asyncio.run(cli_main(["-p", "say hi"]))
        
        captured = capsys.readouterr()
        # Should not crash at minimum

    def test_version_flag(self, capsys):
        from agent.main import cli_main
        import sys
        with pytest.raises(SystemExit):
            cli_main(["--version"])
```

### 7.4 测试覆盖率目标

| 模块 | 目标覆盖率 | 优先级 |
|------|-----------|--------|
| `task.py` | 95% | P0 |
| `tool.py` | 90% | P0 |
| `tools.py` | 85% | P0 |
| `query_engine.py` | 85% | P0 |
| `services/api/claude.py` | 90% | P0 |
| `services/mcp/client.py` | 85% | P1 |
| `tools_impl/BashTool/` | 85% | P1 |
| `tools_impl/GrepTool/` | 80% | P1 |
| `tools_impl/GlobTool/` | 80% | P1 |
| `tools_impl/AgentTool/` | 75% | P1 |
| `commands.py` | 80% | P2 |
| `context.py` | 80% | P2 |
| `bridge/` | 70% | P2 |

---

## 8. 风险评估与缓解措施

### 8.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| API行为差异 (TS↔Python SDK) | 中 | 高 | 严格对照API文档；编写契约测试 |
| 异步模型差异 (Promise↔async/await) | 低 | 中 | Python async/await足够表达；注意取消语义 |
| 流式处理差异 (ReadableStreamↈasync generator) | 中 | 中 | 使用async generator + proper buffering |
| 类型安全差异 (Zod↔Pydantic/dict) | 中 | 低 | 关键路径添加运行时验证 |
| 文件编码差异 (UTF-16↔UTF-8) | 低 | 中 | 统一使用UTF-8；显式编码声明 |
| 子进程管理差异 (child_process↔subprocess) | 中 | 中 | 详细对照信号处理、管道、环境变量 |

### 8.2 兼容性风险

| 风险 | 缓解 |
|------|------|
| Python版本兼容 (3.10+) | 使用 `from __future__ import annotations`;标注最低版本 |
| OS差异 (Windows/Linux/macOS) | 路径处理使用 pathlib;条件导入平台模块 |
| 依赖库版本冲突 | 锁定依赖版本;使用 pyproject.toml |
| 环境变量差异 | 统一命名规范;文档化所有env vars |

### 8.3 性能风险

| 风险 | 缓解 |
|------|------|
| Python异步性能 | 使用 uvloop;避免同步阻塞在async中 |
| 内存占用 | 流式处理大输出;LRU缓存限制 |
| 启动时间 | 延迟导入非关键模块 |

---

## 附录 A: 文件映射速查表

| TypeScript 文件 | Python 对应文件 | 状态 |
|----------------|----------------|------|
| `src/Task.ts` | `agent/task.py` | ✅ 完成 |
| `src/Tool.ts` | `agent/tool.py` | ⚠️ 核心完成，UI方法缺 |
| `src/tools.ts` | `agent/tools.py` | ⚠️ 部分工具 |
| `src/commands.ts` | `agent/commands.py` | ✅ 基本完成 |
| `src/QueryEngine.ts` | `agent/query_engine.py` | ✅ 核心完成 |
| `src/context.ts` | `agent/context.py` | ⚠️ 简化版 |
| `src/setup.ts` | `agent/setup.py` | ✅ 基本完成 |
| `src/main.tsx` | `agent/main.py` | ⚠️ 简化版 |
| `src/history.ts` | `agent/history.py` | 待确认 |
| `src/query.ts` | `agent/query.py` | ✅ 已验证完整 |
| `src/services/api/claude.ts` | `agent/services/api/claude.py` | ✅ P0 完成 |
| `src/services/mcp/client.ts` | `agent/services/mcp/client.py` | ❌ 存根 |

---

## 附录 B: 技术栈映射

| TypeScript 技术 | Python 对应技术 | 备注 |
|----------------|----------------|------|
| Commander.js | argparse | CLI参数解析 |
| React + Ink | print() / rich | 终端UI (大幅简化) |
| Zod | Pydantic / 手动验证 | 数据校验 |
| fetch() | httpx / aiohttp | HTTP客户端 |
| ReadableStream | AsyncGenerator | 流式数据 |
| AbortController | asyncio.Event + CancelScope | 取消操作 |
| EventEmitter | asyncio.Event / callbacks | 事件系统 |
| lodash-es | 标准库 / more-itertools | 工具函数 |
| node:crypto | secrets / hashlib | 加密随机 |
| bun:bundle feature flags | os.environ | 功能开关 |
| JSON-RPC (custom) | json-rpc / 手动 | MCP协议 |
| node:child_process | asyncio.subprocess | 子进程 |
| fs/promises | pathlib / aiofiles | 文件操作 |
| semver | packaging.version | 版本比较 |
| dot-prop | dict path access | 嵌套访问 |
| chalk / ansi-colors | rich / colorama | 终端颜色 |
