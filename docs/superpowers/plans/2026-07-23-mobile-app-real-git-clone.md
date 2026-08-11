# 手机端真 git clone 双路径实现计划

> **面向 AI 代理的工作者:** 必需子技能:使用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框(`- [ ]`)语法来跟踪进度。

**目标:** 让手机端 clone 仓库时通过 Termux 执行真正的 `git clone`,产出含 `.git` 的完整仓库;Termux 未就绪时二选一弹窗引导安装或降级 zipball。

**架构:** 新增 `TermuxReadinessChecker`(三态检测)、`GitCloneService`(分四段 `git init/remote add/fetch/checkout` 执行,每段推送进度点)。`CloneNotifier.startClone` 增加 `useTermux` 参数分流到 `GitCloneService` 或现有 zipball。`GitPlugin.defaultGitExecutor` 对 pull/push/fetch 注入临时 credential helper(token 不持久化)。设置页新增「Termux 环境」引导卡片 + clone 前置二选一弹窗。

**技术栈:** Flutter 3 / Dart 3 / Riverpod / Termux RunCommandService(现有阻塞式调用)

**规格来源:** [docs/superpowers/specs/2026-07-23-mobile-app-real-git-clone-design.md](file:///d:/AI/SpaceCode/docs/superpowers/specs/2026-07-23-mobile-app-real-git-clone-design.md)

**实现决策(规格 §6.1 降级路径):** 规格主路径是 EventChannel 流式输出,但 Android 端 `TermuxBridge.kt` 现有实现用 `PendingIntent + BroadcastReceiver`,只在命令结束时一次性返回,不支持流式回调。Termux `RunCommandService` API 本身不提供流式 stdout。因此本计划直接采用规格 §6.1 的降级方案 —— **分段阶段进度**(git init → remote add → fetch → checkout 四段),复用现有阻塞式 `runCommand()`,不修改 Android 端 Kotlin 代码。

---

## 文件结构

### 新增
- `mobile-app/lib/core/agent/termux_readiness_checker.dart` — Termux 三态检测,纯 Dart 逻辑,依赖 `TermuxBridge`
- `mobile-app/lib/core/github/git_clone_service.dart` — 通过 Termux 执行分四段 git clone,产出 `CloneProgress` 流
- `mobile-app/test/core/agent/termux_readiness_checker_test.dart` — 单元测试
- `mobile-app/test/core/github/git_clone_service_test.dart` — 单元测试

### 修改
- `mobile-app/lib/core/agent/binary_resolver.dart` — 新增 `TermuxReadiness` 枚举、`setTermuxReadiness()`、`termuxReadiness` getter;保留 `markTermuxReady()` 兼容
- `mobile-app/lib/core/github/clone_notifier.dart` — `startClone` 增加 `useTermux` 参数,新增 `_runTermuxTask` 调用 `GitCloneService`
- `mobile-app/lib/core/agent/plugins/git_plugin.dart` — `defaultGitExecutor` 对 pull/push/fetch/ls-remote 注入 credential helper
- `mobile-app/lib/main.dart` — 启动时用 `TermuxReadinessChecker.check()` 替代 `checkInstalled()`,写入 `BinaryResolver`
- `mobile-app/lib/features/settings/settings_screen.dart` — 新增「Termux 环境」卡片 + `_cloneGithubRepository` 二选一弹窗
- `mobile-app/test/core/github/clone_notifier_test.dart` — 现有测试适配 `useTermux` 参数
- `mobile-app/test/core/agent/git_plugin_credential_test.dart`(新增)— credential helper 注入测试

---

## 任务清单

### 任务 1:TermuxReadiness 枚举与 BinaryResolver 扩展

**文件:**
- 修改:`mobile-app/lib/core/agent/binary_resolver.dart`
- 测试:`mobile-app/test/core/agent/binary_resolver_test.dart`(新建)

- [ ] **步骤 1:编写失败的测试**

创建 `mobile-app/test/core/agent/binary_resolver_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/binary_resolver.dart';

void main() {
  group('BinaryResolver TermuxReadiness', () {
    test('initial readiness is notInstalled', () {
      final resolver = BinaryResolver.forTest();
      expect(resolver.termuxReadiness, TermuxReadiness.notInstalled);
    });

    test('setTermuxReadiness updates getter', () {
      final resolver = BinaryResolver.forTest();
      resolver.setTermuxReadiness(TermuxReadiness.ready);
      expect(resolver.termuxReadiness, TermuxReadiness.ready);
    });

    test('setTermuxReadiness ready sets gitPath to termux:git', () {
      final resolver = BinaryResolver.forTest();
      resolver.setTermuxReadiness(TermuxReadiness.ready);
      expect(resolver.gitPath, 'termux:git');
    });

    test('setTermuxReadiness installedNoGit does not set gitPath', () {
      final resolver = BinaryResolver.forTest();
      resolver.setTermuxReadiness(TermuxReadiness.installedNoGit);
      expect(resolver.gitPath, isNull);
      expect(resolver.termuxReadiness, TermuxReadiness.installedNoGit);
    });

    test('markTermuxReady is equivalent to setTermuxReadiness(ready)', () {
      final resolver = BinaryResolver.forTest();
      resolver.markTermuxReady();
      expect(resolver.termuxReadiness, TermuxReadiness.ready);
      expect(resolver.gitPath, 'termux:git');
    });
  });
}
```

- [ ] **步骤 2:运行测试验证失败**

运行:`cd mobile-app && flutter test test/core/agent/binary_resolver_test.dart`
预期:FAIL,报错 `TermuxReadiness` 未定义 / `termuxReadiness` getter 不存在 / `setTermuxReadiness` 方法不存在

- [ ] **步骤 3:实现 BinaryResolver 扩展**

修改 `mobile-app/lib/core/agent/binary_resolver.dart`,在文件顶部(import 后)新增 `TermuxReadiness` 枚举:

```dart
/// Termux 就绪状态。
enum TermuxReadiness {
  /// 未安装 Termux
  notInstalled,
  /// 已安装 Termux 但 git 不可用(未 pkg install git 或未配置 allow-external-apps)
  installedNoGit,
  /// 完全就绪:Termux 已安装 + git 可执行
  ready,
}
```

在 `BinaryResolver` 类中,把 `bool _termuxReady = false;` 字段替换为 `TermuxReadiness _termuxReadiness = TermuxReadiness.notInstalled;`,并新增/修改方法:

```dart
/// 设置 Termux 就绪状态。
///
/// 当 [readiness] 为 [TermuxReadiness.ready] 时,自动设置 [gitPath] 为 `termux:git`,
/// 让 GitPlugin 通过 Termux 桥接执行。
void setTermuxReadiness(TermuxReadiness readiness) {
  _termuxReadiness = readiness;
  if (readiness == TermuxReadiness.ready) {
    _gitPath ??= 'termux:git';
  }
}

/// Termux 桥接就绪状态。
TermuxReadiness get termuxReadiness => _termuxReadiness;
```

修改现有 `markTermuxReady()` 方法,改为调用 `setTermuxReadiness`:

```dart
/// 标记 Termux 桥接已就绪(向后兼容)。
///
/// 等价于 `setTermuxReadiness(TermuxReadiness.ready)`。
void markTermuxReady() {
  setTermuxReadiness(TermuxReadiness.ready);
}
```

删除旧的 `bool get termuxReady => _termuxReady;` getter(已被 `termuxReadiness` 取代)。

- [ ] **步骤 4:运行测试验证通过**

运行:`cd mobile-app && flutter test test/core/agent/binary_resolver_test.dart`
预期:PASS(5 个测试全过)

- [ ] **步骤 5:运行全量测试确认无回归**

运行:`cd mobile-app && flutter test`
预期:PASS(若其他测试因 `termuxReady` getter 删除报错,记录下来在任务 7 一并修复;BinaryResolver 自身测试通过即可)

- [ ] **步骤 6:Commit**

```bash
cd mobile-app
git add lib/core/agent/binary_resolver.dart test/core/agent/binary_resolver_test.dart
git commit -m "feat(mobile): 新增 TermuxReadiness 三态枚举与 BinaryResolver.setTermuxReadiness"
```

---

### 任务 2:TermuxReadinessChecker

**文件:**
- 创建:`mobile-app/lib/core/agent/termux_readiness_checker.dart`
- 测试:`mobile-app/test/core/agent/termux_readiness_checker_test.dart`

- [ ] **步骤 1:编写失败的测试**

创建 `mobile-app/test/core/agent/termux_readiness_checker_test.dart`:

```dart
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/termux_bridge.dart';
import 'package:spacecode_mobile/core/agent/termux_readiness_checker.dart';

void main() {
  group('TermuxReadinessChecker', () {
    setUp(() {
      // 重置 TermuxBridge 单例状态
      // 由于是单例,测试间需手动重置
    });

    test('returns notInstalled when checkInstalled returns false', () async {
      final checker = _FakeTermuxReadinessChecker(
        installed: false,
        versionResult: null,
      );
      expect(await checker.check(), TermuxReadiness.notInstalled);
    });

    test('returns ready when git --version succeeds with valid output',
        () async {
      final checker = _FakeTermuxReadinessChecker(
        installed: true,
        versionResult: const TermuxResult(
          exitCode: 0,
          stdout: 'git version 2.45.0',
          stderr: '',
          durationMs: 100,
        ),
      );
      expect(await checker.check(), TermuxReadiness.ready);
    });

    test('returns installedNoGit when git --version exits non-zero', () async {
      final checker = _FakeTermuxReadinessChecker(
        installed: true,
        versionResult: const TermuxResult(
          exitCode: 127,
          stdout: '',
          stderr: 'git: command not found',
          durationMs: 50,
        ),
      );
      expect(await checker.check(), TermuxReadiness.installedNoGit);
    });

    test('returns installedNoGit when git --version throws PlatformException',
        () async {
      final checker = _FakeTermuxReadinessChecker(
        installed: true,
        versionResult: null,
        versionException: PlatformException(
          code: 'START_FAILED',
          message: 'allow-external-apps not configured',
        ),
      );
      expect(await checker.check(), TermuxReadiness.installedNoGit);
    });

    test('returns installedNoGit when stdout lacks "git version"', () async {
      final checker = _FakeTermuxReadinessChecker(
        installed: true,
        versionResult: const TermuxResult(
          exitCode: 0,
          stdout: 'unexpected output',
          stderr: '',
          durationMs: 10,
        ),
      );
      expect(await checker.check(), TermuxReadiness.installedNoGit);
    });
  });
}

/// 通过依赖注入绕过单例的 fake checker。
class _FakeTermuxReadinessChecker extends TermuxReadinessChecker {
  final bool installed;
  final TermuxResult? versionResult;
  final PlatformException? versionException;

  _FakeTermuxReadinessChecker({
    required this.installed,
    required this.versionResult,
    this.versionException,
  });

  @override
  Future<bool> checkInstalled() async => installed;

  @override
  Future<TermuxResult> runGitVersion() async {
    if (versionException != null) throw versionException!;
    return versionResult!;
  }
}
```

- [ ] **步骤 2:运行测试验证失败**

运行:`cd mobile-app && flutter test test/core/agent/termux_readiness_checker_test.dart`
预期:FAIL,报错 `termux_readiness_checker.dart` 不存在 / `TermuxReadinessChecker` 未定义

- [ ] **步骤 3:实现 TermuxReadinessChecker**

创建 `mobile-app/lib/core/agent/termux_readiness_checker.dart`:

```dart
import 'package:flutter/services.dart';

import 'binary_resolver.dart';
import 'termux_bridge.dart';

/// 检测 Termux 就绪状态(三态)。
///
/// 通过 [TermuxBridge.checkInstalled] 检测是否安装,
/// 再通过 `git --version` 验证 allow-external-apps + git 可用性。
///
/// 设计为可继承以支持测试注入(见 [_FakeTermuxReadinessChecker])。
class TermuxReadinessChecker {
  /// 单例实例(生产用)。
  static Future<TermuxReadiness> check() async {
    return const _DefaultTermuxReadinessChecker().check();
  }

  /// 子类覆写:返回 Termux 是否安装。
  Future<bool> checkInstalled() async {
    return TermuxBridge.instance.checkInstalled();
  }

  /// 子类覆写:执行 `git --version`。
  Future<TermuxResult> runGitVersion() async {
    return TermuxBridge.instance.runGit(
      args: const ['--version'],
      timeoutMs: 5000,
    );
  }

  /// 执行检测,返回三态之一。
  Future<TermuxReadiness> detect() async {
    if (!await checkInstalled()) {
      return TermuxReadiness.notInstalled;
    }
    try {
      final result = await runGitVersion();
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

/// 默认实现:委托给 [TermuxBridge] 单例。
class _DefaultTermuxReadinessChecker extends TermuxReadinessChecker {
  const _DefaultTermuxReadinessChecker();

  @override
  Future<TermuxReadiness> check() => detect();
}
```

**修正:** 上面的 `TermuxReadinessChecker.check()` 是 static,测试中无法注入。重构为:静态 `check()` 调用 `detect()`(实例方法),测试创建子类覆写 `checkInstalled`/`runGitVersion`,然后调用 `detect()`。

修正 `TermuxReadinessChecker` 类(替换上面):

```dart
/// 检测 Termux 就绪状态(三态)。
///
/// 通过 [TermuxBridge.checkInstalled] 检测是否安装,
/// 再通过 `git --version` 验证 allow-external-apps + git 可用性。
class TermuxReadinessChecker {
  const TermuxReadinessChecker();

  /// 生产入口:使用 [TermuxBridge] 单例执行检测。
  Future<TermuxReadiness> check() async {
    if (!await TermuxBridge.instance.checkInstalled()) {
      return TermuxReadiness.notInstalled;
    }
    try {
      final result = await TermuxBridge.instance.runGit(
        args: const ['--version'],
        timeoutMs: 5000,
      );
      if (result.exitCode == 0 && result.stdout.contains('git version')) {
        return TermuxReadiness.ready;
      }
      return TermuxReadiness.installedNoGit;
    } on PlatformException {
      return TermuxReadiness.installedNoGit;
    }
  }
}
```

相应修正测试,fake 不再继承,改为通过 stubbing `TermuxBridge` 单例的 channel。但单例 hardcode 了 channel,难以 stub。最简单方案:把 `check()` 改为接受可选的 `TermuxBridge` 参数:

最终版 `TermuxReadinessChecker`:

```dart
import 'package:flutter/services.dart';

import 'binary_resolver.dart';
import 'termux_bridge.dart';

/// 检测 Termux 就绪状态(三态)。
///
/// 生产用法:`await TermuxReadinessChecker().check()`
/// 测试用法:传入 mock [bridge]
class TermuxReadinessChecker {
  final TermuxBridge bridge;

  const TermuxReadinessChecker({TermuxBridge? bridge})
      : bridge = bridge ?? TermuxBridge.instance;

  /// 执行检测,返回三态之一。
  Future<TermuxReadiness> check() async {
    if (!await bridge.checkInstalled()) {
      return TermuxReadiness.notInstalled;
    }
    try {
      final result = await bridge.runGit(
        args: const ['--version'],
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

修正测试 `mobile-app/test/core/agent/termux_readiness_checker_test.dart`:

```dart
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/termux_bridge.dart';
import 'package:spacecode_mobile/core/agent/termux_readiness_checker.dart';
import 'package:spacecode_mobile/core/agent/binary_resolver.dart';

void main() {
  group('TermuxReadinessChecker', () {
    test('returns notInstalled when checkInstalled returns false', () async {
      final checker = TermuxReadinessChecker(
        bridge: _FakeTermuxBridge(installed: false),
      );
      expect(await checker.check(), TermuxReadiness.notInstalled);
    });

    test('returns ready when git --version succeeds with valid output',
        () async {
      final checker = TermuxReadinessChecker(
        bridge: _FakeTermuxBridge(
          installed: true,
          versionResult: const TermuxResult(
            exitCode: 0,
            stdout: 'git version 2.45.0',
            stderr: '',
            durationMs: 100,
          ),
        ),
      );
      expect(await checker.check(), TermuxReadiness.ready);
    });

    test('returns installedNoGit when git --version exits non-zero', () async {
      final checker = TermuxReadinessChecker(
        bridge: _FakeTermuxBridge(
          installed: true,
          versionResult: const TermuxResult(
            exitCode: 127,
            stdout: '',
            stderr: 'git: command not found',
            durationMs: 50,
          ),
        ),
      );
      expect(await checker.check(), TermuxReadiness.installedNoGit);
    });

    test('returns installedNoGit when git --version throws PlatformException',
        () async {
      final checker = TermuxReadinessChecker(
        bridge: _FakeTermuxBridge(
          installed: true,
          versionException: PlatformException(
            code: 'START_FAILED',
            message: 'allow-external-apps not configured',
          ),
        ),
      );
      expect(await checker.check(), TermuxReadiness.installedNoGit);
    });

    test('returns installedNoGit when stdout lacks "git version"', () async {
      final checker = TermuxReadinessChecker(
        bridge: _FakeTermuxBridge(
          installed: true,
          versionResult: const TermuxResult(
            exitCode: 0,
            stdout: 'unexpected output',
            stderr: '',
            durationMs: 10,
          ),
        ),
      );
      expect(await checker.check(), TermuxReadiness.installedNoGit);
    });
  });
}

/// Stub TermuxBridge —— 绕过单例与 channel。
/// 通过子类化覆盖方法,避免触发 MethodChannel(测试环境未注册)。
class _FakeTermuxBridge extends TermuxBridge {
  final bool installed;
  final TermuxResult? versionResult;
  final PlatformException? versionException;

  _FakeTermuxBridge({
    required this.installed,
    this.versionResult,
    this.versionException,
  });

  @override
  Future<bool> checkInstalled() async => installed;

  @override
  Future<TermuxResult> runGit({
    required List<String> args,
    String? workdir,
    int timeoutMs = 30000,
  }) async {
    if (versionException != null) throw versionException!;
    return versionResult!;
  }
}
```

注意:`_FakeTermuxBridge` 继承 `TermuxBridge` 需要把 `TermuxBridge` 的 `runGit` 和 `checkInstalled` 改为非 final(它们已经是实例方法,可覆盖)。`TermuxBridge` 现有构造是私有的 `TermuxBridge._()`,需改为 `@visibleForTesting` 暴露。在 `termux_bridge.dart` 顶部加 `import 'package:flutter/foundation.dart';` 并新增:

```dart
@visibleForTesting
TermuxBridge.forTesting();
```

并修改 `runGit`/`checkInstalled` 使其可被覆盖(已经是普通方法,无需改动,但 `instance` 单例的获取需保持)。

- [ ] **步骤 4:TermuxBridge 暴露测试构造函数**

修改 `mobile-app/lib/core/agent/termux_bridge.dart`,在 `import 'package:flutter/services.dart';` 后加:

```dart
import 'package:flutter/foundation.dart';
```

在 `TermuxBridge._();` 后新增:

```dart
/// 测试用公开构造函数。
@visibleForTesting
TermuxBridge.forTesting() : this._();
```

- [ ] **步骤 5:运行测试验证通过**

运行:`cd mobile-app && flutter test test/core/agent/termux_readiness_checker_test.dart`
预期:PASS(5 个测试全过)

- [ ] **步骤 6:Commit**

```bash
cd mobile-app
git add lib/core/agent/termux_readiness_checker.dart lib/core/agent/termux_bridge.dart test/core/agent/termux_readiness_checker_test.dart
git commit -m "feat(mobile): 新增 TermuxReadinessChecker 三态检测"
```

---

### 任务 3:GitCloneService(分四段 git clone)

**文件:**
- 创建:`mobile-app/lib/core/github/git_clone_service.dart`
- 测试:`mobile-app/test/core/github/git_clone_service_test.dart`

- [ ] **步骤 1:编写失败的测试**

创建 `mobile-app/test/core/github/git_clone_service_test.dart`:

```dart
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/termux_bridge.dart';
import 'package:spacecode_mobile/core/github/clone_progress.dart';
import 'package:spacecode_mobile/core/github/git_clone_service.dart';

void main() {
  group('GitCloneService', () {
    test('emits 4 phase progresses + done on success', () async {
      final bridge = _RecordingTermuxBridge(
        responses: {
          'init': _ok(''),
          'remote': _ok(''),
          'fetch': _ok(''),
          'checkout': _ok(''),
          'ls-files': _ok('README.md\nmain.dart\n'),
        },
      );
      final service = GitCloneService(token: 'tok123', bridge: bridge);

      final progresses = <CloneProgress>[];
      await for (final p in service.cloneViaTermux(
        repository: 'owner/repo',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      )) {
        progresses.add(p);
      }

      // 期望:4 个阶段进度(init/remote/fetch/checkout 各 25%) + done
      expect(progresses.length, 5);
      expect(progresses[0].phase, ClonePhase.downloading);
      expect(progresses[0].processedFiles, 0);
      expect(progresses[1].phase, ClonePhase.downloading);
      expect(progresses[2].phase, ClonePhase.extracting);
      expect(progresses[3].phase, ClonePhase.extracting);
      expect(progresses[4].phase, ClonePhase.done);
      expect(progresses[4].resultPath, '/tmp/repo');
      expect(progresses[4].processedFiles, 2);
      expect(progresses[4].totalFiles, 2);
    });

    test('emits error when git init fails', () async {
      final bridge = _RecordingTermuxBridge(
        responses: {
          'init': _fail('permission denied'),
        },
      );
      final service = GitCloneService(token: 'tok123', bridge: bridge);

      final progresses = <CloneProgress>[];
      await for (final p in service.cloneViaTermux(
        repository: 'owner/repo',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      )) {
        progresses.add(p);
      }

      expect(progresses.last.phase, ClonePhase.error);
      expect(progresses.last.errorMessage, contains('git init 失败'));
    });

    test('emits error when git fetch fails', () async {
      final bridge = _RecordingTermuxBridge(
        responses: {
          'init': _ok(''),
          'remote': _ok(''),
          'fetch': _fail('Authentication failed'),
          'checkout': _ok(''),
          'ls-files': _ok(''),
        },
      );
      final service = GitCloneService(token: 'bad-token', bridge: bridge);

      final progresses = <CloneProgress>[];
      await for (final p in service.cloneViaTermux(
        repository: 'owner/repo',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      )) {
        progresses.add(p);
      }

      expect(progresses.last.phase, ClonePhase.error);
      expect(progresses.last.errorMessage, contains('git fetch 失败'));
      expect(progresses.last.errorMessage, contains('Authentication failed'));
    });

    test('fetch URL contains token; ls-files not affected by token', () async {
      final bridge = _RecordingTermuxBridge(
        responses: {
          'init': _ok(''),
          'remote': _ok(''),
          'fetch': _ok(''),
          'checkout': _ok(''),
          'ls-files': _ok('a.txt\n'),
        },
      );
      final service = GitCloneService(token: 'secret-tok', bridge: bridge);

      await for (final _ in service.cloneViaTermux(
        repository: 'owner/repo',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      )) {}

      // fetch 调用的 args 应包含带 token 的 URL
      final fetchCall = bridge.calls.firstWhere((c) => c.args!.first == 'fetch');
      expect(fetchCall.args, contains('https://x-access-token:secret-tok@github.com/owner/repo.git'));

      // remote add 用干净 URL(不含 token)
      final remoteCall = bridge.calls.firstWhere((c) => c.args!.first == 'remote');
      expect(remoteCall.args, contains('https://github.com/owner/repo.git'));
      expect(remoteCall.args!.any((a) => a.contains('secret-tok')), isFalse);
    });

    test('sanitizes token from error message', () async {
      final bridge = _RecordingTermuxBridge(
        responses: {
          'init': _ok(''),
          'remote': _ok(''),
          'fetch': _fail('fatal: Authentication failed for https://x-access-token:secret-tok@github.com/'),
          'checkout': _ok(''),
          'ls-files': _ok(''),
        },
      );
      final service = GitCloneService(token: 'secret-tok', bridge: bridge);

      final progresses = <CloneProgress>[];
      await for (final p in service.cloneViaTermux(
        repository: 'owner/repo',
        branch: 'main',
        targetDirectory: '/tmp/repo',
      )) {
        progresses.add(p);
      }

      expect(progresses.last.phase, ClonePhase.error);
      expect(progresses.last.errorMessage, isNot(contains('secret-tok')));
    });
  });
}

TermuxResult _ok(String stdout) => TermuxResult(
      exitCode: 0,
      stdout: stdout,
      stderr: '',
      durationMs: 10,
    );

TermuxResult _fail(String stderr) => TermuxResult(
      exitCode: 1,
      stdout: '',
      stderr: stderr,
      durationMs: 10,
    );

/// 记录所有调用的 fake TermuxBridge。
class _RecordingTermuxBridge extends TermuxBridge {
  final Map<String, TermuxResult> responses;
  final calls = <_CallRecord>[];

  _RecordingTermuxBridge({required this.responses}) : super.forTesting();

  @override
  Future<TermuxResult> runGit({
    required List<String> args,
    String? workdir,
    int timeoutMs = 30000,
  }) async {
    calls.add(_CallRecord(args: args, workdir: workdir));
    // 用 args.first 作为 key
    final key = args.first == 'remote' ? 'remote' : args.first;
    final result = responses[key];
    if (result == null) {
      throw StateError('No mock for git ${args.first}');
    }
    return result;
  }
}

class _CallRecord {
  final List<String>? args;
  final String? workdir;
  _CallRecord({this.args, this.workdir});
}
```

- [ ] **步骤 2:运行测试验证失败**

运行:`cd mobile-app && flutter test test/core/github/git_clone_service_test.dart`
预期:FAIL,报错 `git_clone_service.dart` 不存在 / `GitCloneService` 未定义

- [ ] **步骤 3:实现 GitCloneService**

创建 `mobile-app/lib/core/github/git_clone_service.dart`:

```dart
import 'dart:io';

import '../agent/termux_bridge.dart';
import 'clone_progress.dart';

/// 通过 Termux 执行真正的 `git clone`,产出含 `.git` 的完整仓库。
///
/// 采用分段执行策略(规格 §6.1 降级路径):
/// 1. `git init` → ClonePhase.downloading 0%
/// 2. `git remote add origin <url-with-token>` → ClonePhase.downloading 25%
/// 3. `git fetch origin <branch>` → ClonePhase.extracting 50%
/// 4. `git checkout <branch>` → ClonePhase.extracting 75%
/// 5. `git remote set-url origin <clean-url>` (清除 token) → ClonePhase.done 100%
///
/// 每段用阻塞式 [TermuxBridge.runGit],进度为四段式阶段进度。
class GitCloneService {
  final String token;
  final TermuxBridge bridge;

  GitCloneService({
    required this.token,
    TermuxBridge? bridge,
  }) : bridge = bridge ?? TermuxBridge.instance;

  /// 执行 git clone,流式推送进度。
  Stream<CloneProgress> cloneViaTermux({
    required String repository, // owner/repo
    required String branch,
    required String targetDirectory,
  }) async* {
    // 0. 准备目标目录(空目录)
    final target = Directory(targetDirectory);
    if (await target.exists()) {
      await target.delete(recursive: true);
    }
    await target.create(recursive: true);

    const cleanUrl = 'https://github.com/';
    final tokenUrl = 'https://x-access-token:$token@github.com/$repository.git';
    final sanitizedToken = token.isEmpty ? '' : '${token.substring(0, token.length > 4 ? 4 : 0)}****';

    // 阶段 1: git init
    yield const CloneProgress(
      phase: ClonePhase.downloading,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: 0,
    );
    final initResult = await bridge.runGit(
      args: ['init', targetDirectory],
    );
    if (initResult.exitCode != 0) {
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: 0,
        totalBytes: null,
        processedFiles: 0,
        errorMessage: 'git init 失败: ${_sanitize(initResult.stderr, token)}',
      );
      return;
    }

    // 阶段 2: git remote add origin <url-with-token>
    // 临时带 token 用于 fetch;完成后会 set-url 清除
    yield const CloneProgress(
      phase: ClonePhase.downloading,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: 0,
    );
    final remoteResult = await bridge.runGit(
      args: ['remote', 'add', 'origin', tokenUrl],
      workdir: targetDirectory,
    );
    if (remoteResult.exitCode != 0) {
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: 0,
        totalBytes: null,
        processedFiles: 0,
        errorMessage: 'git remote add 失败: ${_sanitize(remoteResult.stderr, token)}',
      );
      return;
    }

    // 阶段 3: git fetch origin <branch>
    yield const CloneProgress(
      phase: ClonePhase.extracting,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: 0,
    );
    final fetchResult = await bridge.runGit(
      args: ['fetch', 'origin', branch],
      workdir: targetDirectory,
      timeoutMs: 300000, // fetch 可能较慢,5 分钟
    );
    if (fetchResult.exitCode != 0) {
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: 0,
        totalBytes: null,
        processedFiles: 0,
        errorMessage: 'git fetch 失败: ${_sanitize(fetchResult.stderr, token)}',
      );
      return;
    }

    // 阶段 4: git checkout <branch>
    yield const CloneProgress(
      phase: ClonePhase.extracting,
      receivedBytes: 0,
      totalBytes: null,
      processedFiles: 0,
    );
    final checkoutResult = await bridge.runGit(
      args: ['checkout', branch],
      workdir: targetDirectory,
    );
    if (checkoutResult.exitCode != 0) {
      yield CloneProgress(
        phase: ClonePhase.error,
        receivedBytes: 0,
        totalBytes: null,
        processedFiles: 0,
        errorMessage: 'git checkout 失败: ${_sanitize(checkoutResult.stderr, token)}',
      );
      return;
    }

    // 阶段 5: 清除 remote URL 中的 token
    await bridge.runGit(
      args: ['remote', 'set-url', 'origin', 'https://github.com/$repository.git'],
      workdir: targetDirectory,
    );

    // 统计文件数
    final lsResult = await bridge.runGit(
      args: ['ls-files'],
      workdir: targetDirectory,
    );
    final fileCount = lsResult.stdout
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

  /// 脱敏 stderr 中的 token。
  String _sanitize(String text, String token) {
    if (token.isEmpty) return text;
    return text.replaceAll(token, '${token.substring(0, token.length > 4 ? 4 : 0)}****');
  }
}
```

- [ ] **步骤 4:运行测试验证通过**

运行:`cd mobile-app && flutter test test/core/github/git_clone_service_test.dart`
预期:PASS(5 个测试全过)

- [ ] **步骤 5:Commit**

```bash
cd mobile-app
git add lib/core/github/git_clone_service.dart test/core/github/git_clone_service_test.dart
git commit -m "feat(mobile): 新增 GitCloneService 分四段执行真 git clone via Termux"
```

---

### 任务 4:CloneNotifier 增加 useTermux 分流

**文件:**
- 修改:`mobile-app/lib/core/github/clone_notifier.dart`
- 修改:`mobile-app/test/core/github/clone_notifier_test.dart`

- [ ] **步骤 1:更新现有测试以适配新参数**

修改 `mobile-app/test/core/github/clone_notifier_test.dart`,所有 `startClone(...)` 调用增加 `useTermux: false`:

把以下三处(第 22-27 行、第 41-45 行、第 51-56 行、第 91-95 行、第 122-126 行、第 152-156 行)的 `startClone` 调用都加上 `useTermux: false`。例如:

```dart
await notifier.startClone(
  repository: 'spacecode/mobile',
  branch: 'main',
  targetDirectory: '/tmp/repo',
  useTermux: false,  // 新增
);
```

同时新增一个 useTermux: true 的测试:

```dart
test('useTermux=true delegates to GitCloneService', () async {
  final container = ProviderContainer(overrides: [
    mobileConfigProvider.overrideWith(
        (ref) => _StubConfigNotifier(const MobileConfig(githubToken: 't'))),
    gitCloneServiceFactoryProvider.overrideWithValue(
      _FakeGitCloneService(stream: Stream.fromIterable([
        const CloneProgress(
            phase: ClonePhase.downloading,
            receivedBytes: 0,
            totalBytes: null,
            processedFiles: 0),
        const CloneProgress(
            phase: ClonePhase.done,
            receivedBytes: 0,
            totalBytes: null,
            processedFiles: 3,
            totalFiles: 3,
            resultPath: '/tmp/repo'),
      ])),
    ),
  ]);
  addTearDown(container.dispose);
  final notifier = container.read(cloneProvider.notifier);
  await notifier.startClone(
    repository: 'spacecode/mobile',
    branch: 'main',
    targetDirectory: '/tmp/repo',
    useTermux: true,
  );

  final state = container.read(cloneProvider);
  expect(state.status, CloneStatus.done);
  expect(state.resultPath, '/tmp/repo');
});
```

在文件底部新增 fake:

```dart
class _FakeGitCloneService extends GitCloneService {
  final Stream<CloneProgress> stream;
  _FakeGitCloneService({required this.stream}) : super(token: 't');

  @override
  Stream<CloneProgress> cloneViaTermux({
    required String repository,
    required String branch,
    required String targetDirectory,
  }) {
    return stream;
  }
}
```

- [ ] **步骤 2:运行测试验证失败**

运行:`cd mobile-app && flutter test test/core/github/clone_notifier_test.dart`
预期:FAIL,报错 `useTermux` 参数不存在 / `gitCloneServiceFactoryProvider` 未定义

- [ ] **步骤 3:修改 CloneNotifier**

修改 `mobile-app/lib/core/github/clone_notifier.dart`:

在文件顶部 import 区加:

```dart
import 'git_clone_service.dart';
```

在 `cloneServiceFactoryProvider` 定义后新增 `gitCloneServiceFactoryProvider`:

```dart
/// GitCloneService 工厂 Provider:测试时可 override。
final gitCloneServiceFactoryProvider =
    Provider<GitCloneService Function(String token)>((ref) {
  return (token) => GitCloneService(token: token);
});
```

修改 `CloneNotifier` 类:
- 新增字段 `bool _cancelled = false;` 已有,无需改
- 修改 `startClone` 方法签名,加 `required bool useTermux`:

```dart
Future<void> startClone({
  required String repository,
  required String branch,
  required String targetDirectory,
  required bool useTermux,
}) async {
  if (state.status == CloneStatus.running) {
    throw StateError('已有 clone 任务运行中');
  }
  final token = _ref.read(mobileConfigProvider).githubToken;
  if (token.isEmpty) {
    throw StateError('未连接 GitHub');
  }
  _cancelled = false;
  state = CloneState(
    status: CloneStatus.running,
    progress: null,
    repositoryName: repository,
  );
  _task = useTermux
      ? _runTermuxTask(
          token: token,
          repository: repository,
          branch: branch,
          targetDirectory: targetDirectory,
        )
      : _runZipballTask(
          token: token,
          repository: repository,
          branch: branch,
          targetDirectory: targetDirectory,
        );
  await _task;
}
```

把原 `_runTask` 重命名为 `_runZipballTask`,参数从 `service:` 改为内部创建:

```dart
Future<void> _runZipballTask({
  required String token,
  required String repository,
  required String branch,
  required String targetDirectory,
}) async {
  final service = _ref.read(cloneServiceFactoryProvider)(token);
  _abortCompleter = Completer<void>();
  try {
    await for (final progress in service.cloneRepository(
      repository: repository,
      branch: branch,
      targetDirectory: targetDirectory,
      abortTrigger: _abortCompleter?.future,
      isCancelled: () => _cancelled,
    )) {
      _emitProgress(progress, repository);
    }
  } catch (error) {
    state = CloneState(
      status: CloneStatus.error,
      errorMessage: error.toString(),
      repositoryName: repository,
    );
  } finally {
    service.dispose();
  }
}

Future<void> _runTermuxTask({
  required String token,
  required String repository,
  required String branch,
  required String targetDirectory,
}) async {
  final service = _ref.read(gitCloneServiceFactoryProvider)(token);
  try {
    await for (final progress in service.cloneViaTermux(
      repository: repository,
      branch: branch,
      targetDirectory: targetDirectory,
    )) {
      _emitProgress(progress, repository);
      if (_cancelled) {
        state = CloneState(
          status: CloneStatus.error,
          errorMessage: '已取消',
          repositoryName: repository,
        );
        return;
      }
    }
  } catch (error) {
    state = CloneState(
      status: CloneStatus.error,
      errorMessage: error.toString(),
      repositoryName: repository,
    );
  }
}

/// 把 CloneProgress 映射到 CloneState。
void _emitProgress(CloneProgress progress, String repository) {
  if (progress.phase == ClonePhase.done) {
    state = CloneState(
      status: CloneStatus.done,
      progress: progress,
      resultPath: progress.resultPath,
      repositoryName: repository,
    );
  } else if (progress.phase == ClonePhase.error) {
    state = CloneState(
      status: CloneStatus.error,
      progress: progress,
      errorMessage: progress.errorMessage,
      repositoryName: repository,
    );
  } else {
    state = state.copyWith(
      status: CloneStatus.running,
      progress: progress,
      repositoryName: repository,
    );
  }
}
```

- [ ] **步骤 4:运行测试验证通过**

运行:`cd mobile-app && flutter test test/core/github/clone_notifier_test.dart`
预期:PASS(6 个测试全过,含新增的 useTermux=true 测试)

- [ ] **步骤 5:Commit**

```bash
cd mobile-app
git add lib/core/github/clone_notifier.dart test/core/github/clone_notifier_test.dart
git commit -m "feat(mobile): CloneNotifier.startClone 增加 useTermux 参数分流到 GitCloneService"
```

---

### 任务 5:GitPlugin credential helper 注入

**文件:**
- 修改:`mobile-app/lib/core/agent/plugins/git_plugin.dart`
- 测试:`mobile-app/test/core/agent/git_plugin_credential_test.dart`(新建)

- [ ] **步骤 1:编写失败的测试**

创建 `mobile-app/test/core/agent/git_plugin_credential_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/plugins/git_plugin.dart';

void main() {
  group('defaultGitExecutor credential helper injection', () {
    test('injects credential helper for pull when token present', () async {
      final captured = <List<String>>[];
      final result = await defaultGitExecutor(
        'termux:git',
        ['pull', 'origin'],
        workingDirectory: '/tmp',
        environment: {'SPACECODE_GITHUB_TOKEN': 'tok123'},
        testExecutor: (args) async {
          captured.add(args);
          return const GitCommandResult(
            exitCode: 0,
            stdout: 'Already up to date',
            stderr: '',
            durationMs: 100,
          );
        },
      );

      expect(result.exitCode, 0);
      // 第一段 args 应是 -c credential.helper=...
      expect(captured, isNotEmpty);
      expect(captured.first[0], '-c');
      expect(captured.first[1], contains('credential.helper'));
      expect(captured.first[1], contains('tok123'));
      // 后续才是原命令 pull origin
      expect(captured.first[2], 'pull');
      expect(captured.first[3], 'origin');
    });

    test('does not inject for status command', () async {
      final captured = <List<String>>[];
      await defaultGitExecutor(
        'termux:git',
        ['status', '--porcelain'],
        workingDirectory: '/tmp',
        environment: {'SPACECODE_GITHUB_TOKEN': 'tok123'},
        testExecutor: (args) async {
          captured.add(args);
          return const GitCommandResult(
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 10,
          );
        },
      );

      expect(captured.first, ['status', '--porcelain']);
    });

    test('does not inject when token absent', () async {
      final captured = <List<String>>[];
      await defaultGitExecutor(
        'termux:git',
        ['pull', 'origin'],
        workingDirectory: '/tmp',
        environment: {},
        testExecutor: (args) async {
          captured.add(args);
          return const GitCommandResult(
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 10,
          );
        },
      );

      expect(captured.first, ['pull', 'origin']);
    });

    test('injects for push and fetch', () async {
      for (final cmd in ['push', 'fetch', 'ls-remote']) {
        final captured = <List<String>>[];
        await defaultGitExecutor(
          'termux:git',
          [cmd, 'origin'],
          workingDirectory: '/tmp',
          environment: {'SPACECODE_GITHUB_TOKEN': 'tok'},
          testExecutor: (args) async {
            captured.add(args);
            return const GitCommandResult(
              exitCode: 0,
              stdout: '',
              stderr: '',
              durationMs: 10,
            );
          },
        );
        expect(captured.first[0], '-c', reason: '$cmd should be injected');
      }
    });
  });
}
```

- [ ] **步骤 2:运行测试验证失败**

运行:`cd mobile-app && flutter test test/core/agent/git_plugin_credential_test.dart`
预期:FAIL,报错 `testExecutor` 参数不存在

- [ ] **步骤 3:修改 defaultGitExecutor 支持测试注入 + credential helper**

修改 `mobile-app/lib/core/agent/plugins/git_plugin.dart` 的 `defaultGitExecutor` 函数(替换第 44-91 行):

```dart
/// 默认执行器:调用 `gitPath args...`。
///
/// 当 `gitPath` 为 `termux:git` 时,通过 [TermuxBridge] 执行 git 命令。
/// 否则通过 [Process.run] 执行本地 git 二进制。
///
/// 对 `pull/push/fetch/ls-remote` 命令,若 environment 含
/// `SPACECODE_GITHUB_TOKEN`,注入临时 credential helper(token 不持久化)。
///
/// [testExecutor] 仅供测试注入,生产留空走默认路径。
Future<GitCommandResult> defaultGitExecutor(
  String gitPath,
  List<String> args, {
  required String workingDirectory,
  required Map<String, String> environment,
  Future<GitCommandResult> Function(List<String> effectiveArgs)? testExecutor,
}) async {
  // Termux 桥接模式
  if (gitPath == 'termux:git') {
    // 对需要认证的命令注入临时 credential helper
    const authCommands = ['pull', 'push', 'fetch', 'ls-remote'];
    final needsAuth = args.isNotEmpty && authCommands.contains(args.first);
    final token = environment['SPACECODE_GITHUB_TOKEN'];
    List<String> effectiveArgs = args;
    if (needsAuth && token != null && token.isNotEmpty) {
      // 临时 credential helper:命令结束后不留痕迹
      final helper = "!f(){ echo username=x-access-token; echo password=$token; }; f";
      effectiveArgs = ['-c', 'credential.helper=$helper', ...args];
    }
    debugPrint('[GitPlugin] Executing via Termux: git ${effectiveArgs.join(" ")}');

    // 测试注入路径
    if (testExecutor != null) {
      return testExecutor(effectiveArgs);
    }

    try {
      final result = await TermuxBridge.instance.runGit(
        args: effectiveArgs,
        workdir: workingDirectory,
        timeoutMs: 60000,
      );
      return GitCommandResult(
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      );
    } on PlatformException catch (e) {
      return GitCommandResult(
        exitCode: -1,
        stdout: '',
        stderr: 'Termux error: ${e.code} - ${e.message}',
        durationMs: 0,
      );
    }
  }

  // 本地二进制模式
  if (testExecutor != null) {
    return testExecutor(args);
  }
  final sw = Stopwatch()..start();
  final result = await Process.run(
    gitPath,
    args,
    workingDirectory: workingDirectory,
    environment: environment,
    stdoutEncoding: utf8,
    stderrEncoding: utf8,
  );
  return GitCommandResult(
    exitCode: result.exitCode,
    stdout: result.stdout as String? ?? '',
    stderr: result.stderr as String? ?? '',
    durationMs: sw.elapsedMilliseconds,
  );
}
```

- [ ] **步骤 4:运行测试验证通过**

运行:`cd mobile-app && flutter test test/core/agent/git_plugin_credential_test.dart`
预期:PASS(4 个测试全过)

- [ ] **步骤 5:运行现有 GitPlugin 测试确认无回归**

运行:`cd mobile-app && flutter test test/core/agent/`
预期:PASS

- [ ] **步骤 6:Commit**

```bash
cd mobile-app
git add lib/core/agent/plugins/git_plugin.dart test/core/agent/git_plugin_credential_test.dart
git commit -m "feat(mobile): GitPlugin 对 pull/push/fetch 注入临时 credential helper(token 不持久化)"
```

---

### 任务 6:main.dart 启动时用 TermuxReadinessChecker

**文件:**
- 修改:`mobile-app/lib/main.dart`

- [ ] **步骤 1:修改 main.dart**

修改 `mobile-app/lib/main.dart` 第 27-33 行,把 `TermuxBridge.instance.checkInstalled()` 替换为 `TermuxReadinessChecker().check()`:

```dart
import 'core/agent/termux_readiness_checker.dart';
```

(在现有 import 区添加)

替换第 27-33 行:

```dart
    // 检测 Termux 就绪状态,写入 BinaryResolver
    final readiness = await TermuxReadinessChecker().check();
    debugPrint('[Termux] readiness = $readiness');
    if (readiness == TermuxReadiness.ready) {
      BinaryResolver.instance.setTermuxReadiness(TermuxReadiness.ready);
      debugPrint('[Termux] ready, gitPath=${BinaryResolver.instance.gitPath}');
    } else {
      BinaryResolver.instance.setTermuxReadiness(readiness);
    }
```

删除原 `import 'core/agent/termux_bridge.dart';`(不再直接用,但保留 `binary_resolver.dart` import)。注意 `termux_bridge.dart` 可能被 `TermuxReadinessChecker` 间接使用,但 main.dart 自身不再需要。保留 import 无害,但为整洁可删除。

- [ ] **步骤 2:运行 main 相关测试(若有)**

运行:`cd mobile-app && flutter test`
预期:PASS(无针对 main.dart 的单元测试,主要验证不破坏其他测试)

- [ ] **步骤 3:Commit**

```bash
cd mobile-app
git add lib/main.dart
git commit -m "refactor(mobile): main.dart 启动时用 TermuxReadinessChecker 替代 checkInstalled"
```

---

### 任务 7:设置页「Termux 环境」卡片

**文件:**
- 修改:`mobile-app/lib/features/settings/settings_screen.dart`

- [ ] **步骤 1:添加 import 与 state 字段**

在 `mobile-app/lib/features/settings/settings_screen.dart` 顶部 import 区添加:

```dart
import '../../core/agent/binary_resolver.dart';
import '../../core/agent/termux_readiness_checker.dart';
```

在 `_SettingsScreenState` 类的字段区(第 96 行 `_version = '';` 后)添加:

```dart
TermuxReadiness _termuxReadiness = TermuxReadiness.notInstalled;
final ScrollController _scrollController = ScrollController();
final GlobalKey _termuxCardKey = GlobalKey();
```

- [ ] **步骤 2:在 _loadPrefs 中加载 Termux 状态**

修改 `_loadPrefs` 方法,在 `final packageInfo = ...` 后、`if (!mounted) return;` 前添加:

```dart
    final readiness = await TermuxReadinessChecker().check();
    BinaryResolver.instance.setTermuxReadiness(readiness);
```

在 `setState(() { ... })` 内添加:

```dart
      _termuxReadiness = readiness;
```

- [ ] **步骤 3:在 build 方法的 ListView 中插入 Termux 卡片**

修改 `build` 方法,在 `// Github 分组` 注释前(第 223 行 `_sectionTitle('Github'),` 之前)插入:

```dart
          // Termux 环境分组
          _sectionTitle('Termux 环境'),
          _termuxCard(theme),
```

- [ ] **步骤 4:实现 _termuxCard 方法**

在 `_SettingsScreenState` 类中(`_githubCard` 方法前)添加:

```dart
  // --- Termux 环境卡片 ---

  Widget _termuxCard(ThemeData theme) {
    return Container(
      key: _termuxCardKey,
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.cardColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 状态行
          Row(
            children: [
              _termuxStatusIcon(_termuxReadiness, theme),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _termuxStatusLabel(_termuxReadiness),
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: theme.colorScheme.onSurface,
                  ),
                ),
              ),
            ],
          ),
          // 配置引导(installedNoGit 时显示)
          if (_termuxReadiness != TermuxReadiness.ready) ...[
            const SizedBox(height: 12),
            Text(
              _termuxReadiness == TermuxReadiness.notInstalled
                  ? '请从 F-Droid 安装 Termux(Google Play 版已停止更新),安装后点「重新检测」'
                  : '请在 Termux 中执行以下配置:',
              style: TextStyle(
                fontSize: 12,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              ),
            ),
            if (_termuxReadiness == TermuxReadiness.installedNoGit) ...[
              const SizedBox(height: 8),
              _termuxConfigStep(theme, '1', 'pkg install git'),
              _termuxConfigStep(theme, '2', '编辑 ~/.termux/termux.properties,添加 allow-external-apps=true'),
              _termuxConfigStep(theme, '3', 'termux-setup-storage(授权共享存储)'),
              _termuxConfigStep(theme, '4', 'termux-reload-settings'),
            ],
          ],
          const SizedBox(height: 12),
          // 重新检测按钮
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _recheckTermux,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('重新检测'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 10),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _termuxStatusIcon(TermuxReadiness readiness, ThemeData theme) {
    switch (readiness) {
      case TermuxReadiness.ready:
        return const Icon(Icons.check_circle_rounded, color: Color(0xff5db872), size: 18);
      case TermuxReadiness.installedNoGit:
        return const Icon(Icons.warning_rounded, color: Color(0xffd4a017), size: 18);
      case TermuxReadiness.notInstalled:
        return const Icon(Icons.cancel_rounded, color: Color(0xffc64545), size: 18);
    }
  }

  String _termuxStatusLabel(TermuxReadiness readiness) {
    switch (readiness) {
      case TermuxReadiness.ready:
        return 'Termux 环境就绪,支持完整 git 操作';
      case TermuxReadiness.installedNoGit:
        return 'Termux 已安装,但 Git 未就绪';
      case TermuxReadiness.notInstalled:
        return 'Termux 未安装';
    }
  }

  Widget _termuxConfigStep(ThemeData theme, String num, String cmd) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 18,
            height: 18,
            margin: const EdgeInsets.only(top: 2),
            decoration: BoxDecoration(
              color: theme.colorScheme.primary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Text(
                num,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.primary,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: SelectableText(
              cmd,
              style: TextStyle(
                fontSize: 12,
                fontFamily: 'monospace',
                color: theme.colorScheme.onSurface.withValues(alpha: 0.8),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _recheckTermux() async {
    final readiness = await TermuxReadinessChecker().check();
    BinaryResolver.instance.setTermuxReadiness(readiness);
    if (mounted) {
      setState(() => _termuxReadiness = readiness);
      final msg = readiness == TermuxReadiness.ready
          ? 'Termux 环境就绪'
          : readiness == TermuxReadiness.installedNoGit
              ? 'Termux 已安装但 Git 未就绪,请按提示配置'
              : 'Termux 未安装';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  void _scrollToTermuxCard() {
    final ctx = _termuxCardKey.currentContext;
    if (ctx != null) {
      Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 400));
    }
  }
```

- [ ] **步骤 5:运行 widget 测试确认无语法错误**

运行:`cd mobile-app && flutter test test/features/`
预期:PASS(若无 features 测试目录,跳过;主要靠 `flutter analyze`)

运行:`cd mobile-app && flutter analyze lib/features/settings/settings_screen.dart`
预期:无 error

- [ ] **步骤 6:Commit**

```bash
cd mobile-app
git add lib/features/settings/settings_screen.dart
git commit -m "feat(mobile): 设置页新增 Termux 环境引导卡片(三态展示+配置步骤+重新检测)"
```

---

### 任务 8:_cloneGithubRepository 二选一弹窗 + 调用 useTermux

**文件:**
- 修改:`mobile-app/lib/features/settings/settings_screen.dart`

- [ ] **步骤 1:修改 _cloneGithubRepository 方法**

修改 `mobile-app/lib/features/settings/settings_screen.dart` 的 `_cloneGithubRepository` 方法。在「若已存在则先清空」之后(第 1034 行后)、`await ref.read(cloneProvider.notifier).startClone(...)` 之前(第 1038 行前)插入二选一弹窗逻辑:

把原第 1036-1048 行:

```dart
      // 交给后台 CloneNotifier,立即返回(不阻塞 UI)
      try {
        await ref.read(cloneProvider.notifier).startClone(
              repository: repo.fullName,
              branch: branch,
              targetDirectory: actualTarget,
            );
      } on StateError catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(error.message)));
        }
      }
```

替换为:

```dart
      // 二选一弹窗:Termux 未就绪时让用户选择安装 Termux 或降级 zipball
      final readiness = BinaryResolver.instance.termuxReadiness;
      var useTermux = readiness == TermuxReadiness.ready;
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
          _scrollToTermuxCard();
          return;
        }
        if (choice != _CloneFallbackChoice.zipballOnly) return; // 用户取消
      }

      // 交给后台 CloneNotifier,立即返回(不阻塞 UI)
      try {
        await ref.read(cloneProvider.notifier).startClone(
              repository: repo.fullName,
              branch: branch,
              targetDirectory: actualTarget,
              useTermux: useTermux,
            );
      } on StateError catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(error.message)));
        }
      }
```

- [ ] **步骤 2:在文件末尾(_CloneTaskCard 类之后)新增枚举**

在文件最末尾添加:

```dart
/// _cloneGithubRepository 二选一弹窗的选项。
enum _CloneFallbackChoice {
  installTermux,
  zipballOnly,
}
```

- [ ] **步骤 3:运行 analyze 确认无错误**

运行:`cd mobile-app && flutter analyze lib/features/settings/settings_screen.dart`
预期:无 error

- [ ] **步骤 4:Commit**

```bash
cd mobile-app
git add lib/features/settings/settings_screen.dart
git commit -m "feat(mobile): clone 前置二选一弹窗(Termux 未就绪时引导安装或降级 zipball)"
```

---

### 任务 9:全量测试与回归验证

**文件:** 无修改

- [ ] **步骤 1:运行 mobile-app 全量测试**

运行:`cd mobile-app && flutter test`
预期:所有测试 PASS。若有失败,记录失败测试名与原因。

- [ ] **步骤 2:运行 flutter analyze 全量**

运行:`cd mobile-app && flutter analyze`
预期:无 error,warning 可接受但应记录。

- [ ] **步骤 3:检查未提交改动**

运行:`cd mobile-app && git status`
预期:working tree clean(所有改动已 commit)。若有未提交,补 commit。

- [ ] **步骤 4:验证 BinaryResolver. termuxReady getter 删除无回归**

搜索 `termuxReady` 在 mobile-app 中的引用:

运行(用 Grep 工具):pattern=`termuxReady`,path=`d:\AI\SpaceCode\mobile-app`
预期:无引用(任务 1 删除了 getter,任务 6 修改了 main.dart 不再用)。若有引用,修复。

- [ ] **步骤 5:Commit 最终验证记录(可选)**

若步骤 1-4 发现并修复了回归,最终 commit:

```bash
cd mobile-app
git add -A
git commit -m "test(mobile): 修复真 git clone 实现的测试回归"
```

---

## 自检清单

**规格覆盖度:**
- §2 目标「主路径真 git clone」→ 任务 3 (GitCloneService) ✓
- §2 目标「降级路径二选一弹窗」→ 任务 8 ✓
- §2 目标「Termux 引导 UI」→ 任务 7 ✓
- §2 目标「认证 URL 嵌 token + 清除」→ 任务 3 (GitCloneService.set-url) + 任务 5 (credential helper) ✓
- §2 目标「进度反馈」→ 任务 3 (四段阶段进度) ✓ (采用 §6.1 降级路径,非 EventChannel)
- §5.1 TermuxReadinessChecker → 任务 2 ✓
- §5.2 TermuxBridge.runCommandStream → **未实现**(规格 §6.1 明确降级,采用四段方案,无需流式)
- §5.3 GitCloneService → 任务 3 ✓ (实现为四段,非单条 git clone 命令)
- §5.4 CloneNotifier 改造 → 任务 4 ✓
- §5.5 GitPlugin credential helper → 任务 5 ✓
- §5.6 设置页 Termux 卡片 → 任务 7 ✓
- §5.7 _cloneGithubRepository 二选一弹窗 → 任务 8 ✓
- §6.1 Android 端 TermuxStreamBridge → **未实现**(降级路径无需改 Android)
- §7 测试策略 → 任务 1-5 的测试覆盖单元测试,Widget 测试见任务 7/8 的 analyze 验证

**占位符扫描:** 无 TODO / 待定 / "类似任务 N" 引用。每个代码步骤都有完整代码块。

**类型一致性:**
- `TermuxReadiness` 枚举值(notInstalled/installedNoGit/ready)在任务 1、2、6、7、8 中一致 ✓
- `GitCloneService.cloneViaTermux` 签名(repository/branch/targetDirectory)在任务 3、4 一致 ✓
- `CloneNotifier.startClone` 签名含 `useTermux` 在任务 4、8 一致 ✓
- `defaultGitExecutor` 的 `testExecutor` 参数在任务 5 测试与实现一致 ✓
- `TermuxBridge.forTesting()` 构造在任务 2、3 的测试 fake 中使用 ✓

**风险点:**
- 任务 1 删除 `termuxReady` getter 可能影响其他文件 —— 任务 9 步骤 4 显式验证
- 任务 4 改 `startClone` 签名是 breaking change,所有调用方需同步 —— 仅 `settings_screen.dart` 一处调用,任务 8 同步更新
- Termux `runGit` 的 `args` 参数类型 `List<String>` 在 fake 中需匹配 —— 任务 2、3 的 fake 已对齐
