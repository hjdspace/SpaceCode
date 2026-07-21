# Mobile App 内置终端与 Agent 命令执行能力设计

- **日期**：2026-07-21
- **范围**：`mobile-app/`（Flutter 手机 App）
- **不影响**：桌面端 Electron / engine

## 背景与动机

当前 `mobile-app` 的本地 Agent 是一个纯文件 I/O + HTTP 调用的"沙盒 Agent"：

- 仅 `WorkspacePlugin`（5 个文件工具）+ `SkillPlugin`（1 个技能读取工具）
- 无任何 `dart:io Process`、shell、bash、终端相关代码
- `GitHubService` 的 clone/push 走 REST API，不依赖本地 git 二进制
- 设置页的"权限模式"选项在本地 Agent 模式下**完全不生效**：`LocalAgentService.complete()` 不读取 `pref_permission_mode`，所有 Plugin 的 `beforeToolCall` 钩子都返回 `allow`

用户希望让本地 Agent 具备真正的命令执行能力，并配套提供交互式终端，使手机端从"文件沙盒 Agent"升级为"完整开发 Agent"。

## 目标与非目标

### 目标

1. Agent 通过工具调用执行 shell 命令、git 操作、Python 脚本
2. 提供用户可手动输入命令的交互式终端 UI
3. 修复 `pref_permission_mode` 在本地 Agent 模式下不生效的问题
4. 复用现有 `PermissionCard` UI，让权限询问在本地 Agent 也能工作
5. 全程 i18n 国际化

### 非目标

- 不实现真 PTY 终端（不支持 vim/top/ssh/tmux 等交互程序）
- 不实现桌面端协同执行（已确认手机端本地执行）
- 不实现 Node.js 运行时（nodejs-mobile 维护停滞，预留扩展点）
- 不实现 iOS 上 Python 嵌入（App Store 政策限制）
- 不修改桌面端 Electron / engine 代码

## 决策汇总

| 维度 | 决策 |
|---|---|
| 执行环境 | 手机本地（Android `dart:io`） |
| 命令范围 | 文件检索 + 内容处理 + Git + Python 脚本 |
| UX 形态 | Agent `run_command` 工具 + 用户交互式终端 |
| 权限模型 | 复用现有 4 种 permissionMode，仅危险命令询问 |
| 工作目录 | 固定在 `workspace.localPath` 下 |
| 终端实现 | 简化终端（`Process.run` / `Process.start`，非真 PTY） |
| 交付策略 | 一次性交付全部 4 类能力 |
| 架构方案 | 方案 A：模块化插件 + 预编译二进制 |

## § 1 总体架构

### 模块划分

```
mobile-app/lib/
├── core/agent/plugins/
│   ├── workspace_plugin.dart         [现有] 文件工具
│   ├── skill_plugin.dart             [现有] 技能读取
│   ├── shell_plugin.dart             [新增] toybox 命令执行
│   ├── git_plugin.dart               [新增] libgit2-ffi 或 git 二进制
│   └── python_plugin.dart            [新增] Chaquopy 嵌入式 CPython
│
├── core/agent/
│   ├── permission_interceptor.dart   [新增] 横切权限拦截 Plugin
│   ├── command_classifier.dart       [新增] 命令危险等级分类
│   └── binary_resolver.dart          [新增] 二进制路径解析与 PATH 管理
│
├── core/terminal/
│   ├── terminal_session.dart         [新增] Process.start 包装 + 流式输出
│   ├── terminal_history.dart         [新增] 输入历史 + 持久化
│   └── terminal_environment.dart     [新增] 环境变量构造（HOME/PATH）
│
└── features/terminal/
    ├── terminal_screen.dart          [新增] 交互式终端 UI
    └── widgets/
        ├── terminal_output.dart      [新增] 输出渲染（ANSI 解析）
        └── terminal_input.dart       [新增] 输入框 + 历史导航
```

### 依赖关系

```
ChatNotifier
  └─ LocalAgentService
      ├─ AgentSession
      │   └─ AgentToolRegistry
      │       ├─ WorkspacePlugin                [现有]
      │       ├─ SkillPlugin                    [现有]
      │       ├─ ShellPlugin                    [新增]
      │       ├─ GitPlugin                      [新增, 条件加载]
      │       ├─ PythonPlugin                   [新增, 条件加载]
      │       └─ PermissionInterceptorPlugin    [新增, 横切]
      │           └─ CommandClassifier
      │           └─ 读取 pref_permission_mode
      │
      └─ BinaryResolver（启动时初始化 PATH）

TerminalScreen [用户交互式]
  └─ TerminalSession（独立 Process.start，不走 Agent 工具链）
      └─ 复用 BinaryResolver 的 PATH 配置
```

### 关键设计决策

1. **Plugin 独立加载**：`LocalAgentService` 启动时按可用性加载 Plugin——`ShellPlugin` 总是加载；`GitPlugin` 仅当 `BinaryResolver.findGit() != null` 时加载；`PythonPlugin` 仅当 Chaquopy 初始化成功时加载。Agent 看到的工具集自动反映环境能力。

2. **终端会话与 Agent 工具分离**：交互式终端的 `TerminalSession` 是独立的 `Process.start` 调用，不经过 `AgentToolRegistry`，避免与 Agent 工具调用的批次调度、事件推送纠缠。但共享 `BinaryResolver` 配置的 PATH 和 `WorkspacePlugin` 的工作目录。

3. **权限拦截作为横切 Plugin**：`PermissionInterceptorPlugin` 不提供任何工具，只实现 `beforeToolCall` 钩子，对其他所有 Plugin 的工具调用生效。可单独单测、可独立开关。

4. **`pref_permission_mode` 真正生效**：本次设计修复。`LocalAgentService.complete()` 增加 `permissionMode` 参数，由 `ChatNotifier._runLocalAgent` 从 SharedPreferences 读出后传入。

5. **i18n 全覆盖**：所有新 UI 文案走 `I18n.t(...)`，权限模式描述从硬编码中文迁移到 i18n 资源文件（顺带修现有 i18n 违规）。

## § 2 工具 Schema 设计

### ShellPlugin（toybox 命令执行）

提供一个通用 `run_command` 工具，覆盖 `ls`/`cat`/`grep`/`find`/`awk`/`sed`/`wc`/`sort`/`uniq`/`head`/`tail`/`diff`/`tree`/`du`/`stat` 等所有 toybox 自带命令。

```json
{
  "name": "run_command",
  "description": "在 workspace 目录下执行 shell 命令。可用命令包括 ls/cat/grep/find/awk/sed/wc/sort/uniq/head/tail/diff/tree/du/stat 等。禁止使用 rm -rf、sudo、chmod 777 等危险操作。",
  "inputSchema": {
    "type": "object",
    "properties": {
      "command": { "type": "string", "description": "完整的 shell 命令行" },
      "timeout_ms": { "type": "integer", "description": "超时毫秒，默认 30000，最大 120000", "default": 30000 }
    },
    "required": ["command"]
  }
}
```

**执行**：`Process.run('sh', ['-c', command], workingDirectory: workspace.localPath, environment: env, runInShell: false)`

**返回结构化结果**（非裸 stdout）：

```json
{
  "exit_code": 0,
  "stdout": "...",
  "stderr": "...",
  "duration_ms": 123,
  "truncated": false
}
```

**截断策略**：stdout/stderr 各最大 50KB，超出尾部截断并置 `truncated: true`。

**执行模式**：`sequential`（避免并行 sh 互相干扰）

### GitPlugin（结构化 Git 工具）

不用 `run_command('git xxx')`，而是拆分为结构化工具。**实现路径**：先尝试 libgit2 FFI 绑定（覆盖 11 个工具的核心 API）；FFI 绑定无法覆盖的工具（如 `git_reset --hard`）降级为调用预编译 git 二进制（通过 `BinaryResolver.gitPath`）。两条路径在 `GitPlugin` 内部按工具粒度切换，对外接口统一。

| 工具名 | 输入 | 输出 | 危险等级 |
|---|---|---|---|
| `git_status` | `{ path?: string }` | `{ staged: [], modified: [], untracked: [], ahead: N, behind: N }` | read |
| `git_log` | `{ limit?: int=20, path?: string }` | `[{hash, author, date, message}]` | read |
| `git_diff` | `{ staged?: bool=false, path?: string }` | `{ files: [{path, additions, deletions, patch}] }` | read |
| `git_branch_list` | `{ remote?: bool=false }` | `[{name, current, remote}]` | read |
| `git_show` | `{ ref: string }` | `{ commit, files, diff }` | read |
| `git_add` | `{ paths: string[] }` | `{ added: N }` | write |
| `git_commit` | `{ message: string }` | `{ hash, summary }` | write |
| `git_branch_create` | `{ name, from?: string }` | `{ name }` | write |
| `git_branch_switch` | `{ name }` | `{ name }` | write |
| `git_push` | `{ remote?: string="origin", force?: bool=false }` | `{ remote, ref, success }` | dangerous |
| `git_pull` | `{ remote?: string="origin" }` | `{ updated, conflicts }` | dangerous |
| `git_reset` | `{ ref, mode?: "soft"\|"mixed"\|"hard" }` | `{ ref, mode }` | dangerous |

**说明**：

- 不暴露 `git checkout -- <file>`、`git clean -fd`、`git rebase` 等高风险操作，引导用户走桌面端
- `git_push --force`、`git_reset --hard` 由 `PermissionInterceptorPlugin` 强制询问
- 复用 `WorkspacePlugin.safePath()` 校验所有 `path` 参数

### PythonPlugin（嵌入式 CPython via Chaquopy）

| 工具名 | 输入 | 输出 | 危险等级 |
|---|---|---|---|
| `run_python` | `{ code: string, args?: string[], stdin?: string, timeout_ms?: int=30000 }` | `{ exit_code, stdout, stderr, duration_ms }` | write |
| `run_python_file` | `{ path: string, args?: string[], stdin?: string, timeout_ms?: int=30000 }` | `{ exit_code, stdout, stderr, duration_ms }` | write |

**实现**：通过 MethodChannel 调用 Android 端 Chaquopy 的 `Python.getInstance().getModule(...).callAttr(...)`，把代码写入临时 `.py` 文件后执行，捕获 stdout/stderr/exit_code。

**约束**：

- `code` 最大 100KB
- 默认禁用 `subprocess`、`os.system`、`os.popen`、`socket`、`ctypes`、`multiprocessing`（通过 Chaquopy 的 import hook 拦截，防止 Python 反向逃逸出沙盒）
- 网络访问默认禁用，可在设置中开启

### PermissionInterceptorPlugin（横切权限拦截）

不提供工具，只实现 `beforeToolCall`：

```dart
class PermissionInterceptorPlugin extends AgentPlugin {
  @override
  Future<AgentToolDecision> beforeToolCall({
    required String toolName,
    required Map<String, dynamic> arguments,
    required String permissionMode,
  }) async {
    final dangerLevel = CommandClassifier.classify(toolName, arguments);
    
    switch (permissionMode) {
      case 'plan':
        return dangerLevel == 'read'
            ? AgentToolDecision.allow()
            : AgentToolDecision.deny('Plan 模式下禁止任何写/危险操作');
      
      case 'acceptEdits':
        return dangerLevel == 'dangerous'
            ? await _askUser(toolName, arguments)
            : AgentToolDecision.allow();
      
      case 'bypassPermissions':
        return AgentToolDecision.allow();
      
      case 'default':
      default:
        return dangerLevel == 'read'
            ? AgentToolDecision.allow()
            : await _askUser(toolName, arguments);
    }
  }
}
```

### 工具总数与 Agent 上下文开销

新增工具 14 个（`run_command` ×1 + git ×11 + python ×2），加上现有 7 个共 21 个工具 schema。OpenAI Function Calling 对工具数量没有硬上限，但过多会稀释 LLM 注意力、增加 token 成本。

**优化策略**：

- `GitPlugin` 仅在 git 可用时加载（条件加载）
- `PythonPlugin` 仅在 Chaquopy 可用时加载（条件加载）
- 系统提示词中明确指引优先使用结构化工具（如 "use git_status instead of run_command('git status')"）

## § 3 权限模型与命令分类细节

### `pref_permission_mode` 真正生效

**修改 `LocalAgentService.complete()` 签名**：

```dart
Future<String> complete({
  required String sessionId,
  required MobileConfig config,
  required String prompt,
  required String permissionMode,        // 新增
  WorkspaceTarget? workspace,
  List<AgentMessage> history = const [],
  required AgentCancellationToken cancellationToken,
  required void Function(AgentEvent) onEvent,
  required void Function(PermissionRequest) onPermissionRequest,  // 新增
  SkillRegistryState? skillRegistry,
})
```

**修改 `ChatNotifier._runLocalAgent`**：从 `MobilePreferences.getPermissionMode()` 读取并传入；监听 `onPermissionRequest` 回调，把请求加入 `state.pendingPermissions`；用户响应后通过 `Completer` 解锁。

### `CommandClassifier` 完整规则

```dart
enum DangerLevel { read, write, dangerous }

class CommandClassifier {
  static DangerLevel classify(String toolName, Map<String, dynamic> args) {
    // 1. 结构化工具直接查表
    if (_toolDangerTable.containsKey(toolName)) {
      return _toolDangerTable[toolName]!;
    }
    // 2. run_command 走命令解析
    if (toolName == 'run_command') {
      return _classifyShell(args['command'] as String? ?? '');
    }
    return DangerLevel.write; // 未知工具保守判定
  }
  
  static const _toolDangerTable = {
    // 现有工具
    'list_files': DangerLevel.read,
    'read_file': DangerLevel.read,
    'grep_files': DangerLevel.read,
    'read_skill': DangerLevel.read,
    'write_file': DangerLevel.write,
    'edit_file': DangerLevel.write,
    // Git 读
    'git_status': DangerLevel.read,
    'git_log': DangerLevel.read,
    'git_diff': DangerLevel.read,
    'git_branch_list': DangerLevel.read,
    'git_show': DangerLevel.read,
    // Git 写
    'git_add': DangerLevel.write,
    'git_commit': DangerLevel.write,
    'git_branch_create': DangerLevel.write,
    'git_branch_switch': DangerLevel.write,
    // Git 危险
    'git_push': DangerLevel.dangerous,
    'git_pull': DangerLevel.dangerous,
    'git_reset': DangerLevel.dangerous,
    // Python
    'run_python': DangerLevel.write,
    'run_python_file': DangerLevel.write,
  };
  
  static DangerLevel _classifyShell(String command) {
    final trimmed = command.trim();
    final firstToken = trimmed.split(RegExp(r'\s')).first;
    
    // 危险模式（任一命中即 dangerous）
    if (RegExp(r'rm\s+-rf\s+/').hasMatch(trimmed) ||
        RegExp(r'\bsudo\b').hasMatch(trimmed) ||
        trimmed.contains('>/dev/') ||
        trimmed.contains('\$((') ||
        trimmed.contains('`') ||
        RegExp(r'\bcurl\b|\bwget\b').hasMatch(trimmed) ||
        RegExp(r'\bdd\s+if=').hasMatch(trimmed) ||
        RegExp(r'\bmkfs\b').hasMatch(trimmed)) {
      return DangerLevel.dangerous;
    }
    
    // 读命令白名单
    const reads = {'ls','cat','grep','find','wc','sort','uniq','head','tail',
                   'diff','tree','du','stat','file','which','echo','pwd','env'};
    if (reads.contains(firstToken)) return DangerLevel.read;
    
    // 写命令
    const writes = {'rm','mv','cp','chmod','chown','tar','zip','unzip',
                    'mkdir','touch','ln','rsync','tee'};
    if (writes.contains(firstToken)) return DangerLevel.write;
    
    // 默认保守
    return DangerLevel.write;
  }
}
```

### 权限询问异步流程

```
Agent 工具调用 → beforeToolCall → 危险等级 = dangerous/write + mode=default
  ↓
抛 PermissionRequestedException(reqId, toolName, args)
  ↓
AgentSession._executeToolBatch 捕获 → onEvent(PermissionRequest)
  ↓
ChatNotifier 加入 pendingPermissions → UI 渲染 PermissionCard
  ↓
用户点允许/拒绝 → ChatNotifier.allowPermission(reqId)
  ↓
通过 _pendingCompleters[reqId].complete(decision) 解锁
  ↓
AgentSession 继续 _executeToolBatch
```

**超时**：权限请求默认 5 分钟超时，超时视为 deny。

**取消**：会话取消时所有 pending completer 完成 `deny('cancelled')`。

## § 4 二进制捆绑与 PATH 管理

### `BinaryResolver` 启动时初始化

```dart
class BinaryResolver {
  static final BinaryResolver instance = BinaryResolver._();
  BinaryResolver._();
  
  late String _homeDir;        // App 专属存储
  late String _binDir;          // 解压后的二进制目录
  late Map<String, String> _env;  // 完整环境变量
  
  String? _gitPath;
  bool _pythonReady = false;
  
  Future<void> initialize() async {
    final docs = await pathProvider.getApplicationDocumentsDirectory();
    _homeDir = '${docs.path}/spacecode/home';
    _binDir = '${docs.path}/spacecode/bin';
    Directory(_homeDir).createSync(recursive: true);
    Directory(_binDir).createSync(recursive: true);
    
    _gitPath = await _extractGitBinary();
    _pythonReady = await _initializePython();
    
    _env = _buildEnvironment();
  }
  
  Map<String, String> _buildEnvironment() {
    final sysEnv = Platform.environment;
    final pathParts = [
      _binDir,
      '/system/bin',
      '/system/xbin',
      '/vendor/bin',
      if (_gitPath != null) dirname(_gitPath!),
    ];
    return {
      ...sysEnv,
      'PATH': pathParts.join(':'),
      'HOME': _homeDir,
      'TERM': 'dumb',
      'LANG': 'en_US.UTF-8',
      'GIT_CONFIG_NOSYSTEM': '1',
      'GIT_AUTHOR_NAME': 'SpaceCode Mobile',
      'GIT_AUTHOR_EMAIL': 'mobile@spacecode.local',
      'GIT_COMMITTER_NAME': 'SpaceCode Mobile',
      'GIT_COMMITTER_EMAIL': 'mobile@spacecode.local',
    };
  }
  
  String? get gitPath => _gitPath;
  bool get pythonReady => _pythonReady;
  Map<String, String> get environment => _env;
}
```

### Git 二进制捆绑

- **来源**：Termux build（`com.termux` 仓库的 git package），剥离 docs/man，仅保留 `git` 主二进制 + 必要的 perl 脚本（如 `git-send-email` 可省略）
- **ABI 分包**：分别打包 `arm64-v8a`、`armeabi-v7a`、`x86_64` 三种架构的 git 到 `assets/binaries/<abi>/git`，启动时按 `Platform.operatingSystemArchitecture` 选择解压
- **体积**：约 5MB/ABI，使用 APK Split 或 AAB 自动分发
- **校验**：解压后做 SHA-256 校验，匹配预存哈希
- **权限**：解压后 `chmod 0700`
- **降级**：若解压或校验失败，`GitPlugin` 不加载，Agent 看不到 git 工具

### Python via Chaquopy

- **集成方式**：Android 端 Gradle 添加 `com.chaquo.python:python:3.11` 依赖，Flutter 通过 MethodChannel 调用
- **平台限制**：仅 Android（iOS 因 App Store 政策禁止 JIT/解释器嵌入，PythonPlugin 在 iOS 上不加载）
- **资源**：Python stdlib 由 Chaquopy 自动打包；pip 包可在 `chaquopy.config` 中声明（仅允许纯 Python 包，避免 C 扩展编译问题）
- **初始化**：App 启动时在 `MainActivity` 中调用 `Python.start(AndroidPlatform(this))`，失败则 `_pythonReady = false`
- **桥接**：`PythonPlugin` 通过 `MethodChannel('spacecode/python')` 调用：
  - `runCode(code, args, stdin, timeoutMs)` → `{exitCode, stdout, stderr}`
  - `runFile(path, args, stdin, timeoutMs)` → 同上
- **沙盒约束**：
  - Chaquopy 启动时注入 sitecustomize.py，覆盖 `__import__`，禁用 `subprocess`、`os.system`、`os.popen`、`socket`、`ctypes`、`multiprocessing`
  - 网络访问默认关闭，通过设置项 `pref_python_network` 控制
  - 文件访问限定在 `workspace.localPath` + `HOME` 目录

### Node.js（暂不实现，预留扩展点）

nodejs-mobile 项目近一年维护停滞、与 Flutter 集成有坑，本次范围不包含。`NodePlugin` 类预留空实现，后续可作为独立 Plugin 接入。

## § 5 交互式终端 UI

### `TerminalSession`（独立于 Agent 工具链）

```dart
class TerminalSession {
  final String workingDirectory;
  final Map<String, String> environment;
  
  Process? _process;
  final _outputController = StreamController<TerminalOutput>.broadcast();
  final _completer = Completer<int>();
  
  Stream<TerminalOutput> get output => _outputController.stream;
  Future<int> get exitCode => _completer.future;
  bool get isRunning => _process != null;
  
  Future<void> execute(String command) async {
    final sw = Stopwatch()..start();
    _process = await Process.start(
      'sh', ['-c', command],
      workingDirectory: workingDirectory,
      environment: environment,
      runInShell: false,
    );
    
    // 流式合并 stdout + stderr
    final stdoutSub = _process!.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen((line) => _outputController.add(TerminalOutput.stdout(line)));
    final stderrSub = _process!.stderr
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen((line) => _outputController.add(TerminalOutput.stderr(line)));
    
    final exitCode = await _process!.exit;
    sw.stop();
    await stdoutSub.cancel();
    await stderrSub.cancel();
    _outputController.add(TerminalOutput.exit(exitCode, sw.elapsedMilliseconds));
    _completer.complete(exitCode);
  }
  
  Future<void> interrupt() async {
    _process?.kill(ProcessSignal.sigint);
  }
  
  Future<void> dispose() async {
    await _process?.kill();
    await _outputController.close();
  }
}
```

### `TerminalScreen` UI 结构

```
AppBar
  ├─ 标题：当前 workspace basename
  ├─ 动作：清屏 / 历史记录 / 关闭会话
  └─ 连接状态指示器（仅展示）

终端输出区（可滚动 ListView）
  ├─ 普通行：等宽字体，深色背景
  ├─ stdout：默认色
  ├─ stderr：红色
  ├─ 命令提示行：'$ <command>' 灰色斜体
  └─ 退出码行：'[exit N, 123ms]' 灰色小字

输入区（底部固定）
  ├─ TextField：'$' 提示符 + 文本输入
  ├─ 历史导航：上/下键切换
  ├─ Ctrl+C 按钮：中断当前命令
  └─ 提交按钮：执行命令
```

### 历史记录

- 存储到 SharedPreferences key `pref_terminal_history`，JSON 数组，最多保留 100 条
- 每条记录：`{ command, timestamp, exitCode }`（不存输出，避免体积爆炸）
- 输入框上键加载上一条，下键加载下一条，匹配前缀过滤

### 终端与 Agent 协同

- 用户手动执行的命令**不会**自动注入到 Agent 上下文（避免污染）
- 提供"发送给 Agent"按钮：把当前命令 + 输出摘要作为 user message 发到当前 chat session
- Agent 通过 `run_command` 工具执行的命令**不会**显示在交互式终端界面（避免 UI 混乱），仅在 ToolCallCard 中展示

### 路由

- 在 `routing/router.dart` 添加 `/terminal` 路由
- 入口：底部导航栏新增"终端"tab，或在 chat 页 AppBar 添加终端图标
- 离开页面时若有运行中命令，弹确认对话框

## § 6 错误处理与边界

### 命令执行错误分类

| 错误类型 | 触发条件 | 处理策略 |
|---|---|---|
| `CommandTimeoutException` | 超过 `timeout_ms` | kill 进程，返回 `{exit_code: -1, stderr: 'Command timed out after Nms', killed: true}` |
| `BinaryNotFoundException` | git/python 二进制缺失 | 工具不加载，LLM 看不到对应 schema |
| `WorkspaceNotSetException` | `workspace.localPath == null` | 工具返回 `{error: 'No workspace selected'}`，提示用户先选 workspace |
| `PathEscapeException` | 路径参数逃逸 workspace | 工具返回 `{error: 'Path outside workspace'}` |
| `PermissionDeniedException` | 用户拒绝权限请求 | 工具返回 `{error: 'Permission denied by user'}`，LLM 据此调整策略 |
| `PythonImportBlockedError` | 代码尝试 import 受限模块 | Python 执行返回 `{exit_code: 1, stderr: 'ImportError: module X is blocked'}` |
| `ProcessStartException` | 二进制无法执行（权限/ABI 不匹配） | 返回 `{error: 'Failed to start: ...'}`，记日志，下次启动重新解压二进制 |

### 工具结果统一格式

所有新工具返回字符串内容（与现有 `write_file` 等保持一致，OpenAI Function Calling 要求 tool result 是字符串）：

```json
// 成功
{
  "exit_code": 0,
  "stdout": "...",
  "stderr": "",
  "duration_ms": 123,
  "truncated": false
}
// JSON 字符串化后作为 tool result content

// 失败（isError: true）
{
  "error": "Command timed out after 30000ms",
  "exit_code": -1,
  "partial_stdout": "..."
}
```

### 输出截断策略

- 单字段（stdout/stderr）超过 50KB：尾部截断，前缀 `[truncated, original size: NKB]\n`
- 总输出（stdout + stderr）超过 100KB：双向截断，保留头尾各 25KB，中间 `[... NKB omitted ...]`
- 工具结果 content 总长度上限 200KB（避免撑爆 LLM 上下文）

### 取消与超时

- `AgentCancellationToken` 触发时：`Process.kill(ProcessSignal.sigkill)`，返回 partial 输出
- 终端 UI 退出时：若有运行中命令，弹"命令运行中，是否中止？"确认
- App 切到后台：终端命令继续运行（Android 后台限制），但禁止启动新命令

### 二进制完整性

- 首次启动解压后，记录 SHA-256 到 `pref_binary_hashes` JSON
- 每次启动校验哈希，不匹配则重新解压
- 解压失败 3 次后禁用对应 Plugin，UI 提示用户重启 App

## § 7 测试策略

### 单元测试（`test/`）

**`command_classifier_test.dart`**（核心）

- `classify('run_command', {'command': 'ls -la'})` → `read`
- `classify('run_command', {'command': 'rm -rf /'})` → `dangerous`
- `classify('run_command', {'command': 'sudo apt install'})` → `dangerous`
- `classify('run_command', {'command': 'git status'})` → `write`（未识别首词，保守判定）
- `classify('git_push', {})` → `dangerous`
- `classify('git_status', {})` → `read`
- `classify('unknown_tool', {})` → `write`

**`binary_resolver_test.dart`**

- mock pathProvider，验证 `_binDir` 创建
- mock assets，验证 git 二进制正确解压到 `_binDir`
- 哈希不匹配时重新解压

**`shell_plugin_test.dart`**

- mock `Process.run`，验证 `run_command` 工具的参数解析、超时、退出码处理
- 验证 stdout/stderr 截断逻辑

**`git_plugin_test.dart`**

- 用 fixture 测试 repo（`test/fixtures/sample-repo/`），跑 `git_status`、`git_log`、`git_diff`
- 验证 JSON 输出结构
- `git_commit` 在 read-only 目录下失败处理

**`permission_interceptor_test.dart`**

- mode=default + read → allow
- mode=default + dangerous → throw PermissionRequestedException
- mode=plan + write → deny
- mode=acceptEdits + dangerous → throw
- mode=bypassPermissions + dangerous → allow

**`terminal_session_test.dart`**

- 验证 stdout/stderr/exit 流式输出顺序
- 验证 interrupt 后 exitCode = 130
- 验证 dispose 后无内存泄漏

### Widget 测试

**`terminal_screen_test.dart`**

- 输入 `echo hello` → 输出区显示 `hello`
- 上键加载历史
- Ctrl+C 按钮中断运行中命令

**`permission_card_test.dart`**（扩展现有）

- 本地 Agent 触发权限请求 → 卡片显示
- 允许/拒绝按钮回调

### 集成测试（`integration_test/`）

**`local_agent_command_execution_test.dart`**

- 用 mock LLM 返回固定 tool_calls
- 跑通：用户提问 → Agent 调用 `run_command('ls')` → 权限询问（mode=default）→ 用户允许 → 工具执行 → 结果回填 → Agent 总结

### 测试不覆盖

- 真实 git 二进制功能验证（依赖 ABI，CI 跑不了 Android）
- Chaquopy 集成（需 Android Instrumentation Test，在真机上跑）
- 这些通过手动测试 checklist 验证

## § 8 风险与回退

| 风险 | 影响 | 缓解 |
|---|---|---|
| Chaquopy 与 Flutter 构建冲突 | App 无法编译 | 早期 spike 验证；若失败则降级到"PythonPlugin 不加载"，先交付其他能力 |
| libgit2 FFI 绑定工作量爆炸 | Git 工具交付延期 | FFI 绑定按工具粒度推进，单工具 FFI 实现受阻时该工具立即降级到 git 二进制调用，不阻塞整体进度 |
| git 二进制在 Android 沙盒中失败 | Git 工具不可用 | 启动时跑 `git --version` 探测，失败则不加载 GitPlugin |
| APK 体积膨胀（+55MB） | 用户下载意愿下降 | 用 AAB + ABI split，单架构 APK 增量约 35MB；Play Store 自动分发 |
| Android 13+ 后台执行限制 | 长命令被系统 kill | UI 显式提示"前台运行"；超时上限 120s |
| toybox 命令行为差异（Android 版本） | 部分命令不可用 | 启动时探测可用命令列表，注入系统提示词告知 LLM |
| LLM 调用危险命令频繁 | 体验差 | 默认 mode=default；CommandClassifier 保守判定；系统提示词强调避免危险操作 |

### 回退路径

若 Phase 1 验证后 Chaquopy 集成不顺利，可独立交付"toybox + git"两期能力（对应原方案 B 的范围），Python 能力后续单独迭代。Git 工具若 FFI 路线受阻，可降级为调用 git 二进制（性能略差但能工作）。

## 实现顺序建议

虽然本设计是"一次性交付"，但实现顺序仍按依赖关系推进，便于增量验证：

1. **基础设施**：`BinaryResolver`、`CommandClassifier`、`PermissionInterceptorPlugin` 框架（不接具体工具）
2. **权限模型修复**：让 `pref_permission_mode` 在本地 Agent 真正生效（不依赖新工具，可独立验证）
3. **ShellPlugin**：最简单、依赖最少，先打通 Agent 执行链路
4. **TerminalScreen**：独立的交互式终端 UI，复用 `BinaryResolver` 的 PATH
5. **GitPlugin**：libgit2 FFI 绑定 + git 二进制捆绑，依赖 `BinaryResolver` 就绪
6. **PythonPlugin**：Chaquopy 集成 + 沙盒约束，工作量最大、风险最高，最后做

## 附录：i18n 资源键

新增的 i18n 键（中英双语，位于 `lib/core/i18n/locales/{en,zh}.json`）：

- `terminal.title` / `terminal.inputHint` / `terminal.clear` / `terminal.history` / `terminal.interrupt`
- `terminal.confirmInterrupt` / `terminal.sendToAgent`
- `permission.mode.default` / `permission.mode.plan` / `permission.mode.acceptEdits` / `permission.mode.bypassPermissions`
- `permission.mode.description.default` / `.plan` / `.acceptEdits` / `.bypassPermissions`
- `permission.request.title` / `permission.request.allow` / `permission.request.deny` / `permission.request.timeout`
- `python.networkBlocked` / `python.importBlocked`
- `binary.extractFailed` / `binary.hashMismatch`
