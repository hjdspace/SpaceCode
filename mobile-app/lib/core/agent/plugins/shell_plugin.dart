import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../agent_model.dart';
import '../agent_plugin.dart';
import '../agent_types.dart';
import '../binary_resolver.dart';
import '../termux_bridge.dart';

/// Shell 命令执行结果（executor 返回给 ShellPlugin）。
class ShellCommandResult {
  final int exitCode;
  final String stdout;
  final String stderr;
  final int durationMs;
  final bool timedOut;
  final bool cancelled;

  const ShellCommandResult({
    required this.exitCode,
    required this.stdout,
    required this.stderr,
    this.durationMs = 0,
    this.timedOut = false,
    this.cancelled = false,
  });
}

/// 命令执行器函数类型。
///
/// 接收 [command] 和 [timeout]，返回 [ShellCommandResult]。
/// 实现需自行处理 cancellationToken（取消时 kill 进程）和 timeout（超时 kill 进程）。
typedef ShellExecutor = Future<ShellCommandResult> Function(
  String command,
  Duration timeout,
);

/// 默认执行器：调用 `sh -c command`，处理超时和取消。
///
/// 在 Android 上通过 BinaryResolver.environment 配置 PATH，
/// 工作目录固定在 [workingDirectory]。
///
/// 当 [BinaryResolver.termuxReady] 为 true 时（即 Termux 已安装并通过桥接可用），
/// 命令会通过 [TermuxBridge] 在 Termux 环境中执行，从而支持 git 等工具。
Future<ShellCommandResult> defaultShellExecutor({
  required String command,
  required String workingDirectory,
  required Map<String, String> environment,
  required Duration timeout,
  required AgentCancellationToken cancellationToken,
}) async {
  // Termux 桥接模式：通过 Termux 执行 shell 命令
  if (BinaryResolver.instance.termuxReadiness == TermuxReadiness.ready) {
    debugPrint('[ShellPlugin] Executing via Termux: $command');
    return _runViaTermux(
      command: command,
      workingDirectory: workingDirectory,
      timeout: timeout,
      cancellationToken: cancellationToken,
    );
  }

  final sw = Stopwatch()..start();
  Process? process;
  try {
    process = await Process.start(
      'sh',
      ['-c', command],
      workingDirectory: workingDirectory,
      environment: environment,
      runInShell: false,
    );
  } catch (error) {
    return ShellCommandResult(
      exitCode: -1,
      stdout: '',
      stderr: 'Failed to start process: $error',
      durationMs: sw.elapsedMilliseconds,
    );
  }

  final stdoutBuffer = StringBuffer();
  final stderrBuffer = StringBuffer();
  final stdoutSub = process.stdout
      .transform(utf8.decoder)
      .listen(stdoutBuffer.write);
  final stderrSub = process.stderr
      .transform(utf8.decoder)
      .listen(stderrBuffer.write);

  final exitCompleter = Completer<int>();
  process.exitCode.then(exitCompleter.complete);

  bool timedOut = false;
  bool cancelled = false;

  Future.delayed(timeout, () {
    if (!exitCompleter.isCompleted) {
      timedOut = true;
      process?.kill(ProcessSignal.sigkill);
    }
  });

  cancellationToken.whenCancelled.then((_) {
    if (!exitCompleter.isCompleted) {
      cancelled = true;
      process?.kill(ProcessSignal.sigkill);
    }
  });

  final exitCode = await exitCompleter.future;
  await stdoutSub.cancel();
  await stderrSub.cancel();
  return ShellCommandResult(
    exitCode: exitCode,
    stdout: stdoutBuffer.toString(),
    stderr: stderrBuffer.toString(),
    durationMs: sw.elapsedMilliseconds,
    timedOut: timedOut,
    cancelled: cancelled,
  );
}

/// 通过 Termux 桥接执行 shell 命令。
///
/// 命令通过 `sh -c <command>` 在 Termux 环境中执行，工作目录透传给 Termux。
/// Termux 内部自带超时处理，这里再叠加 [cancellationToken] 响应：
/// 一旦取消，立即返回 cancelled 结果（Termux 后台进程可能仍在运行，但 Flutter 端不再等待）。
Future<ShellCommandResult> _runViaTermux({
  required String command,
  required String workingDirectory,
  required Duration timeout,
  required AgentCancellationToken cancellationToken,
}) async {
  if (cancellationToken.isCancelled) {
    return const ShellCommandResult(
      exitCode: -1,
      stdout: '',
      stderr: 'Command cancelled',
      cancelled: true,
    );
  }

  final sw = Stopwatch()..start();
  final runFuture = TermuxBridge.instance.runCommand(
    command: 'sh',
    args: ['-c', command],
    workdir: workingDirectory,
    timeoutMs: timeout.inMilliseconds,
  );

  // 监听取消信号：一旦取消，立即返回 cancelled 结果
  // （Termux 端进程无法通过 RunCommandService 主动 kill，但用户感知上已取消）
  final cancelFuture = cancellationToken.whenCancelled.then((_) => true);

  try {
    final result = await Future.any([
      runFuture.then((r) => _TermuxOutcome(r, false)),
      cancelFuture.then((_) => const _TermuxOutcome(null, true)),
    ]);
    sw.stop();
    if (result.cancelled) {
      return ShellCommandResult(
        exitCode: -1,
        stdout: '',
        stderr: 'Command cancelled',
        durationMs: sw.elapsedMilliseconds,
        cancelled: true,
      );
    }
    final r = result.result!;
    return ShellCommandResult(
      exitCode: r.exitCode,
      stdout: r.stdout,
      stderr: r.stderr,
      durationMs: r.durationMs,
    );
  } on PlatformException catch (e) {
    sw.stop();
    return ShellCommandResult(
      exitCode: -1,
      stdout: '',
      stderr: 'Termux error: ${e.code} - ${e.message}',
      durationMs: sw.elapsedMilliseconds,
    );
  }
}

class _TermuxOutcome {
  final TermuxResult? result;
  final bool cancelled;
  const _TermuxOutcome(this.result, this.cancelled);
}

/// 提供 `run_command` 工具，在 workspace 目录下执行 shell 命令。
///
/// 设计：
/// - 工作目录固定在 [workingDirectory]（由 WorkspacePlugin 提供）
/// - 环境变量来自 [environment]（由 BinaryResolver 构建）
/// - 执行模式 sequential（避免并行 sh 互相干扰）
/// - stdout/stderr 各最大 50KB，超出尾部截断并置 truncated: true
/// - timeout_ms 限制在 [1000, 120000] 范围
class ShellPlugin extends AgentPlugin {
  final String workingDirectory;
  final Map<String, String> environment;
  final ShellExecutor executor;

  ShellPlugin({
    required this.workingDirectory,
    required this.environment,
    AgentCancellationToken? cancellationToken,
  }) : executor = ((command, timeout) => defaultShellExecutor(
              command: command,
              workingDirectory: workingDirectory,
              environment: environment,
              timeout: timeout,
              cancellationToken:
                  cancellationToken ?? AgentCancellationToken(),
            ));

  @visibleForTesting
  ShellPlugin.forTest({
    required this.workingDirectory,
    required this.environment,
    required this.executor,
  });

  static const int _maxFieldBytes = 50 * 1024;
  static const int _minTimeoutMs = 1000;
  static const int _maxTimeoutMs = 120000;
  static const int _defaultTimeoutMs = 30000;

  @override
  List<AgentTool> createTools() => [_RunCommandTool(this)];
}

class _RunCommandTool extends AgentTool {
  final ShellPlugin plugin;

  _RunCommandTool(this.plugin);

  @override
  AgentToolExecutionMode get executionMode =>
      AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'run_command',
        description: '在 workspace 目录下执行 shell 命令。'
            '可用命令包括 ls/cat/grep/find/awk/sed/wc/sort/uniq/head/tail/'
            'diff/tree/du/stat 等。禁止使用 rm -rf、sudo、chmod 777 等危险操作。',
        inputSchema: {
          'type': 'object',
          'properties': {
            'command': {
              'type': 'string',
              'description': '完整的 shell 命令行',
            },
            'timeout_ms': {
              'type': 'integer',
              'description': '超时毫秒，默认 30000，最大 120000',
              'default': 30000,
            },
          },
          'required': ['command'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    cancellationToken.throwIfCancelled();

    final command = arguments['command'] as String? ?? '';
    if (command.trim().isEmpty) {
      return const AgentToolResult(
        content: 'command must not be empty',
        isError: true,
      );
    }

    final rawTimeout =
        arguments['timeout_ms'] as int? ?? ShellPlugin._defaultTimeoutMs;
    final clampedTimeout = rawTimeout
        .clamp(ShellPlugin._minTimeoutMs, ShellPlugin._maxTimeoutMs);
    final timeout = Duration(milliseconds: clampedTimeout);

    final ShellCommandResult result;
    try {
      result = await plugin.executor(command, timeout);
    } catch (error) {
      return AgentToolResult(
        content: jsonEncode({
          'error': 'Executor failed: $error',
          'exit_code': -1,
        }),
        isError: true,
      );
    }

    if (result.cancelled) {
      return AgentToolResult(
        content: jsonEncode({
          'exit_code': -1,
          'stderr': 'Command cancelled',
          'duration_ms': result.durationMs,
        }),
        isError: true,
      );
    }

    if (result.timedOut) {
      final truncatedStdout = _truncate(result.stdout);
      return AgentToolResult(
        content: jsonEncode({
          'exit_code': -1,
          'stderr': 'Command timed out after ${timeout.inMilliseconds}ms',
          'partial_stdout': truncatedStdout.value,
          'truncated': truncatedStdout.truncated,
          'duration_ms': result.durationMs,
        }),
        isError: true,
      );
    }

    final truncatedStdout = _truncate(result.stdout);
    final truncatedStderr = _truncate(result.stderr);
    final isError = result.exitCode != 0;
    return AgentToolResult(
      content: jsonEncode({
        'exit_code': result.exitCode,
        'stdout': truncatedStdout.value,
        'stderr': truncatedStderr.value,
        'duration_ms': result.durationMs,
        'truncated': truncatedStdout.truncated || truncatedStderr.truncated,
      }),
      isError: isError,
    );
  }

  _TruncatedField _truncate(String field) {
    if (field.length <= ShellPlugin._maxFieldBytes) {
      return _TruncatedField(field, false);
    }
    final truncated = field.substring(0, ShellPlugin._maxFieldBytes);
    return _TruncatedField(truncated, true);
  }
}

class _TruncatedField {
  final String value;
  final bool truncated;
  const _TruncatedField(this.value, this.truncated);
}
