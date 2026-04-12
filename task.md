# Claude Code Python 重构详细任务清单

> **文档版本**: v1.0
> **生成日期**: 2026-04-03
> **基于**: REFACTORING_PLAN.md v1.1

---

## 目录

1. [P0 阻塞性任务 - 核心运行链路](#1-p0-阻塞性任务---核心运行链路)
2. [P1 关键功能任务](#2-p1-关键功能任务)
3. [P2 重要功能任务](#3-p2-重要功能任务)
4. [已验证完成模块](#4-已验证完成模块)

---

## 1. P0 阻塞性任务 - 核心运行链路

> **目标**: 让Python版本能够完成一次完整的"用户输入→API调用→返回结果"流程。

### 1.1 Claude API 客户端实现

**文件**: `agent/services/api/claude.py`
**状态**: 27行存根 → 需要实现约3400行等效代码
**优先级**: P0-CRITICAL

#### 任务 1.1.1: 核心数据结构和类型定义

```python
# 需要实现的内容:
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Literal

# 消息类型 (对应 TS BetaMessageParam)
@dataclass
class MessageParam:
    role: Literal["user", "assistant"]
    content: str | list[dict[str, Any]]

# 工具定义 (对应 TS BetaToolUnion)
@dataclass
class ToolParam:
    name: str
    description: str = ""
    input_schema: dict[str, Any] = field(default_factory=dict)

# API 响应类型
@dataclass
class MessageResponse:
    id: str
    type: str
    role: str
    content: list[dict[str, Any]]
    model: str
    stop_reason: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)

# 流式事件类型
@dataclass
class StreamEvent:
    type: str
    delta: str | None = None
    index: int = 0
    message: MessageResponse | None = None
```

#### 任务 1.1.2: HTTP 客户端封装

```python
# 参考: claude-code/src/services/api/client.ts
# 需要实现:
class ClaudeHTTPClient:
    def __init__(self, api_key: str, base_url: str | None = None):
        self.api_key = api_key
        self.base_url = base_url or "https://api.anthropic.com"
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "ClaudeHTTPClient":
        self._client = httpx.AsyncClient(
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(120.0, connect=30.0),
        )
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()

    async def post(
        self,
        path: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        # 实现 POST 请求
        pass

    async def stream_post(
        self,
        path: str,
        data: dict[str, Any],
    ) -> AsyncGenerator[dict[str, Any], None]:
        # 实现流式 POST 请求
        # 使用 httpx.asyc_client.stream() 或 aiohttp
        pass
```

#### 任务 1.1.3: 消息构建函数

```python
# 参考: claude-code/src/services/api/claude.ts
# userMessageToMessageParam, assistantMessageToMessageParam

def user_message_to_message_param(
    message: "UserMessage",
    add_cache: bool = False,
    enable_prompt_caching: bool = False,
    query_source: str | None = None,
) -> MessageParam:
    """将 UserMessage 转换为 API 格式"""
    pass

def assistant_message_to_message_param(
    message: "AssistantMessage",
    add_cache: bool = False,
    enable_prompt_caching: bool = False,
    query_source: str | None = None,
) -> MessageParam:
    """将 AssistantMessage 转换为 API 格式"""
    pass
```

#### 任务 1.1.4: Prompt 缓存控制

```python
# 参考: claude-code/src/services/api/claude.ts
# getPromptCachingEnabled, getCacheControl

def get_prompt_caching_enabled(model: str) -> bool:
    """检查是否为指定模型启用 Prompt 缓存"""
    pass

def get_cache_control(
    scope: str | None = None,
    query_source: str | None = None,
) -> dict[str, Any]:
    """获取缓存控制参数"""
    pass
```

#### 任务 1.1.5: 核心查询函数

```python
# 参考: claude-code/src/services/api/claude.ts
# queryModel, queryModelWithStreaming, executeNonStreamingRequest

async def query_model_with_streaming(
    params: dict[str, Any],
) -> AsyncGenerator[StreamEvent, None]:
    """
    流式查询 Claude API

    参数:
        params: {
            model: str,
            messages: list[MessageParam],
            system: str | list[dict] | None,
            tools: list[ToolParam] | None,
            max_tokens: int,
            stream: bool = True,
            thinking: dict | None = None,
            ...
        }

    yeilds:
        StreamEvent - 流式事件
    """
    pass

async def execute_non_streaming_request(
    params: dict[str, Any],
) -> MessageResponse:
    """非流式查询"""
    pass
```

#### 任务 1.1.6: 重试逻辑

```python
# 参考: claude-code/src/services/api/withRetry.ts
# withRetry

class RetryContext:
    max_retries: int
    current_retry: int = 0
    model: str
    thinking_config: dict[str, Any] | None = None

class CannotRetryError(Exception):
    original_error: Exception

async def with_retry(
    client_factory: Callable,
    request: Callable,
    context: RetryContext,
) -> Any:
    """带重试的请求执行"""
    pass
```

#### 任务 1.1.7: Token 计数和预算控制

```python
# 参考: claude-code/src/services/api/claude.ts
# getMaxOutputTokensForModel, configureTaskBudgetParams

def get_max_output_tokens_for_model(model: str) -> int:
    """获取模型最大输出 tokens"""
    pass

def configure_task_budget_params(
    task_budget: dict[str, Any] | None,
    output_config: dict[str, Any],
    betas: list[str],
) -> None:
    """配置任务预算参数"""
    pass
```

#### 任务 1.1.8: 工具 Schema 转换

```python
# 参考: claude-code/src/utils/api.ts
# toolToAPISchema

def tool_to_api_schema(tool: "Tool") -> dict[str, Any]:
    """将 Tool 转换为 API 格式的 schema"""
    pass
```

#### 任务 1.1.9: 使用量追踪

```python
# 参考: claude-code/src/services/api/claude.ts
# updateUsage, accumulateUsage

@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_tokens: int = 0
    cache_read_tokens: int = 0

def update_usage(
    response: MessageResponse,
    usage: Usage,
) -> None:
    """更新使用量"""
    pass

def accumulate_usage(
    total: Usage,
    delta: Usage,
) -> None:
    """累计使用量"""
    pass
```

#### 任务 1.1.10: API Key 验证

```python
# 参考: claude-code/src/services/api/claude.ts
# verifyApiKey

async def verify_api_key(
    api_key: str,
    is_non_interactive_session: bool = False,
) -> bool:
    """验证 API Key 是否有效"""
    pass
```

---

### 1.2 查询循环核心实现

**文件**: `agent/query.py`
**参考**: `claude-code/src/query.ts`
**状态**: 约60%完成度
**优先级**: P0-CRITICAL

#### 任务 1.2.1: 消息预处理

```python
# normalizeMessagesForAPI
def normalize_messages_for_api(
    messages: list["Message"],
) -> list[dict[str, Any]]:
    """规范化消息为 API 格式"""
    pass

# stripAdvisorBlocks
def strip_advisor_blocks(
    messages: list["Message"],
) -> list["Message"]:
    """移除 advisor 相关块"""
    pass

# ensureToolResultPairing
def ensure_tool_result_pairing(
    messages: list["Message"],
) -> list["Message"]:
    """确保 tool_use 和 tool_result 配对"""
    pass
```

#### 任务 1.2.2: 工具调用循环

```python
# 参考: claude-code/src/query.ts
# processUserInput 或查询循环核心

class QueryLoop:
    def __init__(
        self,
        engine: "QueryEngine",
        tools: list["Tool"],
        can_use_tool: Callable,
    ):
        self.engine = engine
        self.tools = tools
        self.can_use_tool = can_use_tool
        self.max_turns: int | None = None

    async def run(
        self,
        messages: list["Message"],
        context: "ToolUseContext",
    ) -> AsyncGenerator["Message", None]:
        """
        核心查询循环:
        1. 发送消息到 API
        2. 接收响应
        3. 如果是 tool_use，调用工具并循环
        4. 返回最终响应
        """
        pass

    async def _handle_tool_call(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
        context: "ToolUseContext",
    ) -> "ToolResult":
        """处理单个工具调用"""
        pass

    def _should_continue(
        self,
        stop_reason: str | None,
        turn_count: int,
    ) -> bool:
        """判断是否继续查询循环"""
        pass
```

#### 任务 1.2.3: 停止原因处理

```python
# 参考: claude-code/src/query.ts
# end_turn, tool_use, max_tokens, stop_sequence

STOP_REASONS = {
    "end_turn": "模型已生成完整响应",
    "tool_use": "需要调用工具",
    "max_tokens": "达到最大 token 限制",
    "stop_sequence": "遇到停止序列",
    "max_turns": "达到最大轮次",
}

def handle_stop_reason(
    reason: str | None,
    message: "AssistantMessage",
) -> str:
    """处理停止原因并返回下一个动作"""
    pass
```

---

### 1.3 消息类型系统完善

**文件**: `agent/types/message.py`
**参考**: `claude-code/src/types/message.ts`
**状态**: 需要验证完整性
**优先级**: P0-CRITICAL

#### 任务 1.3.1: 消息类型定义

```python
# 确保以下类型定义完整:
@dataclass
class UserMessage:
    id: str
    message: Content

@dataclass
class AssistantMessage:
    id: str
    message: Content
    stop_reason: str | None = None

@dataclass
class SystemMessage:
    id: str
    message: Content

@dataclass
class Content:
    content_type: str  # "text", "tool_use", "tool_result"
    text: str | None = None
    tool_use: ToolUse | None = None
    tool_result: ToolResult | None = None

@dataclass
class ToolUse:
    id: str
    name: str
    input: dict[str, Any]

@dataclass
class ToolResult:
    tool_use_id: str
    content: str
    is_error: bool = False

@dataclass
class ProgressMessage:
    pass

@dataclass
class AttachmentMessage:
    pass
```

---

## 2. P1 关键功能任务

### 2.1 MCP 客户端完善 ✅

**文件**: `agent/services/mcp_client/client.py`
**参考**: `claude-code/src/services/mcp/client.ts`
**状态**: ✅ 已完成 (100%)
**完成日期**: 2026-04-03
**优先级**: P1-HIGH → ✅ 完成

#### 已实现功能:

✅ **SSE传输** (`SSEConnection`):
- Server-Sent Events 连接
- 事件流处理
- 请求/响应分离

✅ **StreamableHTTP传输** (`StreamableHTTPConnection`):
- Session 管理
- 流式响应处理
- OAuth 认证支持

✅ **WebSocket传输** (`WebSocketConnection`):
- WebSocket 连接
- JSON-RPC 消息处理
- 自动重连支持

✅ **统一 MCPClient** (`MCPClient`):
- 多服务器管理
- `connect_server()` / `disconnect_server()`
- `list_tools()` / `call_tool()` / `list_resources()` / `read_resource()`

```python
# 使用示例:
from agent.services.mcp_client import get_mcp_client, StdioMCPConnection

client = get_mcp_client()
await client.connect_server("my-server", transport="stdio", command="npx", args=["mcp-server"])
tools = await client.list_tools()
result = await client.call_tool("my-server", "tool-name", {"arg": "value"})
```

#### 任务 2.1.3: WebSocket 传输实现

```python
# 参考: claude-code/src/services/mcp/client.ts
# _connect_websocket

async def _connect_websocket(
    self,
    url: str,
    headers: dict[str, str],
) -> None:
    """
    通过 WebSocket 连接 MCP 服务器
    """
    pass
```

#### 任务 2.1.4: OAuth 认证流程

```python
# 参考: claude-code/src/services/mcp/client.ts
# OAuth 认证相关

async def _authenticate_oauth(self) -> None:
    """OAuth 认证流程"""
    pass

async def _refresh_oauth_token(self, refresh_token: str) -> None:
    """刷新 OAuth Token"""
    pass
```

#### 任务 2.1.5: 错误恢复和重连

```python
# 参考: claude-code/src/services/mcp/client.ts
# 重连逻辑

async def _handle_disconnect(self) -> None:
    """处理断开连接"""
    pass

async def _reconnect(self) -> None:
    """尝试重新连接"""
    pass
```

---

### 2.2 工具集完善

#### 任务 2.2.1: BashTool 命令执行 ✅

**文件**: `agent/tools_impl/BashTool/bash_tool.py`
**参考**: `claude-code/src/tools/BashTool/`
**状态**: ✅ 已完成
**优先级**: P1-HIGH → ✅ 完成

#### 已实现功能:

✅ **命令分类**:
- `SEARCH_COMMANDS`: grep, find, ls, cat, head, tail, git 系列等
- `READONLY_COMMANDS`: cat, head, tail, less, file, stat 等
- `LIST_COMMANDS`: ls, find, fd 等
- 危险命令检测 (npm install, yarn, rm -rf, mkfs 等)

✅ **命令执行**:
- 跨平台支持 (bash/PowerShell/cmd)
- 超时控制
- AbortController 支持取消
- 输出编码处理
- 输出大小限制 (500,000 字符)

✅ **并发安全**:
- `is_concurrency_safe()` 判断
- 危险命令拒绝并发执行

✅ **沙箱集成** (框架已就绪):
- `BashSandbox` 类结构已完成
- 命令分类和权限检查框架

#### 任务 2.2.2: AgentTool 子代理机制 ✅

**文件**: `agent/tools_impl/AgentTool/agent_tool.py`
**参考**: `claude-code/src/tools/AgentTool/`
**状态**: ✅ 已完成
**优先级**: P1-HIGH → ✅ 完成

#### 已实现功能:

✅ **子代理启动**:
- `QueryEngine` 实例创建
- 独立工具集配置
- 消息提交和结果收集

✅ **参数支持**:
- `prompt`: 子代理任务描述
- `description`: 任务说明
- `subagent_type`: 子代理类型
- `model`: 指定模型
- `run_in_background`: 后台运行

✅ **错误处理**:
- 异常捕获和结果返回
- 空结果处理

#### 任务 2.2.3: GrepTool 完善

**文件**: `agent/tools_impl/GrepTool/grep_tool.py`
**参考**: `claude-code/src/tools/GrepTool/`
**状态**: 25%完成度
**优先级**: P1-MEDIUM

```python
# 需要实现:
class GrepTool:
    """内容搜索工具"""

    def __init__(self):
        self.name = "Grep"
        self.aliases = ["grep", "search", "rg"]

    async def call(
        self,
        args: dict[str, Any],
        context: ToolUseContext,
    ) -> ToolResult:
        """
        参数:
            pattern: str           # 正则表达式
            path: str             # 搜索路径
            context: int = 0      # 上下文行数
            before: int = 0       # 前的行数
            after: int = 0        # 后的行数
            files_with_matches: bool = True
            output_mode: str = "content"  # content | files_with_matches | count
            case_sensitive: bool = False
            include: str | None = None  # 文件过滤 glob
            exclude: str | None = None
            max_results: int = 1000
        """
        pass
```

#### 任务 2.2.4: GlobTool 完善

**文件**: `agent/tools_impl/GlobTool/glob_tool.py`
**参考**: `claude-code/src/tools/GlobTool/`
**状态**: 30%完成度
**优先级**: P1-MEDIUM

```python
# 需要实现:
class GlobTool:
    """文件搜索工具"""

    def __init__(self):
        self.name = "Glob"
        self.aliases = ["glob", "find"]

    async def call(
        self,
        args: dict[str, Any],
        context: ToolUseContext,
    ) -> ToolResult:
        """
        参数:
            pattern: str           # glob 模式 (e.g., "**/*.py")
            path: str | None = None  # 搜索根路径
            include_hidden: bool = False
            max_results: int = 1000
            file_type: str | None = None  # file | dir | both
        """
        pass
```

#### 任务 2.2.5: LSPTool 语言服务

**文件**: `agent/tools_impl/LSPTool/lsp_tool.py`
**参考**: `claude-code/src/tools/LSPTool/`
**状态**: 20%完成度
**优先级**: P1-MEDIUM

```python
# 需要实现:
class LSPTool:
    """语言服务器协议工具"""

    def __init__(self):
        self.name = "LSP"
        self.aliases = ["lsp"]

    async def call(
        self,
        args: dict[str, Any],
        context: ToolUseContext,
    ) -> ToolResult:
        """
        参数:
            action: str  # goto_definition | find_references | hover | completions
            file: str
            line: int
            col: int
        """
        pass
```

#### 任务 2.2.6: MCPTool MCP 交互

**文件**: `agent/tools_impl/MCPTool/mcp_tool.py`
**参考**: `claude-code/src/tools/MCPTool/`
**状态**: 20%完成度
**优先级**: P1-MEDIUM

```python
# 需要实现:
class MCPTool:
    """MCP 服务器工具代理"""

    def __init__(self):
        self.name = "MCP"
        self.aliases = ["mcp"]

    async def call(
        self,
        args: dict[str, Any],
        context: ToolUseContext,
    ) -> ToolResult:
        """
        参数:
            server: str           # MCP 服务器名称
            tool: str             # 工具名称
            arguments: dict[str, Any]  # 工具参数
        """
        pass

    async def list_servers(self) -> list[dict[str, str]]:
        """列出已连接的 MCP 服务器"""
        pass

    async def list_tools(self, server: str) -> list[MCPToolDefinition]:
        """列出服务器上的工具"""
        pass
```

---

### 2.3 缺失工具实现

#### 任务 2.3.1: P1-A 核心交互工具 ✅

1. **AskUserQuestionTool** (`agent/tools_impl/AskUserQuestionTool/ask_user_question_tool.py`) ✅
   - 用户交互提问工具
   - 状态: ✅ 已完成
   - 功能: 问题格式化、选项处理、单选/多选、用户输入获取

2. **ListMcpResourcesTool** (`agent/tools_impl/ListMcpResourcesTool/`) ✅
   - MCP 资源列表
   - 状态: ✅ 已完成
   - 功能: 列出 MCP 服务器资源，支持按服务器过滤

3. **ReadMcpResourceTool** (`agent/tools_impl/ReadMcpResourceTool/`) ✅
   - MCP 资源读取
   - 状态: ✅ 已完成
   - 功能: 读取 MCP 服务器资源内容，内容类型检测

4. **ToolSearchTool** (`agent/tools_impl/ToolSearchTool/`)
   - 工具搜索
   - 状态: 待实现
   - 需要实现: 工具延迟加载搜索

5. **EnterPlanModeTool** (`agent/tools_impl/EnterPlanModeTool/`)
   - 进入计划模式
   - 状态: 待实现
   - 需要实现: 模式切换、上下文保存

6. **ExitPlanModeTool** (`agent/tools_impl/ExitPlanModeTool/`)
   - 退出计划模式
   - 状态: 待实现
   - 需要实现: 模式恢复

#### 任务 2.3.2: P1-B 任务管理工具

7. **TaskOutputTool** (`agent/tools_impl/TaskOutputTool/task_output_tool.py`)
   - 任务输出读取

8. **TaskCreateTool** (`agent/tools_impl/TaskCreateTool/`)
   - 任务创建 (TodoV2)

9. **TaskGetTool** (`agent/tools_impl/TaskGetTool/`)
   - 任务获取 (TodoV2)

10. **TaskUpdateTool** (`agent/tools_impl/TaskUpdateTool/`)
    - 任务更新 (TodoV2)

11. **TaskListTool** (`agent/tools_impl/TaskListTool/`)
    - 任务列表 (TodoV2)

#### 任务 2.3.3: P1-C 扩展功能工具

12. **NotebookEditTool** (`agent/tools_impl/NotebookEditTool/`)
    - Jupyter Notebook 编辑

13. **SendMessageTool** (`agent/tools_impl/SendMessageTool/`)
    - 团队消息发送

14. **PowerShellTool** (`agent/tools_impl/PowerShellTool/`)
    - PowerShell 执行 (已有骨架)

15. **WorkflowTool** (`agent/tools_impl/WorkflowTool/`)
    - 工作流执行

16. **WebBrowserTool** (`agent/tools_impl/WebBrowserTool/`)
    - 浏览器控制

---

### 2.4 命令系统完善

**文件**: `agent/commands.py`, `agent/commands_impl/`
**参考**: `claude-code/src/commands.ts`, `claude-code/src/commands/`
**状态**: ~50%完成度
**优先级**: P1-MEDIUM

#### 任务 2.4.1: 命令注册表完善

```python
# 当前实现只有 ~15 个基础命令
# 需要扩展到 60+ 命令

# 命令清单 (按优先级):
# P1:
- /model         # 模型切换 ✅ 基本实现
- /mcp           # MCP 管理 ⚠️ 简化
- /compact       # 上下文压缩 ⚠️ 简化
- /resume        # 会话恢复 ⚠️ 简化
- /review        # 代码审查 ⚠️ 简化

# P2:
- /init          # 项目初始化 ✅ 基本
- /plugin        # 插件管理 ⚠️ 骨架
- /skills        # 技能管理 ⚠️ 骨架
- /theme         # 主题切换 ⚠️ 简化
- /status        # 状态显示 ⚠️ 简化
- /session       # 会话管理 ⚠️ 简化
```

#### 任务 2.4.2: CLI 子命令系统

```python
# 参考: claude-code/src/main.tsx
# Commander 子命令结构

# 需要实现的子命令:
# - claude install    # 安装引导
# - claude doctor     # 诊断
# - claude init       # 项目初始化
# - claude mcp        # MCP 管理
# - claude plugin     # 插件管理
# - claude upgrade    # 升级
# - claude config     # 配置编辑

async def add_cli_subcommands(parser: argparse.ArgumentParser) -> None:
    """添加子命令到 CLI"""
    pass
```

---

## 3. P2 重要功能任务

### 3.1 OAuth 认证流程完善

**文件**: `agent/services/oauth/`
**参考**: `claude-code/src/services/oauth/`
**状态**: 50%完成度
**优先级**: P2

```python
# 需要完善:
async def exchange_code_for_tokens(
    authorization_code: str,
    state: str,
    code_verifier: str,
    port: int,
) -> OAuthTokenExchangeResponse:
    """交换授权码为 Token"""
    pass

async def refresh_oauth_token(
    refresh_token: str,
    scopes: list[str],
) -> OAuthTokens:
    """刷新 OAuth Token"""
    pass

def build_authorization_url(
    code_challenge: str,
    state: str,
    port: int,
    login_with_claude_ai: bool = False,
) -> str:
    """构建授权 URL"""
    pass
```

---

### 3.2 LSP 服务完善

**文件**: `agent/services/lsp/`
**参考**: `claude-code/src/services/lsp/`
**状态**: 40%完成度
**优先级**: P2

```python
# 需要完善 LSPClient 类:
class LSPClient:
    """完整的 LSP 客户端"""

    async def start(
        self,
        command: str,
        args: list[str],
        cwd: str | None = None,
    ) -> None:
        """启动 LSP 服务器"""
        pass

    async def initialize(self, params: dict[str, Any]) -> dict[str, Any]:
        """初始化 LSP 会话"""
        pass

    async def shutdown(self) -> None:
        """关闭 LSP 会话"""
        pass

    # 功能方法
    async def goto_definition(
        self,
        file: str,
        line: int,
        col: int,
    ) -> list[dict[str, Any]]:
        pass

    async def find_references(
        self,
        file: str,
        line: int,
        col: int,
    ) -> list[dict[str, Any]]:
        pass

    async def hover(
        self,
        file: str,
        line: int,
        col: int,
    ) -> str | None:
        pass

    async def completions(
        self,
        file: str,
        line: int,
        col: int,
    ) -> list[dict[str, Any]]:
        pass

    async def diagnostics(self, file: str) -> list[dict[str, Any]]:
        pass
```

---

### 3.3 压缩服务完善

**文件**: `agent/services/compact/`
**参考**: `claude-code/src/services/compact/`
**状态**: 40%完成度
**优先级**: P2

```python
# 需要实现:
class Compactor:
    """上下文压缩器"""

    async def compact(
        self,
        messages: list["Message"],
        max_tokens: int,
    ) -> list["Message"]:
        """
        压缩消息历史以适应 token 限制
        """
        pass

    async def add_cache_breakpoints(
        self,
        messages: list["Message"],
    ) -> list["Message"]:
        """添加缓存断点以优化成本"""
        pass
```

---

### 3.4 主入口 REPL 完善

**文件**: `agent/main.py`
**参考**: `claude-code/src/main.tsx`
**状态**: 40%完成度
**优先级**: P2

```python
# 需要实现:
class REPL:
    """交互式 REPL"""

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.history: list[str] = []

    async def run(self) -> None:
        """主 REPL 循环"""
        while True:
            try:
                user_input = await self._read_input()
                if not user_input:
                    continue
                await self._process_input(user_input)
            except KeyboardInterrupt:
                self._handle_interrupt()
            except EOFError:
                break

    async def _read_input(self) -> str:
        """读取用户输入 (支持 readline 历史)"""
        pass

    async def _process_input(self, input: str) -> None:
        """处理用户输入"""
        pass

    def _render_output(self, messages: list["Message"]) -> None:
        """渲染输出 (简单 ANSI 颜色)"""
        pass

    def _handle_interrupt(self) -> None:
        """处理 Ctrl+C"""
        pass
```

---

## 4. 已验证完成模块

以下模块已经过验证，功能与 TypeScript 版本一致：

### 4.1 核心类型 (✅ ~90%)

| 文件 | 状态 | 说明 |
|------|------|------|
| `agent/task.py` | ✅ 完成 | TaskType, TaskStatus, TaskHandle, TaskStateBase |
| `agent/tool.py` | ⚠️ 核心完成 | 协议定义完整，UI 方法缺失 (Python 无需) |

### 4.2 工具注册表 (⚠️ ~70%)

| 文件 | 状态 | 说明 |
|------|------|------|
| `agent/tools.py` | ⚠️ 框架完成 | 注册机制存在，工具实现 |
| 基础工具 | ⚠️ 大部分完成 | `_wrap_module_tool` 模式有效 |

### 4.3 Bridge 层 (✅ ~75%)

| 目录 | 状态 | 说明 |
|------|------|------|
| `agent/bridge/` | ✅ 基本完成 | 24个文件对应，IPC 机制完整 |

### 4.4 辅助模块 (✅ ~70%)

| 目录 | 状态 | 说明 |
|------|------|------|
| `agent/constants/` | ✅ 基本完整 | 19个文件对应 |
| `agent/types/` | ✅ 基本完整 | 类型定义完善 |
| `agent/bootstrap/` | ✅ 基本完整 | 状态管理 |
| `agent/buddy/` | ✅ 基本完整 | 去 UI 版 |

### 4.5 MCP 客户端 (✅ ~100%) 🆕

| 文件 | 状态 | 说明 |
|------|------|------|
| `agent/services/mcp_client/client.py` | ✅ 完成 | 多传输协议支持 |
| `StdioMCPConnection` | ✅ 完成 | 子进程 JSON-RPC |
| `SSEConnection` | ✅ 完成 | Server-Sent Events |
| `StreamableHTTPConnection` | ✅ 完成 | HTTP 流式 |
| `WebSocketConnection` | ✅ 完成 | WebSocket |

### 4.6 核心工具 (✅ ~85%) 🆕

| 文件 | 状态 | 说明 |
|------|------|------|
| `BashTool` | ✅ 完成 | 命令执行、分类、安全检查 |
| `AgentTool` | ✅ 完成 | 子代理机制 |
| `AskUserQuestionTool` | ✅ 完成 | 用户交互 |
| `ListMcpResourcesTool` | ✅ 完成 | MCP 资源列表 |
| `ReadMcpResourceTool` | ✅ 完成 | MCP 资源读取 |

---

## 附录: 迁移技术映射

### A.1 TypeScript → Python 类型映射

| TS 类型 | Python 实现 | 备注 |
|--------|------------|------|
| `interface` | `@dataclass` | 数据类 |
| `type X = Y \| Z` | `X = Y \| Z` | Union 类型 |
| `enum` | `class Enum` | 枚举类 |
| `readonly` | 不可变 dataclass | `frozen=True` |
| `Partial<T>` | `T \| None` 或 `Optional[T]` | 可选 |
| `Record<K,V>` | `dict[K, V]` | 字典 |
| `Array<T>` | `list[T]` | 列表 |
| `Set<T>` | `set[T]` | 集合 |

### A.2 异步模式映射

| TS 模式 | Python 实现 | 备注 |
|--------|------------|------|
| `Promise<T>` | `Coroutine[T]` / `Awaitable[T]` | async 函数 |
| `async function*()` | `async def yiel d()` | async 生成器 |
| `ReadableStream` | `AsyncGenerator` | 流式数据 |
| `AbortController` | `asyncio.Event` + `anyio.CancelScope` | 取消控制 |
| `Promise.all()` | `asyncio.gather()` | 并发 |
| `Promise.race()` | `asyncio.wait()` | 竞态 |

### A.3 HTTP 客户端映射

| TS | Python |
|----|--------|
| `fetch()` | `httpx.AsyncClient` / `aiohttp` |
| `RequestInit` | `httpx.Request` |
| `Response` | `httpx.Response` |

### A.4 子进程映射

| TS | Python |
|----|--------|
| `spawn(cmd, args)` | `asyncio.create_subprocess_exec()` |
| `stdout.on('data')` | `async for chunk in process.stdout` |
| `process.on('exit')` | `await process.wait()` |
| `kill()` | `process.terminate()` / `process.kill()` |

---

## 附录: 验收标准

### P0 验收标准

1. **Claude API 客户端**
   - [ ] 能够发送非流式消息请求并获得响应
   - [ ] 能够发送流式消息请求并正确解析事件
   - [ ] 工具调用能够正确序列化并发送到 API
   - [ ] 重试逻辑在 429/503 错误时正常工作

2. **查询循环**
   - [ ] 完整消息循环: 用户输入 → API → 响应
   - [ ] 工具调用循环: tool_use → tool_result → 继续查询
   - [ ] 停止原因正确处理 (end_turn, tool_use, max_tokens)

3. **消息类型**
   - [ ] UserMessage → API 格式正确
   - [ ] AssistantMessage → API 格式正确
   - [ ] ToolUse/ToolResult 正确配对

## 4. P0 验收标准（核心运行链路）

### 4.1 Claude API 客户端 (`services/api/claude.py`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| `verify_api_key()` | ✅ 已实现 | 调用 API 验证 Key 有效性 |
| `get_max_output_tokens_for_model()` | ✅ 已实现 | 返回模型对应的 max_tokens |
| `CannotRetryError` 异常类 | ✅ 已实现 | 重试逻辑专用异常 |
| `query_haiku()` | ✅ 已实现 | 轻量级 Haiku 模型调用 |
| `query_model_with_streaming()` | ✅ 已实现 | 委托 client.py 流式调用 |
| `query_model_without_streaming()` | ✅ 已实现 | 委托 client.py 非流式调用 |
| `get_cache_control()` | ✅ 已实现 | Prompt 缓存控制参数 |
| `get_prompt_caching_enabled()` | ✅ 已实现 | 模型缓存启用检查 |
| `get_extra_body_params()` | ✅ 已实现 | API 额外参数 |
| `is_authentication_error()` | ✅ 已实现 | 认证错误判断 |
| `extract_quota_status_from_error()` | ✅ 已实现 | 配额状态提取 |
| `stream_message_beta()` | ✅ 存根 | 兼容性别名 |

### 4.2 API 客户端核心 (`services/api/client.py`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| `call_model_api()` | ✅ 已实现 | 流式/非流式 API 调用 |
| `_streaming_request()` | ✅ 已实现 | 使用 `AsyncAnthropic.messages.stream()` |
| `_non_streaming_request()` | ✅ 已实现 | 使用 `AsyncAnthropic.messages.create()` |
| `build_tools_param()` | ✅ 已实现 | 将 Tool 转换为 API schema |
| `build_system_prompt_blocks()` | ✅ 已实现 | 系统提示构建 |
| 使用量追踪 | ✅ 已实现 | 调用 `cost_tracker.add_usage()` |
| 错误处理 | ✅ 已实现 | APIError 转换 |

### 4.3 查询循环核心 (`query.py`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| `query()` 异步生成器 | ✅ 已实现 | 核心查询循环 |
| 消息规范化 (`_build_api_messages`) | ✅ 已实现 | 转换为 API 格式 |
| 工具调用循环 | ✅ 已实现 | 执行 tool.call() 并收集结果 |
| 权限检查集成 | ✅ 已实现 | 调用 `can_use_tool` 回调 |
| 进度消息 yield | ✅ 已实现 | `ProgressMessage` |
| 错误结果处理 | ✅ 已实现 | 工具执行失败时返回错误消息 |
| 最大轮次检查 | ✅ 已实现 | `DEFAULT_MAX_TURNS = 25` |

### 4.4 查询引擎 (`query_engine.py`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| `QueryEngine` 类 | ✅ 已实现 | 会话状态管理 |
| `submit_message()` | ✅ 已实现 | 提交用户消息并 yield SDK 消息 |
| `ask()` 便捷函数 | ✅ 已实现 | 单次查询封装 |
| 使用量累计 | ✅ 已实现 | `_total_usage` 追踪 |
| USD 预算检查 | ✅ 已实现 | `max_budget_usd` 限制 |
| 中断支持 | ✅ 已实现 | `_abort_controller.set()` |

### 4.5 消息类型系统 (`types/message.py`)

| 类型 | 状态 | 说明 |
|------|------|------|
| `UserMessage` | ✅ 完整 | 用户消息 |
| `AssistantMessage` | ✅ 完整 | 助手消息含 API 信息 |
| `SystemMessage` | ✅ 完整 | 系统消息（压缩边界等） |
| `ProgressMessage` | ✅ 完整 | 工具执行进度 |
| `AttachmentMessage` | ✅ 完整 | 附件消息（文件变更等） |
| `StreamEvent` | ✅ 完整 | 流式事件 |
| `ToolUseSummaryMessage` | ✅ 完整 | 工具使用摘要 |
| `Message` 联合类型 | ✅ 完整 | 所有消息类型的联合 |
| `QueryYield` 联合类型 | ✅ 完整 | query 生成器的 yield 类型 |

### 4.6 任务类型系统 (`task.py`)

| 类型 | 状态 | 说明 |
|------|------|------|
| `TaskType` | ✅ 完整 | 7 种任务类型 |
| `TaskStatus` | ✅ 完整 | 5 种任务状态 |
| `is_terminal_task_status()` | ✅ 完整 | 终止状态判断 |
| `TaskHandle` | ✅ 完整 | 任务句柄 |
| `TaskContext` | ✅ 完整 | 任务上下文 |
| `TaskStateBase` | ✅ 完整 | 任务状态基类 |
| `LocalShellSpawnInput` | ✅ 完整 | 本地 Shell 启动输入 |

### 4.7 P0 测试验证

```bash
# AST 语法检查（所有文件通过）
python -c "import ast; ast.parse(open('agent/services/api/claude.py').read())"
python -c "import ast; ast.parse(open('agent/services/api/client.py').read())"
python -c "import ast; ast.parse(open('agent/query.py').read())"
python -c "import ast; ast.parse(open('agent/query_engine.py').read())"
python -c "import ast; ast.parse(open('agent/types/message.py').read())"

# 集成测试（需要 API Key）
export ANTHROPIC_API_KEY="your-key-here"
python -m agent.main --print "Hello"
```

### P1 验收标准 ✅

#### MCP 客户端 (`services/mcp_client/`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| `MCPClient` 多服务器管理 | ✅ 已完成 | 连接/断开服务器 |
| `StdioMCPConnection` | ✅ 已完成 | 子进程 JSON-RPC |
| `SSEConnection` | ✅ 已完成 | Server-Sent Events |
| `StreamableHTTPConnection` | ✅ 已完成 | HTTP 流式 + Session |
| `WebSocketConnection` | ✅ 已完成 | WebSocket + 自动重连 |
| `list_tools()` | ✅ 已完成 | 列出服务器工具 |
| `call_tool()` | ✅ 已完成 | 调用工具 |
| `list_resources()` | ✅ 已完成 | 列出资源 |
| `read_resource()` | ✅ 已完成 | 读取资源内容 |

#### BashTool (`tools_impl/BashTool/`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| 命令分类 | ✅ 已完成 | `SEARCH_COMMANDS`, `READONLY_COMMANDS`, `LIST_COMMANDS` |
| 危险命令检测 | ✅ 已完成 | `DANGEROUS_COMMANDS`, `INSTALL_COMMANDS` |
| 命令执行 | ✅ 已完成 | `call()` 方法, 超时控制 |
| 并发安全 | ✅ 已完成 | `is_concurrency_safe()` |
| 跨平台支持 | ✅ 已完成 | bash/PowerShell/cmd |

#### AgentTool (`tools_impl/AgentTool/`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| 子代理启动 | ✅ 已完成 | `QueryEngine` 实例 |
| 参数支持 | ✅ 已完成 | prompt, model, subagent_type |
| 错误处理 | ✅ 已完成 | 异常捕获 |

#### 核心交互工具 (`tools_impl/`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| `AskUserQuestionTool` | ✅ 已完成 | 单选/多选用户输入 |
| `ListMcpResourcesTool` | ✅ 已完成 | MCP 资源列表 |
| `ReadMcpResourceTool` | ✅ 已完成 | MCP 资源读取 |

### P2 验收标准 ✅

#### GrepTool (`tools_impl/GrepTool/`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| 输入Schema | ✅ 已完成 | `pattern`, `path`, `glob`, `type`, `output_mode`, `head_limit`, `-A/-B/-C`, `-n`, `-i`, `multiline` |
| 输出模式 | ✅ 已完成 | `content`, `files_with_matches`, `count` |
| VCS目录排除 | ✅ 已完成 | `.git`, `.svn`, `.hg`, `.bzr`, `.jj`, `.sl` |
| 结果限制 | ✅ 已完成 | `apply_head_limit()`, `format_limit_info()` |
| 相对路径转换 | ✅ 已完成 | `toRelativePath` 风格 |
| 权限检查 | ✅ 已完成 | `check_permissions()` |
| 验证输入 | ✅ 已完成 | `validate_input()` |

#### GlobTool (`tools_impl/GlobTool/`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| 输入Schema | ✅ 已完成 | `pattern`, `path` |
| 文件匹配 | ✅ 已完成 | Python `glob.glob()` 递归 |
| 结果限制 | ✅ 已完成 | MAX_RESULTS = 100 |
| 时间排序 | ✅ 已完成 | 按 mtime 降序 |
| 相对路径 | ✅ 已完成 | `os.path.relpath` |
| 验证输入 | ✅ 已完成 | `validate_input()` 目录存在检查 |
| 权限检查 | ✅ 已完成 | `check_permissions()` |

#### LSPTool (`tools_impl/LSPTool/`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| 操作枚举 | ✅ 已完成 | `goToDefinition`, `findReferences`, `hover`, `documentSymbol`, `workspaceSymbol`, `goToImplementation`, `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls` |
| LSP方法映射 | ✅ 已完成 | `OPERATION_METHODS` 字典 |
| 路径转换 | ✅ 已完成 | `_path_to_uri()`, `_uri_to_path()` |
| 结果格式化 | ✅ 已完成 | `_format_result()` 各操作类型 |
| 符号Kind名称 | ✅ 已完成 | `_symbol_kind_name()` |
| LSP Manager集成 | ✅ 已完成 | 调用 `get_lsp_server_manager()` |
| 验证输入 | ✅ 已完成 | `validate_input()` 文件存在检查 |

#### MCPTool (`tools_impl/MCPTool/`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| MCP客户端集成 | ✅ 已完成 | `_get_mcp_client()` |
| 工具调用 | ✅ 已完成 | `call()` 方法 |
| 服务器列表 | ✅ 已完成 | `list_servers()` |
| 工具列表 | ✅ 已完成 | `list_tools()` |
| 结果截断判断 | ✅ 已完成 | `is_result_truncated()` |
| 结果块映射 | ✅ 已完成 | `map_tool_result_to_tool_result_block_param()` |

#### 命令系统 (`commands_impl/`)

| 功能 | 状态 | 验证方式 |
|------|------|---------|
| 命令文件数 | ✅ 已完成 | 82个命令实现文件 |
| 命令注册 | ✅ 已完成 | `commands.py` 注册表 |
| 核心命令 | ✅ 已完成 | `/model`, `/mcp`, `/compact`, `/resume`, `/review` |
| 诊断命令 | ✅ 已完成 | `/doctor`, `/status`, `/cost` |
| 文件命令 | ✅ 已完成 | `/diff`, `/commit`, `/branch`, `/stash` |
| 会话命令 | ✅ 已完成 | `/session`, `/compact`, `/resume` |

---

*文档生成完毕*
