import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:spacecode_mobile/core/agent/local_agent_service.dart';
import 'package:spacecode_mobile/core/config/mobile_config.dart';
import 'package:spacecode_mobile/core/workspace/workspace_target.dart';

void main() {
  test('sends an OpenAI-compatible request with workspace context', () async {
    late Uri requestedUri;
    late Map<String, dynamic> requestedBody;
    final client = MockClient((request) async {
      requestedUri = request.url;
      requestedBody = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response.bytes(
        utf8.encode(jsonEncode({
          'choices': [
            {
              'message': {'content': '完成'}
            }
          ]
        })),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final service = LocalAgentService(client: client);

    final result = await service.complete(
      config: const MobileConfig(
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1/',
        model: 'test-model',
      ),
      prompt: '修复测试',
      workspace: const WorkspaceTarget.local('/tmp/project'),
    );

    expect(result, '完成');
    expect(requestedUri.toString(), 'https://example.test/v1/chat/completions');
    expect(requestedBody['model'], 'test-model');
    expect((requestedBody['messages'] as List).first['content'],
        contains('/tmp/project'));
    service.dispose();
  });

  test('fails clearly when API key is missing', () async {
    final service = LocalAgentService(
        client: MockClient((_) async => http.Response('', 500)));
    expect(
      () => service.complete(config: const MobileConfig(), prompt: 'test'),
      throwsA(isA<StateError>()),
    );
    service.dispose();
  });
}
