import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

/// 终端输出事件类型。
enum TerminalOutputType { stdout, stderr, exit }

/// 终端输出事件。
class TerminalOutput {
  final TerminalOutputType type;
  final String text;
  final int? exitCode;
  final int durationMs;

  const TerminalOutput.stdout(this.text)
      : type = TerminalOutputType.stdout,
        exitCode = null,
        durationMs = 0;

  const TerminalOutput.stderr(this.text)
      : type = TerminalOutputType.stderr,
        exitCode = null,
        durationMs = 0;

  const TerminalOutput.exit(this.exitCode, this.durationMs)
      : type = TerminalOutputType.exit,
        text = '';
}

/// 进程启动器函数类型（可注入用于测试）。
typedef ProcessStarter = Future<Process> Function({
  required String command,
  required String workingDirectory,
  required Map<String, String> environment,
});

/// 默认进程启动器：调用 `sh -c command`。
Future<Process> defaultProcessStarter({
  required String command,
  required String workingDirectory,
  required Map<String, String> environment,
}) async {
  return Process.start(
    'sh',
    ['-c', command],
    workingDirectory: workingDirectory,
    environment: environment,
    runInShell: false,
  );
}

/// 交互式终端会话。
///
/// 独立于 Agent 工具链（不走 AgentToolRegistry）：
/// - 用户在 TerminalScreen 输入命令 → execute() 启动子进程
/// - stdout/stderr 流式输出到 [output] Stream
/// - 进程退出后推送 TerminalOutput.exit 事件
/// - [interrupt] 发送 SIGINT 中断当前命令
/// - [dispose] 关闭会话，kill 进程并关闭输出流
class TerminalSession {
  final String workingDirectory;
  final Map<String, String> environment;
  final ProcessStarter processStarter;

  TerminalSession({
    required this.workingDirectory,
    required this.environment,
    ProcessStarter? processStarter,
  }) : processStarter = processStarter ?? defaultProcessStarter;

  Process? _process;
  StreamSubscription<String>? _stdoutSub;
  StreamSubscription<String>? _stderrSub;
  final _outputController =
      StreamController<TerminalOutput>.broadcast(sync: true);
  final Completer<int> _exitCompleter = Completer<int>();
  Stopwatch? _stopwatch;
  bool _disposed = false;

  Stream<TerminalOutput> get output => _outputController.stream;
  Future<int> get exitCode => _exitCompleter.future;
  bool get isRunning => _process != null && !_exitCompleter.isCompleted;

  void _emit(TerminalOutput event) {
    if (_disposed) return;
    if (_outputController.isClosed) return;
    _outputController.add(event);
  }

  /// 测试用：暴露内部 controller 状态。
  @visibleForTesting
  StreamController<TerminalOutput> get outputController =>
      _outputController;

  /// 执行一条 shell 命令。
  ///
  /// 同一时刻只能运行一条命令；若已有命令在运行，调用会抛 [StateError]。
  /// 命令完成后（无论成功失败）[exitCode] 可用。
  Future<void> execute(String command) async {
    if (isRunning) {
      throw StateError('A command is already running');
    }
    if (_disposed) {
      throw StateError('TerminalSession has been disposed');
    }
    _stopwatch = Stopwatch()..start();

    final Process process;
    try {
      process = await processStarter(
        command: command,
        workingDirectory: workingDirectory,
        environment: environment,
      );
    } catch (error) {
      _emit(TerminalOutput.stderr('Failed to start: $error'));
      _emit(TerminalOutput.exit(-1, _stopwatch!.elapsedMilliseconds));
      if (!_exitCompleter.isCompleted) {
        _exitCompleter.complete(-1);
      }
      return;
    }
    _process = process;

    _stdoutSub = process.stdout
        .transform(utf8.decoder)
        .listen((text) => _emit(TerminalOutput.stdout(text)));
    _stderrSub = process.stderr
        .transform(utf8.decoder)
        .listen((text) => _emit(TerminalOutput.stderr(text)));

    final exitCode = await process.exitCode;
    await _stdoutSub?.cancel();
    await _stderrSub?.cancel();
    _stopwatch!.stop();
    _emit(TerminalOutput.exit(exitCode, _stopwatch!.elapsedMilliseconds));
    if (!_exitCompleter.isCompleted) {
      _exitCompleter.complete(exitCode);
    }
    _process = null;
  }

  /// 中断当前命令（发送 SIGINT）。
  Future<void> interrupt() async {
    _process?.kill(ProcessSignal.sigint);
  }

  /// 释放资源：kill 进程 + 关闭输出流。
  Future<void> dispose() async {
    _disposed = true;
    if (_process != null && !_exitCompleter.isCompleted) {
      _process!.kill(ProcessSignal.sigkill);
    }
    await _stdoutSub?.cancel();
    await _stderrSub?.cancel();
    if (!_exitCompleter.isCompleted) {
      _exitCompleter.complete(130);
    }
    if (!_outputController.isClosed) {
      await _outputController.close();
    }
    _process = null;
  }
}
