# 手机端真 git clone 双路径设计

> 日期: 2026-07-23
> 范围: `mobile-app/`
> 上游: 上一次会话已实现 Termux bridge(commit `d95512ada`),但 `cloneRepository` 走的是 GitHub zipball API,解压后无 `.git` 目录,导致无法执行任何 git 命令。

## 1. 背景与问题

[github_service.dart#L177-L293](file:///d:/AI/SpaceCode/mobile-app/lib/core/github/github_service.dart) 的 `cloneRepository` 调用 `/repos/{owner}/{repo}/zipball/{ref}` 下载源代码归档,用 `ZipDecoder` 解压到目标目录。GitHub zipball 设计上只包含工作树快照,**不含 `.git` 元数据目录**。结果:clone 后的目录不是 git 仓库,`git status` / `git pull` / `git commit` 全部失败。

用户场景正是要在手机上执行 git 命令,因此 zipball 路径无法满足需求。

## 2. 目标

- **主路径**:Termux 就绪时,通过 Termux 执行真正的 `git clone`,产出完整 git 仓库(含 `.git`),后续 pull/push 可用
- **降级路径**:Termux 未就绪时,提供二选一弹窗 —— 引导安装 Termux,或显式选择「仅下载源码包(无 git 支持)」并明确告知后果
- **Termux 引导 UI**:设置页新增「Termux 环境」卡片,引导用户完成 Termux 安装 + git 安装 + 共享存储授权
- **认证**:clone 用 URL 嵌 token,完成后 `git remote set-url` 去掉明文 token;后续 pull/push 通过临时 credential helper 注入,token 不持久化到 `.git/config`
- **进度反馈**:git clone 期间的 `--progress` 输出通过 EventChannel 流式推送到 UI,显示「Receiving objects: 45%」式进度

## 3. 用户决策记录

| # | 问题 | 决策 |
|---|------|------|
| 1 | Termux 未就绪时的交互 | 二选一弹窗:安装 Termux / 仅下载源码包 |
| 2 | 就绪检测粒度 | Termux 安装 + `git --version` 探测(三态:notInstalled / installedNoGit / ready) |
| 3 | clone 目标目录策略 | 用户选目录 + Termux 共享存储授权(`termux-setup-storage`) |
| 4 | 进度反馈方案 | 流式进度(改 Android 端 EventChannel) |
| 5 | git 认证策略 | URL 嵌 token + 临时 credential helper(token 不持久化) |

## 4. 架构总览

### 4.1 模块清单

**新增**
- `lib/core/agent/termux_readiness_checker.dart` — Termux 就绪三态检测
- `lib/core/github/git_clone_service.dart` — git clone via Termux,解析 `--progress` 输出
- Android 端 `TermuxStreamBridge.kt` — EventChannel `spacecode/termux/stream`,逐行推送 stdout/stderr/exit

**改造**
- `lib/core/agent/termux_bridge.dart` — 新增 `runCommandStream()` 返回 `Stream<TermuxStreamEvent>`,保留原 `runCommand` 不动
- `lib/core/agent/binary_resolver.dart` — `markTermuxReady()` 扩展为 `setTermuxReadiness(TermuxReadiness)`,暴露 `termuxReadiness` getter
- `lib/core/github/clone_notifier.dart` — `startClone` 增加 `useTermux` 参数,分流到 `GitCloneService` 或现有 zipball
- `lib/core/agent/plugins/git_plugin.dart` — `defaultGitExecutor` 对 `pull/push/fetch` 注入临时 credential helper;token 通过环境变量 `SPACECODE_GITHUB_TOKEN` 传入
- `lib/features/settings/settings_screen.dart` — 新增「Termux 环境」卡片 + `_cloneGithubRepository` 前置二选一弹窗

**复用**
- `CloneProgress` / `ClonePhase` 完全复用,`GitCloneService` 同样产出 downloading/extracting/done/error 流,`_CloneTaskCard` UI 零改动

### 4.2 数据流

```
_cloneGithubRepository()
  → TermuxReadinessChecker.check()
  → ready?
      是 → CloneNotifier.startClone(useTermux: true)
           → GitCloneService.cloneViaTermux
              → TermuxBridge.runCommandStream(['clone', '--progress', url-with-token, target])
              → 解析 stdout 行 → CloneProgress(downloading, percent)
              → 完成后 runCommand(['remote', 'set-url', 'origin', url-without-token])
              → CloneProgress(done, resultPath)
      否 → 二选一弹窗
           → 用户选「仅下载源码包」
              → CloneNotifier.startClone(useTermux: false) → 现有 zipball 路径
           → 用户选「安装 Termux」
              → 滚动到「Termux 环境」卡片
```

## 5. 详细设计

### 5.1 TermuxReadinessChecker

```dart
// lib/core/agent/termux_readiness_checker.dart

/// Termux 就绪状态。
enum TermuxReadiness {
  /// 未安装 Termux
  notInstalled,
  /// 已安装 Termux 但 git 不可用(未 pkg install git 或未配置 allow-external-apps)
  installedNoGit,
  /// 完全就绪:Termux 已安装 + git 可执行
  ready,
}

class TermuxReadinessChecker {
  static Future<TermuxReadiness> check() async {
    if (!await TermuxBridge.instance.checkInstalled()) {
      return TermuxReadiness.notInstalled;
    }
    try {
      final result = await TermuxBridge.instance.runGit(
        args: ['--version'],
        timeoutMs: 5000,
      );
      if (result.exitCode == 0 && result.stdout.contains('git version')) {
        return TermuxReadiness.ready;
      }
      return TermuxReadiness.installedNoGit;
    } on PlatformException {
      // START_FAILED 通常意味着 allow-external-apps 未配置
      return TermuxReadiness.installedNoGit;
    }
  }
}
```

**设计要点**
- `checkInstalled()` 复用现有逻辑(检测包名)
- `git --version` 一次调用同时验证「allow-external-apps 已配置」+「git 已安装」+「PATH 正确」三项
- `START_FAILED` PlatformException 归类为 `installedNoGit`(实际是未配置 allow-external-apps,但用户感知是"Termux 装了但用不了"),引导 UI 会同时提示这两项
- 非阻塞:5 秒超时,失败优雅降级

### 5.2 TermuxBridge.runCommandStream

```dart
// lib/core/agent/termux_bridge.dart 新增

/// 流式命令事件。
class TermuxStreamEvent {
  final TermuxStreamEventType type;
  final String data;
  const TermuxStreamEvent({required this.type, required this.data});
}

enum TermuxStreamEventType { stdout, stderr, exit, error }

/// 流式执行命令。
///
/// 通过 EventChannel `spacecode/termux/stream` 逐行推送 stdout/stderr,
/// 命令结束时推送 exit 事件(data 为退出码字符串),失败时推送 error 事件。
/// [cancellationToken] 可用于中止(发送 cancel 到 Android 端)。
Stream<TermuxStreamEvent> runCommandStream({
  required String command,
  List<String> args = const [],
  String? workdir,
  CancelToken? cancellationToken,
}) async* {
  if (!Platform.isAndroid) {
    throw PlatformException(
      code: 'NOT_ANDROID',
      message: 'Termux bridge is only available on Android',
    );
  }
  // EventChannel 每个 stream 独立实例,避免多命令串扰
  final channel = EventChannel('spacecode/termux/stream');
  final argsJson = jsonEncode({
    'command': command,
    'args': args,
    'workdir': workdir,
    'sessionId': cancellationToken?.sessionId,
  });
  await for (final event on channel.receiveBroadcastStream(argsJson)) {
    final map = event as Map;
    final type = TermuxStreamEventType.values.firstWhere(
      (e) => e.name == map['type'],
      orElse: () => TermuxStreamEventType.error,
    );
    yield TermuxStreamEvent(type: type, data: map['data'] as String? ?? '');
    if (type == TermuxStreamEventType.exit || type == TermuxStreamEventType.error) {
      break;
    }
  }
}

class CancelToken {
  final String sessionId;
  CancelToken() : sessionId = const Uuid().v4();
}
```

**设计要点**
- 每次调用创建独立 EventChannel(用 sessionId 区分),Android 端用 sessionId 索引 Termux 进程
- 取消机制:发送 `cancel` MethodChannel 调用带 sessionId,Android 端 destroy 对应进程
- 保留原 `runCommand()` 不动 —— `GitPlugin` / `ShellPlugin` 的非流式场景继续用它,避免回归

### 5.3 GitCloneService

```dart
// lib/core/github/git_clone_service.dart

class GitCloneService {
  final String token;

  GitCloneService({required this.token});

  /// 通过 Termux 执行真 git clone,流式推送进度。
  Stream<CloneProgress> cloneViaTermux({
    required String repository, // owner/repo
    required String branch,
    required String targetDirectory,
    CancelToken? cancellationToken,
  }) async* {
    // 1. 准备目标目录(空目录)
    final target = Directory(targetDirectory);
    if (await target.exists()) {
      await target.delete(recursive: true);
    }
    await target.create(recursive: true);

    // 2. URL 嵌 token 的 clone URL
    //    https://x-access-token:<token>@github.com/owner/repo.git
    final cloneUrl = 'https://x-access-token:$token@github.com/$repository.git';

    // 3. 执行 git clone --progress --branch <branch> --single-branch <url> <target>
    yield CloneProgress(
      phase: ClonePhase.downloading,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: 0,
    );

    var exitCode = -1;
    var lastStderr = '';
    await for (final event in TermuxBridge.instance.runCommandStream(
      command: 'git',
      args: [
        'clone',
        '--progress',
        '--branch', branch,
        '--single-branch',
        cloneUrl,
        targetDirectory,
      ],
      cancellationToken: cancellationToken,
    )) {
      if (event.type == TermuxStreamEventType.exit) {
        exitCode = int.tryParse(event.data) ?? -1;
      } else if (event.type == TermuxStreamEventType.stderr) {
        // git clone --progress 进度走 stderr
        lastStderr = event.data;
        final progress = _parseGitProgress(event.data);
        if (progress != null) yield progress;
      } else if (event.type == TermuxStreamEventType.error) {
        yield CloneProgress(
          phase: ClonePhase.error,
          receivedBytes: 0,
          totalBytes: null,
          processedFiles: 0,
          errorMessage: event.data,
        );
        return;
      }
    }

    if (exitCode != 0) {
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: 0,
        totalBytes: null,
        processedFiles: 0,
        errorMessage: 'git clone 失败 (exit $exitCode): $lastStderr',
      );
      return;
    }

    // 4. 去掉 remote URL 中的 token
    final cleanUrl = 'https://github.com/$repository.git';
    await TermuxBridge.instance.runGit(
      args: ['remote', 'set-url', 'origin', cleanUrl],
      workdir: targetDirectory,
    );

    yield CloneProgress(
      phase: ClonePhase.extracting,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: 0,
      totalFiles: null,
    );

    // 5. 统计文件数用于最终进度
    final countResult = await TermuxBridge.instance.runGit(
      args: ['ls-files'],
      workdir: targetDirectory,
    );
    final fileCount = countResult.stdout
        .split('\n')
        .where((l) => l.isNotEmpty)
        .length;

    yield CloneProgress(
      phase: ClonePhase.done,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: fileCount,
      totalFiles: fileCount,
      resultPath: targetDirectory,
    );
  }

  /// 解析 git --progress 输出行。
  /// 典型格式:
  ///   "Receiving objects:  45% (450/1000)"
  ///   "Receiving objects: 100% (1000/1000), 1.20 MiB | 2.30 MiB/s, done."
  ///   "Resolving deltas:   3% (30/1000)"
  CloneProgress? _parseGitProgress(String line) {
    final match = RegExp(r'Receiving objects:\s+(\d+)%\s+\((\d+)/(\d+)\)').firstMatch(line);
    if (match != null) {
      return CloneProgress(
        phase: ClonePhase.downloading,
        receivedBytes: int.parse(match.group(2)!),
        totalBytes: int.parse(match.group(3)!),
        processedFiles: 0,
      );
    }
    // Resolving deltas 阶段映射为 extracting
    final deltaMatch = RegExp(r'Resolving deltas:\s+(\d+)%').firstMatch(line);
    if (deltaMatch != null) {
      return CloneProgress(
        phase: ClonePhase.extracting,
        receivedBytes: 0,
        totalBytes: null,
        processedFiles: int.parse(deltaMatch.group(1)!),
        totalFiles: 100,
      );
    }
    return null;
  }
}
```

**设计要点**
- URL 嵌 token 用 `x-access-token:<token>@` 格式(GitHub 官方推荐的 token 认证 URL 格式)
- `--single-branch` 减少下载量(用户已选分支,不需要全历史)
- 完成后立即 `remote set-url` 清除 token,`.git/config` 只剩干净 URL
- 解析 `Receiving objects: X%` 映射到 `downloading`,`Resolving deltas: X%` 映射到 `extracting`,复用现有 `ClonePhase` 枚举
- 文件数通过 `git ls-files` 统计,用于 done 阶段的 `processedFiles`/`totalFiles`

### 5.4 CloneNotifier 改造

```dart
// lib/core/github/clone_notifier.dart 改造 startClone

Future<void> startClone({
  required String repository,
  required String branch,
  required String targetDirectory,
  required bool useTermux, // 新增
}) async {
  // ... 前置校验不变
  _task = useTermux
      ? _runTermuxTask(repository, branch, targetDirectory)
      : _runZipballTask(repository, branch, targetDirectory);
  await _task;
}

Future<void> _runTermuxTask(String repository, String branch, String target) async {
  try {
    final service = GitCloneService(token: token);
    await for (final progress in service.cloneViaTermux(
      repository: repository,
      branch: branch,
      targetDirectory: target,
      cancellationToken: _cancelToken,
    )) {
      // 同现有 _runTask 的进度→state 映射
    }
  } catch (error) { /* ... */ }
}
```

### 5.5 GitPlugin credential helper 注入

```dart
// lib/core/agent/plugins/git_plugin.dart 改造 defaultGitExecutor

Future<GitCommandResult> defaultGitExecutor(
  String gitPath,
  List<String> args, {
  required String workingDirectory,
  required Map<String, String> environment,
}) async {
  if (gitPath == 'termux:git') {
    // 对需要认证的命令(pull/push/fetch/ls-remote)注入临时 credential helper
    final needsAuth = const ['pull', 'push', 'fetch', 'ls-remote'].contains(args.first);
    final token = environment['SPACECODE_GITHUB_TOKEN'];
    List<String> effectiveArgs = args;
    if (needsAuth && token != null && token.isNotEmpty) {
      // 临时 credential helper:命令结束后不留痕迹
      effectiveArgs = [
        '-c', "credential.helper=!f(){ echo username=x-access-token; echo password=$token; }; f",
        ...args,
      ];
    }
    final result = await TermuxBridge.instance.runGit(
      args: effectiveArgs,
      workdir: workingDirectory,
      timeoutMs: 60000,
    );
    return GitCommandResult(...);
  }
  // 本地二进制模式不变
}
```

**设计要点**
- credential helper 用内联 shell 函数 `-c credential.helper='!f(){ ...; }; f'`,命令结束后不留任何配置
- token 通过 `environment['SPACECODE_GITHUB_TOKEN']` 注入,`GitPlugin` 构造时由调用方从 `mobileConfig` 读取并传入 environment
- 仅对 `pull/push/fetch/ls-remote` 注入,`status/log/diff` 等只读命令不需要

### 5.6 设置页「Termux 环境」卡片

新增卡片位于「Github」卡片之前,展示三态:

```
┌─────────────────────────────────────┐
│  TERMUX 环境                         │
├─────────────────────────────────────┤
│  ✅ Termux 已安装                    │
│  ⚠️  Git 未就绪                      │
│                                      │
│  请在 Termux 中执行:                 │
│  1. pkg install git                  │
│  2. 编辑 ~/.termux/termux.properties │
│     添加 allow-external-apps=true    │
│  3. termux-setup-storage            │
│  4. termux-reload-settings           │
│                                      │
│  [重新检测]                          │
└─────────────────────────────────────┘
```

状态映射:
- `notInstalled` → 红色 ✕,提示从 F-Droid 安装 Termux(Google Play 版已停止更新)
- `installedNoGit` → 黄色 ⚠️,显示上述 4 步配置
- `ready` → 绿色 ✅,「Termux 环境就绪,支持完整 git 操作」

「重新检测」按钮触发 `TermuxReadinessChecker.check()` 并刷新 `BinaryResolver.instance.setTermuxReadiness(...)`。

### 5.7 _cloneGithubRepository 二选一弹窗

```dart
Future<void> _cloneGithubRepository() async {
  // ... 现有选仓库/分支/目录逻辑不变 ...

  final readiness = BinaryResolver.instance.termuxReadiness;
  final useTermux = readiness == TermuxReadiness.ready;
  if (!useTermux) {
    final choice = await showDialog<_CloneFallbackChoice>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Termux 未就绪'),
        content: const Text(
          '当前 Termux 环境不可用,无法执行真正的 git clone。\n\n'
          '选择「安装 Termux」可获得完整 git 支持(推荐),\n'
          '选择「仅下载源码包」将下载不含 .git 的源代码快照,'
          '无法执行 git 命令。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, _CloneFallbackChoice.installTermux),
            child: const Text('安装 Termux'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, _CloneFallbackChoice.zipballOnly),
            child: const Text('仅下载源码包'),
          ),
        ],
      ),
    );
    if (choice == _CloneFallbackChoice.installTermux) {
      _scrollToTermuxCard(); // 滚动到 Termux 卡片
      return;
    }
    if (choice != _CloneFallbackChoice.zipballOnly) return; // 用户取消
  }

  await ref.read(cloneProvider.notifier).startClone(
    repository: repo.fullName,
    branch: branch,
    targetDirectory: actualTarget,
    useTermux: useTermux,
  );
}
```

## 6. Android 端实现要点

### 6.1 TermuxStreamBridge.kt

新增 EventChannel 处理器,注册于 MainActivity:

```kotlin
class TermuxStreamBridge(private val context: Context) : EventChannel.StreamHandler {
    private val sessions = mutableMapOf<String, TermuxSession>()

    override fun onListen(args: Any?, events: EventChannel.EventSink) {
        val params = args as Map<*, *>
        val sessionId = params["sessionId"] as String
        val command = params["command"] as String
        val argsList = params["args"] as List<*>
        val workdir = params["workdir"] as String?

        // 启动 Termux RunCommandService,通过 PendingIntent 回调接收输出
        val session = TermuxSession(context, sessionId, events, command, argsList, workdir)
        sessions[sessionId] = session
        session.start()
    }

    override fun onCancel(args: Any?) {
        val params = args as? Map<*, *>
        val sessionId = params?.get("sessionId") as? String
        sessions.remove(sessionId)?.destroy()
    }

    fun cancel(sessionId: String) {
        sessions[sessionId]?.destroy()
        sessions.remove(sessionId)
    }
}
```

**输出捕获方案**:Termux 的 `RunCommandService` 本身不直接返回 stdout。需要使用 Termux 的 `TermuxSession` API(通过 `com.termux:termux-agent` 或 AIDL)。

**实现风险与降级**:Termux 对外部 app 的输出回调支持有限。若 EventChannel 方案在实现阶段验证不可行,降级为「分段阶段进度」—— 拆分为 `git init` → `git remote add` → `git fetch` → `git checkout` 四段,每段完成推送一个进度点(0% / 25% / 50% / 75% / 100%),中间状态用不定进度转圈。此降级方案不需要改 Android 端,复用现有阻塞式 `runCommand()` 即可。

Android 端实现细节在实现阶段确定,本设计仅约束接口契约:`Stream<TermuxStreamEvent>`(主路径)或四段 `runCommand()` 调用(降级路径)。

## 7. 测试策略

### 7.1 单元测试

- `TermuxReadinessChecker`:
  - `checkInstalled()` 返回 false → `notInstalled`
  - `checkInstalled()` true + `runGit(['--version'])` exit 0 且 stdout 含 "git version" → `ready`
  - `checkInstalled()` true + `runGit` 抛 `START_FAILED` → `installedNoGit`
  - `checkInstalled()` true + `runGit` exit 1 → `installedNoGit`

- `GitCloneService._parseGitProgress`:
  - `"Receiving objects:  45% (450/1000)"` → CloneProgress(downloading, 450, 1000)
  - `"Resolving deltas:   3% (30/1000)"` → CloneProgress(extracting, 3, 100)
  - `"Counting objects: 100, done."` → null
  - 空行 / 不匹配行 → null

- `GitCloneService.cloneViaTermux`:
  - mock `TermuxBridge.runCommandStream` 推送预设事件序列,断言产出的 `CloneProgress` 流
  - exit != 0 → 产出 error phase
  - 完成后调用 `runGit(['remote', 'set-url', ...])` 清除 token

- `defaultGitExecutor` credential helper 注入:
  - `args = ['pull', 'origin']` + token 非空 → 实际 args 以 `-c credential.helper=...` 开头
  - `args = ['status']` → 不注入
  - token 为空 → 不注入

### 7.2 Widget 测试

- 设置页「Termux 环境」卡片三态渲染
- `_cloneGithubRepository` 二选一弹窗:ready 时不弹、notInstalled/installNoGit 时弹
- 弹窗「安装 Termux」→ 触发滚动;「仅下载源码包」→ 调用 `startClone(useTermux: false)`

### 7.3 集成测试(手动)

- 真机:Termux 已就绪 → clone 小仓库 → 验证 `.git` 存在 + `git status` 可用
- 真机:卸载 Termux → clone → 弹窗 → 选「仅下载」→ 验证无 `.git` 且 UI 提示
- 真机:clone 后 `git pull` 验证 credential helper 注入生效

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Termux 输出流式回调机制不稳定 | 实现阶段先验证 EventChannel 可行性,不可行则按 §6.1 降级为「分段阶段进度」(git init→remote add→fetch→checkout 四段) |
| URL 嵌 token 在错误日志中泄露 | git clone 失败时对 stderr 做 token 脱敏(`x-access-token:****@`)再展示 |
| 目标目录 Termux 无写权限 | 引导 UI 明确要求 `termux-setup-storage`;clone 前用 `TermuxBridge.runCommand(['touch', '$target/.test'])` 探测,失败提示授权 |
| `--single-branch` 后用户切换分支需重新 clone | 文档说明,不在 UI 层处理(YAGNI) |
| 二选一弹窗打断「选目录」流程 | 弹窗放在选目录之后、startClone 之前,顺序自然 |

## 9. 范围外(YAGNI)

- 不实现 git clone 的 shallow depth 可配置(`--depth=1` 默认足够)
- 不实现多分支 clone(用户已选单分支)
- 不实现 LFS 支持
- 不实现子模块递归 clone(用户场景未提及)
- 不改造 `ShellPlugin`(本次只动 git 路径)
- 不实现 Termux 自动安装(引导用户手动安装,F-Droid 链接即可)
- 不持久化 Termux 就绪状态(每次进入设置页重新检测,避免缓存过期)
