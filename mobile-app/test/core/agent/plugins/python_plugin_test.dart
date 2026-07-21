import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_plugin.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/chaquopy_bridge.dart';
import 'package:spacecode_mobile/core/agent/plugins/python_plugin.dart';
import 'package:spacecode_mobile/core/agent/python_sandbox.dart';

void main() {
  AgentCancellationToken token() => AgentCancellationToken();

  group('PythonPlugin tool definitions', () {
    test('createTools exposes 2 python tools', () {
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async =>
            const PythonRunResult(
                exitCode: 0, stdout: '', stderr: '', durationMs: 0),
      );
      final tools = plugin.createTools();
      expect(tools.length, 2);
      final names = tools.map((t) => t.definition.name).toSet();
      expect(names, containsAll(['run_python', 'run_python_file']));
    });

    test('run_python uses sequential execution mode', () {
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async =>
            const PythonRunResult(
                exitCode: 0, stdout: '', stderr: '', durationMs: 0),
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python');
      expect(tool.executionMode, AgentToolExecutionMode.sequential);
    });

    test('run_python_file uses sequential execution mode', () {
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async =>
            const PythonRunResult(
                exitCode: 0, stdout: '', stderr: '', durationMs: 0),
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python_file');
      expect(tool.executionMode, AgentToolExecutionMode.sequential);
    });

    test('run_python schema requires code', () {
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async =>
            const PythonRunResult(
                exitCode: 0, stdout: '', stderr: '', durationMs: 0),
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python');
      final schema = tool.definition.inputSchema;
      expect(schema['required'], ['code']);
      final props = schema['properties'] as Map<String, dynamic>;
      expect(props.containsKey('code'), isTrue);
      expect(props.containsKey('timeout_ms'), isTrue);
    });
  });

  group('run_python tool', () {
    test('returns JSON with exit_code/stdout/stderr/duration_ms', () async {
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async {
          expect(code, 'print("hello")');
          expect(timeoutMs, 30000);
          return const PythonRunResult(
            exitCode: 0,
            stdout: 'hello\n',
            stderr: '',
            durationMs: 12,
          );
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python');

      final result = await tool.execute({'code': 'print("hello")'}, token());

      expect(result.isError, isFalse);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['exit_code'], 0);
      expect(decoded['stdout'], 'hello\n');
      expect(decoded['stderr'], '');
      expect(decoded['duration_ms'], 12);
    });

    test('marks non-zero exit as error', () async {
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async =>
            const PythonRunResult(
              exitCode: 1,
              stdout: '',
              stderr: 'SyntaxError: invalid syntax',
              durationMs: 5,
            ),
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python');

      final result = await tool.execute({'code': 'invalid syntax'}, token());

      expect(result.isError, isTrue);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['exit_code'], 1);
      expect(decoded['stderr'], 'SyntaxError: invalid syntax');
    });

    test('returns error when code is empty or missing', () async {
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async =>
            const PythonRunResult(
                exitCode: 0, stdout: '', stderr: '', durationMs: 0),
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python');

      final empty = await tool.execute({'code': ''}, token());
      expect(empty.isError, isTrue);
      expect(empty.content, 'code must not be empty');

      final missing = await tool.execute({}, token());
      expect(missing.isError, isTrue);
      expect(missing.content, 'code must not be empty');
    });

    test('rejects code exceeding maxCodeBytes', () async {
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async =>
            const PythonRunResult(
                exitCode: 0, stdout: '', stderr: '', durationMs: 0),
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python');

      final oversized = 'x' * (PythonSandboxConfig.maxCodeBytes + 1);
      final result = await tool.execute({'code': oversized}, token());

      expect(result.isError, isTrue);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['code_size'], oversized.length);
      expect(decoded['error'], contains('maximum size'));
    });

    test('clamps timeout_ms to [min, max] range', () async {
      int? capturedTimeout;
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async {
          capturedTimeout = timeoutMs;
          return const PythonRunResult(
              exitCode: 0, stdout: '', stderr: '', durationMs: 0);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python');

      // 超过最大值 → 截断到 maxTimeoutMs
      await tool.execute({'code': 'x', 'timeout_ms': 999999}, token());
      expect(capturedTimeout, PythonSandboxConfig.maxTimeoutMs);

      // 小于最小值 → 提升到 minTimeoutMs
      await tool.execute({'code': 'x', 'timeout_ms': 100}, token());
      expect(capturedTimeout, PythonSandboxConfig.minTimeoutMs);

      // 默认值 defaultTimeoutMs
      await tool.execute({'code': 'x'}, token());
      expect(capturedTimeout, PythonSandboxConfig.defaultTimeoutMs);
    });

    test('returns timeout error when executor reports timedOut', () async {
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async =>
            PythonRunResult(
              exitCode: -1,
              stdout: 'partial output',
              stderr: '',
              durationMs: timeoutMs,
              timedOut: true,
            ),
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python');

      final result = await tool.execute(
        {'code': 'while True: pass', 'timeout_ms': 5000},
        token(),
      );

      expect(result.isError, isTrue);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['exit_code'], -1);
      expect(decoded['stderr'], contains('timed out'));
      expect(decoded['partial_stdout'], 'partial output');
    });

    test('truncates stdout beyond maxOutputBytes', () async {
      final huge = 'x' * (PythonSandboxConfig.maxOutputBytes + 1000);
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async =>
            PythonRunResult(
              exitCode: 0,
              stdout: huge,
              stderr: '',
              durationMs: 1,
            ),
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python');

      final result = await tool.execute({'code': 'x'}, token());

      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      final stdout = decoded['stdout'] as String;
      expect(stdout.length, lessThan(huge.length));
      expect(stdout, contains('[truncated]'));
    });

    test('throws cancelled error when cancellationToken fires before run', () {
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async =>
            const PythonRunResult(
                exitCode: 0, stdout: '', stderr: '', durationMs: 0),
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python');

      final t = AgentCancellationToken()..cancel();
      expect(
        () => tool.execute({'code': 'x'}, t),
        throwsA(isA<AgentCancelledException>()),
      );
    });

    test('forwards args and stdin to executor', () async {
      List<String>? capturedArgs;
      String? capturedStdin;
      final plugin = PythonPlugin.forTest(
        executor: ({required code, List<String> args = const [], String? stdin, required timeoutMs}) async {
          capturedArgs = args;
          capturedStdin = stdin;
          return const PythonRunResult(
              exitCode: 0, stdout: '', stderr: '', durationMs: 0);
        },
      );
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'run_python');

      await tool.execute({
        'code': 'x',
        'args': ['a', 'b'],
        'stdin': 'input-data',
      }, token());

      expect(capturedArgs, ['a', 'b']);
      expect(capturedStdin, 'input-data');
    });
  });

  group('PythonSandboxConfig', () {
    test('blockedModules includes subprocess and socket', () {
      expect(PythonSandboxConfig.blockedModules, contains('subprocess'));
      expect(PythonSandboxConfig.blockedModules, contains('socket'));
      expect(PythonSandboxConfig.blockedModules, contains('ctypes'));
      expect(PythonSandboxConfig.blockedModules, contains('multiprocessing'));
    });

    test('sitecustomizeContent references blocked modules', () {
      final content = PythonSandboxConfig.sitecustomizeContent;
      expect(content, contains('subprocess'));
      expect(content, contains('socket'));
      expect(content, contains('_sandboxed_import'));
      expect(content, contains('builtins.__import__'));
    });

    test('constants have expected values', () {
      expect(PythonSandboxConfig.maxCodeBytes, 100 * 1024);
      expect(PythonSandboxConfig.maxOutputBytes, 50 * 1024);
      expect(PythonSandboxConfig.defaultTimeoutMs, 30000);
      expect(PythonSandboxConfig.maxTimeoutMs, 120000);
      expect(PythonSandboxConfig.minTimeoutMs, 1000);
    });
  });
}
