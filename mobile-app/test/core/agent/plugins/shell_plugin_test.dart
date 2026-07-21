import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_model.dart';
import 'package:spacecode_mobile/core/agent/agent_plugin.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/plugins/shell_plugin.dart';

void main() {
  AgentCancellationToken token() => AgentCancellationToken();

  test('run_command definition exposes command + timeout_ms schema', () {
    final plugin = ShellPlugin.forTest(
      workingDirectory: '/tmp/ws',
      environment: const {},
      executor: (_, __) async =>
          ShellCommandResult(exitCode: 0, stdout: '', stderr: ''),
    );
    final tools = plugin.createTools();
    expect(tools, hasLength(1));
    final tool = tools.first;
    expect(tool.executionMode, AgentToolExecutionMode.sequential);
    final def = tool.definition;
    expect(def.name, 'run_command');
    final props = def.inputSchema['properties'] as Map<String, dynamic>;
    expect(props.containsKey('command'), isTrue);
    expect(props.containsKey('timeout_ms'), isTrue);
    expect(def.inputSchema['required'], ['command']);
  });

  test('execute returns JSON with exit_code/stdout/stderr/duration_ms', () async {
    final plugin = ShellPlugin.forTest(
      workingDirectory: '/tmp/ws',
      environment: const {'PATH': '/bin'},
      executor: (command, _) async => ShellCommandResult(
        exitCode: 0,
        stdout: 'hello world',
        stderr: '',
      ),
    );
    final tool = plugin.createTools().single;

    final result = await tool.execute({'command': 'echo hello world'}, token());

    expect(result.isError, isFalse);
    final decoded = jsonDecode(result.content) as Map<String, dynamic>;
    expect(decoded['exit_code'], 0);
    expect(decoded['stdout'], 'hello world');
    expect(decoded['stderr'], '');
    expect(decoded['truncated'], false);
    expect(decoded.containsKey('duration_ms'), isTrue);
  });

  test('execute marks non-zero exit as error', () async {
    final plugin = ShellPlugin.forTest(
      workingDirectory: '/tmp/ws',
      environment: const {},
      executor: (command, _) async => ShellCommandResult(
        exitCode: 1,
        stdout: '',
        stderr: 'command not found',
      ),
    );
    final tool = plugin.createTools().single;

    final result = await tool.execute({'command': 'nonexistent'}, token());

    expect(result.isError, isTrue);
    final decoded = jsonDecode(result.content) as Map<String, dynamic>;
    expect(decoded['exit_code'], 1);
    expect(decoded['stderr'], 'command not found');
  });

  test('execute truncates stdout beyond 50KB and sets truncated flag',
      () async {
    final huge = 'x' * (50 * 1024 + 1000);
    final plugin = ShellPlugin.forTest(
      workingDirectory: '/tmp/ws',
      environment: const {},
      executor: (command, _) async =>
          ShellCommandResult(exitCode: 0, stdout: huge, stderr: ''),
    );
    final tool = plugin.createTools().single;

    final result = await tool.execute({'command': 'cat huge.txt'}, token());

    final decoded = jsonDecode(result.content) as Map<String, dynamic>;
    expect(decoded['truncated'], true);
    expect((decoded['stdout'] as String).length, lessThan(huge.length));
  });

  test('execute truncates stderr beyond 50KB independently', () async {
    final huge = 'e' * (50 * 1024 + 500);
    final plugin = ShellPlugin.forTest(
      workingDirectory: '/tmp/ws',
      environment: const {},
      executor: (command, _) async =>
          ShellCommandResult(exitCode: 2, stdout: '', stderr: huge),
    );
    final tool = plugin.createTools().single;

    final result = await tool.execute({'command': 'err cmd'}, token());

    final decoded = jsonDecode(result.content) as Map<String, dynamic>;
    expect(decoded['truncated'], true);
    expect((decoded['stderr'] as String).length, lessThan(huge.length));
  });

  test('execute clamps timeout_ms to [1000, 120000] range', () async {
    Duration? captured;
    final plugin = ShellPlugin.forTest(
      workingDirectory: '/tmp/ws',
      environment: const {},
      executor: (command, timeout) async {
        captured = timeout;
        return ShellCommandResult(exitCode: 0, stdout: '', stderr: '');
      },
    );
    final tool = plugin.createTools().single;

    // 超过最大值 → 截断到 120000
    await tool.execute({'command': 'ls', 'timeout_ms': 999999}, token());
    expect(captured!.inMilliseconds, 120000);

    // 小于最小值 → 提升到 1000
    await tool.execute({'command': 'ls', 'timeout_ms': 100}, token());
    expect(captured!.inMilliseconds, 1000);

    // 默认值 30000
    await tool.execute({'command': 'ls'}, token());
    expect(captured!.inMilliseconds, 30000);
  });

  test('execute returns error when command is empty or missing', () async {
    final plugin = ShellPlugin.forTest(
      workingDirectory: '/tmp/ws',
      environment: const {},
      executor: (command, _) async =>
          ShellCommandResult(exitCode: 0, stdout: '', stderr: ''),
    );
    final tool = plugin.createTools().single;

    final empty = await tool.execute({'command': ''}, token());
    expect(empty.isError, isTrue);
    expect(empty.content, contains('command must not be empty'));

    final missing = await tool.execute({}, token());
    expect(missing.isError, isTrue);
    expect(missing.content, contains('command must not be empty'));
  });

  test('execute returns timeout error when executor reports timedOut',
      () async {
    final plugin = ShellPlugin.forTest(
      workingDirectory: '/tmp/ws',
      environment: const {},
      executor: (command, _) async => ShellCommandResult(
        exitCode: -1,
        stdout: 'partial',
        stderr: '',
        timedOut: true,
      ),
    );
    final tool = plugin.createTools().single;

    final result = await tool
        .execute({'command': 'sleep 999', 'timeout_ms': 5000}, token());

    expect(result.isError, isTrue);
    final decoded = jsonDecode(result.content) as Map<String, dynamic>;
    expect(decoded['exit_code'], -1);
    expect(decoded['stderr'], contains('timed out'));
    expect(decoded['partial_stdout'], 'partial');
  });

  test('execute returns cancelled error when cancellationToken fires before run',
      () async {
    final plugin = ShellPlugin.forTest(
      workingDirectory: '/tmp/ws',
      environment: const {},
      executor: (command, _) async =>
          ShellCommandResult(exitCode: 0, stdout: '', stderr: ''),
    );
    final tool = plugin.createTools().single;

    final t = AgentCancellationToken()..cancel();
    expect(
      () => tool.execute({'command': 'ls'}, t),
      throwsA(isA<AgentCancelledException>()),
    );
  });

  test('execute returns cancelled error when executor reports cancelled',
      () async {
    final plugin = ShellPlugin.forTest(
      workingDirectory: '/tmp/ws',
      environment: const {},
      executor: (command, _) async => ShellCommandResult(
        exitCode: -1,
        stdout: '',
        stderr: '',
        cancelled: true,
      ),
    );
    final tool = plugin.createTools().single;

    final result = await tool
        .execute({'command': 'long task', 'timeout_ms': 5000}, token());

    expect(result.isError, isTrue);
    final decoded = jsonDecode(result.content) as Map<String, dynamic>;
    expect(decoded['exit_code'], -1);
    expect(decoded['stderr'], contains('cancelled'));
  });
}
