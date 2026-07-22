import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../agent_model.dart';
import '../agent_plugin.dart';
import '../agent_types.dart';
import '../chaquopy_bridge.dart';
import '../python_sandbox.dart';

/// Python 执行器函数类型（可注入用于测试）。
typedef PythonExecutor = Future<PythonRunResult> Function({
  required String code,
  List<String> args,
  String? stdin,
  required int timeoutMs,
});

/// 提供 `run_python` 和 `run_python_file` 工具。
///
/// 通过 [ChaquopyBridge] 调用 Android 端嵌入式 CPython 执行 Python 代码。
/// 沙盒约束由 [PythonSandboxConfig] 定义（禁用 subprocess/socket/ctypes 等）。
///
/// 仅在 `BinaryResolver.pythonReady == true` 时加载。
class PythonPlugin extends AgentPlugin {
  final PythonExecutor executor;

  PythonPlugin({PythonExecutor? executor})
      : executor = executor ?? _defaultExecutor;

  @visibleForTesting
  PythonPlugin.forTest({required this.executor});

  static Future<PythonRunResult> _defaultExecutor({
    required String code,
    List<String> args = const [],
    String? stdin,
    required int timeoutMs,
  }) {
    return ChaquopyBridge.instance.runCode(
      code: code,
      args: args,
      stdin: stdin,
      timeoutMs: timeoutMs,
    );
  }

  @override
  List<AgentTool> createTools() => [
        _RunPythonTool(this),
        _RunPythonFileTool(this),
      ];
}

class _RunPythonTool extends AgentTool {
  final PythonPlugin plugin;
  _RunPythonTool(this.plugin);

  @override
  AgentToolExecutionMode get executionMode =>
      AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'run_python',
        description: 'Execute Python code in a sandboxed environment. '
            'Subprocess, socket, ctypes, and multiprocessing modules are blocked.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'code': {
              'type': 'string',
              'description': 'Python code to execute',
            },
            'args': {
              'type': 'array',
              'items': {'type': 'string'},
              'description': 'Command-line arguments (sys.argv)',
            },
            'stdin': {
              'type': 'string',
              'description': 'Standard input for the Python process',
            },
            'timeout_ms': {
              'type': 'integer',
              'description': 'Timeout in milliseconds',
              'default': 30000,
            },
          },
          'required': ['code'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    cancellationToken.throwIfCancelled();

    final code = arguments['code'] as String? ?? '';
    if (code.trim().isEmpty) {
      return const AgentToolResult(
        content: 'code must not be empty',
        isError: true,
      );
    }
    if (code.length > PythonSandboxConfig.maxCodeBytes) {
      return AgentToolResult(
        content: jsonEncode({
          'error': 'Code exceeds maximum size of ${PythonSandboxConfig.maxCodeBytes} bytes',
          'code_size': code.length,
        }),
        isError: true,
      );
    }

    final args = (arguments['args'] as List?)?.cast<String>() ?? const [];
    final stdin = arguments['stdin'] as String?;
    final rawTimeout =
        arguments['timeout_ms'] as int? ?? PythonSandboxConfig.defaultTimeoutMs;
    final clampedTimeout = rawTimeout.clamp(
        PythonSandboxConfig.minTimeoutMs, PythonSandboxConfig.maxTimeoutMs);

    final result = await plugin.executor(
      code: code,
      args: args,
      stdin: stdin,
      timeoutMs: clampedTimeout,
    );

    return _buildResult(result, clampedTimeout);
  }
}

class _RunPythonFileTool extends AgentTool {
  final PythonPlugin plugin;
  _RunPythonFileTool(this.plugin);

  @override
  AgentToolExecutionMode get executionMode =>
      AgentToolExecutionMode.sequential;

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'run_python_file',
        description: 'Execute a Python file from the workspace in a sandboxed environment.',
        inputSchema: {
          'type': 'object',
          'properties': {
            'path': {
              'type': 'string',
              'description': 'Path to the Python file (relative to workspace)',
            },
            'args': {
              'type': 'array',
              'items': {'type': 'string'},
              'description': 'Command-line arguments (sys.argv)',
            },
            'stdin': {
              'type': 'string',
              'description': 'Standard input for the Python process',
            },
            'timeout_ms': {
              'type': 'integer',
              'description': 'Timeout in milliseconds',
              'default': 30000,
            },
          },
          'required': ['path'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    cancellationToken.throwIfCancelled();

    final path = arguments['path'] as String? ?? '';
    if (path.trim().isEmpty) {
      return const AgentToolResult(
        content: 'path must not be empty',
        isError: true,
      );
    }

    final args = (arguments['args'] as List?)?.cast<String>() ?? const [];
    final stdin = arguments['stdin'] as String?;
    final rawTimeout =
        arguments['timeout_ms'] as int? ?? PythonSandboxConfig.defaultTimeoutMs;
    final clampedTimeout = rawTimeout.clamp(
        PythonSandboxConfig.minTimeoutMs, PythonSandboxConfig.maxTimeoutMs);

    // 通过 ChaquopyBridge.runFile 执行
    final result = await ChaquopyBridge.instance.runFile(
      filePath: path,
      args: args,
      stdin: stdin,
      timeoutMs: clampedTimeout,
    );

    return _buildResult(result, clampedTimeout);
  }
}

/// 构建工具返回结果，处理超时和截断。
AgentToolResult _buildResult(PythonRunResult result, int timeoutMs) {
  if (result.timedOut) {
    return AgentToolResult(
      content: jsonEncode({
        'exit_code': -1,
        'stderr': 'Execution timed out after ${timeoutMs}ms',
        'partial_stdout': _truncate(result.stdout),
        'duration_ms': result.durationMs,
      }),
      isError: true,
    );
  }

  final truncatedStdout = _truncate(result.stdout);
  final truncatedStderr = _truncate(result.stderr);
  return AgentToolResult(
    content: jsonEncode({
      'exit_code': result.exitCode,
      'stdout': truncatedStdout,
      'stderr': truncatedStderr,
      'duration_ms': result.durationMs,
    }),
    isError: result.exitCode != 0,
  );
}

/// 截断输出到 maxOutputBytes。
String _truncate(String output) {
  if (output.length <= PythonSandboxConfig.maxOutputBytes) {
    return output;
  }
  return '${output.substring(0, PythonSandboxConfig.maxOutputBytes)}\n... [truncated]';
}
