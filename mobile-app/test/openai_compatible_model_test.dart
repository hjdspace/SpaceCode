import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/agent_model.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/openai_compatible_model.dart';

void main() {
  test('parses tool calls and sends registered tool definitions', () async {
    late Map<String, dynamic> requestBody;
    final client = MockClient((request) async {
      requestBody = jsonDecode(request.body) as Map<String, dynamic>;
      return http.Response.bytes(
        utf8.encode(jsonEncode({
          'choices': [
            {
              'message': {
                'content': null,
                'tool_calls': [
                  {
                    'id': 'call-1',
                    'type': 'function',
                    'function': {
                      'name': 'read_file',
                      'arguments': '{"path":"README.md"}',
                    },
                  },
                ],
              },
            },
          ],
        })),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final model = OpenAiCompatibleModel(client: client);

    final result = await model.complete(
      config: const AgentModelConfig(
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        model: 'test-model',
      ),
      systemPrompt: 'agent',
      messages: const [AgentMessage.user('inspect')],
      tools: const [
        AgentToolDefinition(
          name: 'read_file',
          description: 'Read a file',
          inputSchema: {'type': 'object'},
        ),
      ],
      cancellationToken: AgentCancellationToken(),
    );

    expect(result.text, isEmpty);
    expect(result.toolCalls.single.name, 'read_file');
    expect(result.toolCalls.single.arguments['path'], 'README.md');
    expect(
        (requestBody['tools'] as List).single['function']['name'], 'read_file');
    model.dispose();
  });

  test('aborts an in-flight request when the run is cancelled', () async {
    final requestStarted = Completer<void>();
    final client = MockClient.streaming((request, bodyStream) async {
      final abortable = request as http.AbortableRequest;
      await bodyStream.drain<void>();
      requestStarted.complete();
      await abortable.abortTrigger;
      throw http.RequestAbortedException(request.url);
    });
    final model = OpenAiCompatibleModel(client: client);
    final token = AgentCancellationToken();

    final completion = model.complete(
      config: const AgentModelConfig(
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        model: 'test-model',
      ),
      systemPrompt: 'agent',
      messages: const [AgentMessage.user('wait')],
      tools: const [],
      cancellationToken: token,
    );
    await requestStarted.future;
    token.cancel();

    await expectLater(completion, throwsA(isA<AgentCancelledException>()));
    model.dispose();
  });
}
