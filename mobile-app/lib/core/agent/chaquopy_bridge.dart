import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';

import 'binary_resolver.dart';
import 'python_sandbox.dart';

/// Python 执行结果。
class PythonRunResult {
  final int exitCode;
  final String stdout;
  final String stderr;
  final int durationMs;
  final bool timedOut;

  const PythonRunResult({
    required this.exitCode,
    required this.stdout,
    required this.stderr,
    this.durationMs = 0,
    this.timedOut = false,
  });

  bool get isSuccess => exitCode == 0 && !timedOut;
}

/// Chaquopy 桥接器：通过 MethodChannel 与 Android 端 Chaquopy 通信。
///
/// Android 端需实现以下 MethodChannel 方法（channel: `spacecode/python`）：
/// - `init`：初始化 Chaquopy Python 实例，写入 sitecustomize.py
/// - `runCode`：执行 Python 代码，返回 {exit_code, stdout, stderr, duration_ms}
/// - `runFile`：执行 Python 文件，返回同上
/// - `isReady`：检查 Chaquopy 是否已初始化
///
/// 在非 Android 平台或 Chaquopy 未集成时，[isReady] 返回 false，
/// PythonPlugin 不会加载。
class ChaquopyBridge {
  static const _channel = MethodChannel('spacecode/python');

  static final ChaquopyBridge instance = ChaquopyBridge._();
  ChaquopyBridge._();

  bool _initialized = false;

  /// 初始化 Chaquopy Python 环境。
  ///
  /// 通过 MethodChannel 调用 Android 端 `init` 方法：
  /// 1. 创建 Python.getInstance()
  /// 2. 写入 sitecustomize.py 到 Python 临时目录
  /// 3. 返回是否成功
  ///
  /// 成功后标记 [BinaryResolver.pythonReady]。
  Future<bool> initialize({
    BinaryResolver? resolver,
    Future<Directory> Function()? docsDirectoryProvider,
  }) async {
    if (!Platform.isAndroid) {
      // 非 Android 平台不支持 Chaquopy
      return false;
    }

    try {
      final result = await _channel.invokeMethod<bool>('init', {
        'sitecustomize': PythonSandboxConfig.sitecustomizeContent,
      });
      _initialized = result ?? false;
      if (_initialized) {
        (resolver ?? BinaryResolver.instance).markPythonReady();
      }
      return _initialized;
    } on PlatformException {
      // Chaquopy 未集成或初始化失败
      _initialized = false;
      return false;
    } on MissingPluginException {
      // MethodChannel 未注册（Android 端未实现）
      _initialized = false;
      return false;
    }
  }

  /// 检查 Chaquopy 是否就绪。
  Future<bool> isReady() async {
    if (!Platform.isAndroid) return false;
    if (_initialized) return true;
    try {
      final result = await _channel.invokeMethod<bool>('isReady');
      _initialized = result ?? false;
      return _initialized;
    } catch (_) {
      return false;
    }
  }

  /// 执行 Python 代码。
  ///
  /// [code]：Python 代码字符串
  /// [args]：命令行参数（sys.argv）
  /// [stdin]：标准输入
  /// [timeoutMs]：超时毫秒
  Future<PythonRunResult> runCode({
    required String code,
    List<String> args = const [],
    String? stdin,
    required int timeoutMs,
  }) async {
    final sw = Stopwatch()..start();
    try {
      final result = await _channel.invokeMethod<Map>('runCode', {
        'code': code,
        'args': args,
        'stdin': stdin ?? '',
        'timeout_ms': timeoutMs,
      });
      sw.stop();
      if (result == null) {
        return PythonRunResult(
          exitCode: -1,
          stdout: '',
          stderr: 'No response from Chaquopy bridge',
          durationMs: sw.elapsedMilliseconds,
        );
      }
      return PythonRunResult(
        exitCode: (result['exit_code'] as num?)?.toInt() ?? -1,
        stdout: (result['stdout'] as String?) ?? '',
        stderr: (result['stderr'] as String?) ?? '',
        durationMs: (result['duration_ms'] as num?)?.toInt() ??
            sw.elapsedMilliseconds,
        timedOut: (result['timed_out'] as bool?) ?? false,
      );
    } on PlatformException catch (e) {
      return PythonRunResult(
        exitCode: -1,
        stdout: '',
        stderr: 'Chaquopy error: ${e.message ?? e.code}',
        durationMs: sw.elapsedMilliseconds,
      );
    }
  }

  /// 执行 Python 文件。
  ///
  /// [filePath]：Python 文件路径（在工作目录内）
  /// [args]：命令行参数
  /// [stdin]：标准输入
  /// [timeoutMs]：超时毫秒
  Future<PythonRunResult> runFile({
    required String filePath,
    List<String> args = const [],
    String? stdin,
    required int timeoutMs,
  }) async {
    final sw = Stopwatch()..start();
    try {
      final result = await _channel.invokeMethod<Map>('runFile', {
        'file_path': filePath,
        'args': args,
        'stdin': stdin ?? '',
        'timeout_ms': timeoutMs,
      });
      sw.stop();
      if (result == null) {
        return PythonRunResult(
          exitCode: -1,
          stdout: '',
          stderr: 'No response from Chaquopy bridge',
          durationMs: sw.elapsedMilliseconds,
        );
      }
      return PythonRunResult(
        exitCode: (result['exit_code'] as num?)?.toInt() ?? -1,
        stdout: (result['stdout'] as String?) ?? '',
        stderr: (result['stderr'] as String?) ?? '',
        durationMs: (result['duration_ms'] as num?)?.toInt() ??
            sw.elapsedMilliseconds,
        timedOut: (result['timed_out'] as bool?) ?? false,
      );
    } on PlatformException catch (e) {
      return PythonRunResult(
        exitCode: -1,
        stdout: '',
        stderr: 'Chaquopy error: ${e.message ?? e.code}',
        durationMs: sw.elapsedMilliseconds,
      );
    }
  }
}
