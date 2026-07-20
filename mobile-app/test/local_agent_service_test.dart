import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/local_agent_service.dart';
import 'package:spacecode_mobile/core/config/mobile_config.dart';
import 'package:spacecode_mobile/core/workspace/workspace_target.dart';

void main() {
  test('sends an OpenAI-compatible streaming request with workspace context',
      () async {
    late Uri requestedUri;
    late Map<String, dynamic> requestedBody;
    final client = MockClient.streaming((request, bodyStream) async {
      requestedUri = request.url;
      final bodyBytes = await bodyStream.toBytes();
      requestedBody = jsonDecode(utf8.decode(bodyBytes)) as Map<String, dynamic>;
      final chunks = [
        'data: ${jsonEncode({
          'choices': [
            {'delta': {'content': '完'}}
          ]
        })}\n\n',
        'data: ${jsonEncode({
          'choices': [
            {'delta': {'content': '成'}}
          ]
        })}\n\n',
        'data: [DONE]\n\n',
      ];
      final bytes = <int>[];
      for (final c in chunks) {
        bytes.addAll(utf8.encode(c));
      }
      return http.StreamedResponse(
        Stream.value(bytes),
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    });

    final service = LocalAgentService(client: client);
    final token = AgentCancellationToken();
    final deltas = <String>[];

    final result = await service.complete(
      sessionId: 'test-session',
      config: const MobileConfig(
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1/',
        model: 'test-model',
      ),
      prompt: '修复测试',
      workspace: const WorkspaceTarget.local('/tmp/project'),
      cancellationToken: token,
      onEvent: (event) {
        if (event.type == AgentEventType.assistantDelta && event.delta != null) {
          deltas.add(event.delta!);
        }
      },
    );

    expect(result, '完成');
    expect(deltas.join(), '完成');
    expect(requestedUri.toString(), 'https://example.test/v1/chat/completions');
    expect(requestedBody['model'], 'test-model');
    expect(requestedBody['stream'], true);
    expect((requestedBody['messages'] as List).first['content'],
        contains('/tmp/project'));
    service.dispose();
  });

  test('fails clearly when API key is missing', () async {
    final service = LocalAgentService(
        client: MockClient.streaming((_, bodyStream) async {
      await bodyStream.drain<void>();
      return http.StreamedResponse(const Stream.empty(), 200);
    }));
    final token = AgentCancellationToken();
    expect(
      () => service.complete(
        sessionId: 'test-session',
        config: const MobileConfig(),
        prompt: 'test',
        cancellationToken: token,
        onEvent: (_) {},
      ),
      throwsA(isA<StateError>()),
    );
    service.dispose();
  });
}
