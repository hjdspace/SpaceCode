import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Termux 命令执行结果。
class TermuxResult {
  final int exitCode;
  final String stdout;
  final String stderr;
  final int durationMs;

  const TermuxResult({
    required this.exitCode,
    required this.stdout,
    required this.stderr,
    required this.durationMs,
  });

  factory TermuxResult.fromMap(Map<String, dynamic> map, int durationMs) {
    return TermuxResult(
      exitCode: map['exitCode'] as int? ?? -1,
      stdout: map['stdout'] as String? ?? '',
      stderr: map['stderr'] as String? ?? '',
      durationMs: durationMs,
    );
  }
}

/// Termux 桥接单例。
///
/// 通过 MethodChannel `spacecode/termux` 与 Android 端 `TermuxBridge` 通信，
/// 检测 Termux 是否安装并执行命令。
///
/// 前置条件（用户侧）：
/// 1. 安装 Termux（F-Droid 版本推荐）
/// 2. 在 Termux 中安装 git：`pkg install git`
/// 3. 编辑 `~/.termux/termux.properties`，添加 `allow-external-apps=true`
/// 4. 重启 Termux：`termux-reload-settings`
class TermuxBridge {
  static final TermuxBridge instance = TermuxBridge._();

  TermuxBridge._();

  /// 测试用公开构造函数。
  @visibleForTesting
  TermuxBridge.forTesting() : this._();

  static const _channel = MethodChannel('spacecode/termux');

  bool _installed = false;
  bool _checked = false;

  /// Termux 是否已安装。
  ///
  /// 调用 [checkInstalled] 后才有意义；未检查前返回 false。
  bool get isInstalled => _installed;

  /// 是否已执行过安装检测。
  bool get isChecked => _checked;

  /// 检测 Termux 是否安装。
  ///
  /// 在非 Android 平台始终返回 false。
  Future<bool> checkInstalled() async {
    if (!Platform.isAndroid) {
      _installed = false;
      _checked = true;
      return false;
    }
    try {
      final result = await _channel.invokeMethod<bool>('isInstalled');
      _installed = result ?? false;
    } on PlatformException {
      _installed = false;
    } on MissingPluginException {
      _installed = false;
    }
    _checked = true;
    return _installed;
  }

  /// 通过 Termux 执行命令。
  ///
  /// [command] 可以是命令名（如 `git`）或绝对路径。
  /// 若为命令名，Android 端会自动拼接 `/data/data/com.termux/files/usr/bin/{command}`。
  ///
  /// [args] 为命令参数列表。
  /// [workdir] 为工作目录（可选）。
  /// [timeoutMs] 为超时时间，默认 30 秒。
  ///
  /// 抛出 [PlatformException] 的可能 error codes：
  /// - `TERMUX_NOT_INSTALLED`：Termux 未安装
  /// - `START_FAILED`：无法启动 Termux 服务（通常未配置 allow-external-apps）
  /// - `TIMEOUT`：命令执行超时
  /// - `TERMUX_ERROR`：Termux 内部错误
  Future<TermuxResult> runCommand({
    required String command,
    List<String> args = const [],
    String? workdir,
    int timeoutMs = 30000,
  }) async {
    if (!Platform.isAndroid) {
      throw PlatformException(
        code: 'NOT_ANDROID',
        message: 'Termux bridge is only available on Android',
      );
    }

    final sw = Stopwatch()..start();
    try {
      final result = await _channel.invokeMethod<Map>('runCommand', {
        'command': command,
        'args': args,
        'workdir': workdir,
        'timeoutMs': timeoutMs,
      });
      sw.stop();
      if (result == null) {
        return TermuxResult(
          exitCode: -1,
          stdout: '',
          stderr: 'No result from Termux',
          durationMs: sw.elapsedMilliseconds,
        );
      }
      return TermuxResult.fromMap(
        result.cast<String, dynamic>(),
        sw.elapsedMilliseconds,
      );
    } on PlatformException {
      sw.stop();
      rethrow;
    }
  }

  /// 便捷方法：执行 git 命令。
  ///
  /// 自动拼接 `git` 前缀 + 参数，设置工作目录。
  Future<TermuxResult> runGit({
    required List<String> args,
    String? workdir,
    int timeoutMs = 30000,
  }) {
    return runCommand(
      command: 'git',
      args: args,
      workdir: workdir,
      timeoutMs: timeoutMs,
    );
  }
}
