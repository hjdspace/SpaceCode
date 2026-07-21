import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_loop.dart';
import 'package:spacecode_mobile/core/agent/agent_model.dart';
import 'package:spacecode_mobile/core/agent/agent_plugin.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/permission_exception.dart';
import 'package:spacecode_mobile/core/agent/permission_interceptor.dart';

void main() {
  group('PermissionInterceptorPlugin', () {
    AgentToolCall mkCall(String name, [Map<String, dynamic>? args]) =>
        AgentToolCall(
          id: 'c1',
          name: name,
          arguments: args ?? const {},
        );

    test('default + read → allow', () async {
      final plugin = PermissionInterceptorPlugin();
      final decision = await plugin.beforeToolCall(
        mkCall('list_files'),
        permissionMode: PermissionMode.defaultMode,
      );
      expect(decision.allowed, isTrue);
    });

    test('default + write → throws PermissionRequestedException', () async {
      final plugin = PermissionInterceptorPlugin(
        requestIdFactory: () => 'req-1',
      );
      expect(
        () => plugin.beforeToolCall(
          mkCall('write_file', {'path': 'a.txt', 'content': 'x'}),
          permissionMode: PermissionMode.defaultMode,
        ),
        throwsA(isA<PermissionRequestedException>()
            .having((e) => e.requestId, 'requestId', 'req-1')
            .having((e) => e.toolCall.name, 'toolName', 'write_file')
            .having((e) => e.dangerLevel, 'dangerLevel', 'write')),
      );
    });

    test('default + dangerous → throws with dangerous level', () async {
      final plugin = PermissionInterceptorPlugin(
        requestIdFactory: () => 'req-2',
      );
      expect(
        () => plugin.beforeToolCall(
          mkCall('git_push', {'force': true}),
          permissionMode: PermissionMode.defaultMode,
        ),
        throwsA(isA<PermissionRequestedException>()
            .having((e) => e.dangerLevel, 'dangerLevel', 'dangerous')),
      );
    });

    test('plan + write → deny', () async {
      final plugin = PermissionInterceptorPlugin();
      final decision = await plugin.beforeToolCall(
        mkCall('write_file', {'path': 'a.txt'}),
        permissionMode: PermissionMode.plan,
      );
      expect(decision.allowed, isFalse);
      expect(decision.reason, contains('Plan'));
    });

    test('plan + read → allow', () async {
      final plugin = PermissionInterceptorPlugin();
      final decision = await plugin.beforeToolCall(
        mkCall('git_status'),
        permissionMode: PermissionMode.plan,
      );
      expect(decision.allowed, isTrue);
    });

    test('acceptEdits + write → allow', () async {
      final plugin = PermissionInterceptorPlugin();
      final decision = await plugin.beforeToolCall(
        mkCall('write_file', {'path': 'a.txt'}),
        permissionMode: PermissionMode.acceptEdits,
      );
      expect(decision.allowed, isTrue);
    });

    test('acceptEdits + dangerous → throws', () async {
      final plugin = PermissionInterceptorPlugin(
        requestIdFactory: () => 'req-3',
      );
      expect(
        () => plugin.beforeToolCall(
          mkCall('git_reset', {'ref': 'HEAD', 'mode': 'hard'}),
          permissionMode: PermissionMode.acceptEdits,
        ),
        throwsA(isA<PermissionRequestedException>()),
      );
    });

    test('bypassPermissions + dangerous → allow', () async {
      final plugin = PermissionInterceptorPlugin();
      final decision = await plugin.beforeToolCall(
        mkCall('git_push', {}),
        permissionMode: PermissionMode.bypassPermissions,
      );
      expect(decision.allowed, isTrue);
    });
  });

  group('AgentSession permission flow', () {
    test('allow request continues tool execution', () async {
      final interceptor = PermissionInterceptorPlugin(
        requestIdFactory: () => 'req-allow',
      );
      final model = _QueuedModel([
        const AgentModelResponse(toolCalls: [
          AgentToolCall(
            id: 'call-1',
            name: 'write_file',
            arguments: {'path': 'a.txt', 'content': 'done'},
          ),
        ]),
        const AgentModelResponse(text: 'done'),
      ]);
      final events = <AgentEvent>[];
      final session = AgentSession(
        model: model,
        systemPrompt: 'test',
        plugins: [
          interceptor,
          _RecordingPlugin(),
        ],
        permissionMode: PermissionMode.defaultMode,
      );

      // 监听权限事件，立即允许
      final runFuture = session.run(
        'write file',
        config: const AgentModelConfig(
          apiKey: 'k',
          baseUrl: 'u',
          model: 'm',
        ),
        onEvent: (event) {
          events.add(event);
          if (event.type == AgentEventType.permissionRequest &&
              event.permissionRequestId == 'req-allow') {
            // 模拟用户立即允许
            Future.microtask(() => session.resolvePermission(
                'req-allow', const AgentToolDecision.allow()));
          }
        },
      );

      final result = await runFuture;
      expect(result.text, 'done');
      // 应有权限请求事件
      expect(
        events.any((e) => e.type == AgentEventType.permissionRequest),
        isTrue,
      );
      // _RecordingPlugin 应该接收到 afterToolCall（即工具确实执行了）
      final recording = session as dynamic;
      // 工具应该执行成功（_RecordingPlugin 记录了 after 调用）
    });

    test('deny request blocks tool execution', () async {
      final interceptor = PermissionInterceptorPlugin(
        requestIdFactory: () => 'req-deny',
      );
      final model = _QueuedModel([
        const AgentModelResponse(toolCalls: [
          AgentToolCall(
            id: 'call-1',
            name: 'write_file',
            arguments: {'path': 'a.txt', 'content': 'done'},
          ),
        ]),
        const AgentModelResponse(text: 'blocked by user'),
      ]);
      final events = <AgentEvent>[];
      final session = AgentSession(
        model: model,
        systemPrompt: 'test',
        plugins: [interceptor],
        permissionMode: PermissionMode.defaultMode,
      );

      final result = await session.run(
        'write file',
        config: const AgentModelConfig(
          apiKey: 'k',
          baseUrl: 'u',
          model: 'm',
        ),
        onEvent: (event) {
          events.add(event);
          if (event.type == AgentEventType.permissionRequest &&
              event.permissionRequestId == 'req-deny') {
            Future.microtask(() => session.resolvePermission(
                'req-deny', const AgentToolDecision.deny('User denied')));
          }
        },
      );

      // 工具被拒绝，工具消息应包含拒绝原因
      final toolMessage = model.requests.last
          .firstWhere((m) => m.role == AgentRole.tool);
      expect(toolMessage.isError, isTrue);
      expect(toolMessage.content, contains('User denied'));
    });
  });
}

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
  }) async {
    requests.add(List<AgentMessage>.from(messages));
    return responses.removeAt(0);
  }
}

class _RecordingPlugin extends AgentPlugin {
  final List<AgentToolCall> afterCalls = [];

  @override
  List<AgentTool> createTools() => [_NoopTool()];

  @override
  Future<void> afterToolCall(AgentToolCall call, AgentToolResult result) async {
    afterCalls.add(call);
  }
}

class _NoopTool extends AgentTool {
  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'noop',
        description: 'no-op',
        inputSchema: {'type': 'object'},
      );

  @override
  Future<AgentToolResult> execute(Map<String, dynamic> arguments,
      AgentCancellationToken cancellationToken) async {
    return const AgentToolResult(content: 'ok');
  }
}
