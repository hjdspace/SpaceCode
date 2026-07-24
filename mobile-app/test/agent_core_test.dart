import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_loop.dart';
import 'package:spacecode_mobile/core/agent/agent_model.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/plugins/workspace_plugin.dart';

class _QueuedModel extends AgentModel {
  final List<AgentModelResponse> responses;
  final List<List<AgentMessage>> requests = [];

  _QueuedModel(this.responses);

  @override
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,
    AgentToolCallStartCallback? onToolCallStart,
    AgentToolCallDeltaCallback? onToolCallDelta,
    AgentToolCallStopCallback? onToolCallStop,
  }) async {
    requests.add(List<AgentMessage>.from(messages));
    return responses.removeAt(0);
  }
}

class _BlockingModel extends AgentModel {
  @override
  Future<AgentModelResponse> complete({
    required AgentModelConfig config,
    required String systemPrompt,
    required List<AgentMessage> messages,
    required List<AgentToolDefinition> tools,
    required AgentCancellationToken cancellationToken,
    void Function(String delta)? onDelta,
    AgentToolCallStartCallback? onToolCallStart,
    AgentToolCallDeltaCallback? onToolCallDelta,
    AgentToolCallStopCallback? onToolCallStop,
  }) async {
    await cancellationToken.whenCancelled;
    throw const AgentCancelledException();
  }
}

void main() {
  late Directory workspace;

  setUp(() async {
    workspace = await Directory.systemTemp.createTemp('spacecode-agent-test-');
  });

  tearDown(() async {
    if (await workspace.exists()) await workspace.delete(recursive: true);
  });

  test('runs plugin tools and continues until the model returns text',
      () async {
    final model = _QueuedModel([
      const AgentModelResponse(toolCalls: [
        AgentToolCall(
          id: 'call-1',
          name: 'write_file',
          arguments: {'path': 'lib/result.txt', 'content': 'done'},
        ),
      ]),
      const AgentModelResponse(text: '文件已更新'),
    ]);
    final events = <AgentEvent>[];
    final session = AgentSession(
      model: model,
      systemPrompt: 'coding agent',
      plugins: [WorkspacePlugin(workspace.path)],
    );

    final result = await session.run(
      '创建结果文件',
      config: const AgentModelConfig(
        apiKey: 'test',
        baseUrl: 'https://example.test/v1',
        model: 'test-model',
      ),
      onEvent: events.add,
    );

    expect(result.text, '文件已更新');
    expect(
        await File(
                '${workspace.path}${Platform.pathSeparator}lib${Platform.pathSeparator}result.txt')
            .readAsString(),
        'done');
    expect(model.requests, hasLength(2));
    expect(
        model.requests.last.where((message) => message.role == AgentRole.tool),
        hasLength(1));
    expect(
        events.any((event) => event.type == AgentEventType.toolExecutionStart),
        isTrue);
    expect(events.any((event) => event.type == AgentEventType.toolExecutionEnd),
        isTrue);
  });

  test('retains prior turns in the same session', () async {
    final model = _QueuedModel([
      const AgentModelResponse(text: '第一次回答'),
      const AgentModelResponse(text: '第二次回答'),
    ]);
    final session = AgentSession(model: model, systemPrompt: 'coding agent');
    const config = AgentModelConfig(
      apiKey: 'test',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
    );

    await session.run('第一次问题', config: config);
    await session.run('第二次问题', config: config);

    final secondRequest = model.requests.last;
    expect(secondRequest.map((message) => message.content),
        containsAllInOrder(['第一次问题', '第一次回答', '第二次问题']));
  });

  test('returns unknown tool errors to the model', () async {
    final model = _QueuedModel([
      const AgentModelResponse(toolCalls: [
        AgentToolCall(id: 'missing-1', name: 'missing_tool', arguments: {}),
      ]),
      const AgentModelResponse(text: '已改用其他方式'),
    ]);
    final session = AgentSession(model: model, systemPrompt: 'coding agent');

    final result = await session.run(
      '执行工具',
      config: const AgentModelConfig(
        apiKey: 'test',
        baseUrl: 'https://example.test/v1',
        model: 'test-model',
      ),
    );

    expect(result.text, '已改用其他方式');
    final toolMessage = model.requests.last
        .firstWhere((message) => message.role == AgentRole.tool);
    expect(toolMessage.content, contains('missing_tool'));
    expect(toolMessage.isError, isTrue);
  });

  test('workspace plugin blocks paths outside the workspace', () async {
    final model = _QueuedModel([
      const AgentModelResponse(toolCalls: [
        AgentToolCall(
          id: 'escape-1',
          name: 'write_file',
          arguments: {'path': '../escape.txt', 'content': 'blocked'},
        ),
      ]),
      const AgentModelResponse(text: '越界写入已阻止'),
    ]);
    final session = AgentSession(
      model: model,
      systemPrompt: 'coding agent',
      plugins: [WorkspacePlugin(workspace.path)],
    );

    await session.run(
      '尝试越界',
      config: const AgentModelConfig(
        apiKey: 'test',
        baseUrl: 'https://example.test/v1',
        model: 'test-model',
      ),
    );

    final toolMessage = model.requests.last
        .firstWhere((message) => message.role == AgentRole.tool);
    expect(toolMessage.isError, isTrue);
    expect(toolMessage.content, contains('inside the workspace'));
  });

  test('cancels an active model turn', () async {
    final token = AgentCancellationToken();
    final events = <AgentEvent>[];
    final session =
        AgentSession(model: _BlockingModel(), systemPrompt: 'coding agent');
    final running = session.run(
      '等待任务',
      config: const AgentModelConfig(
        apiKey: 'test',
        baseUrl: 'https://example.test/v1',
        model: 'test-model',
      ),
      cancellationToken: token,
      onEvent: events.add,
    );

    token.cancel();

    await expectLater(running, throwsA(isA<AgentCancelledException>()));
    expect(events.last.type, AgentEventType.agentEnd);
  });
}
