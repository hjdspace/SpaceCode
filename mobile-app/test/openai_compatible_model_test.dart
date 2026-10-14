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

  test('streams delta content via onDelta callback', () async {
    final client = MockClient.streaming((request, bodyStream) async {
      await bodyStream.drain<void>();
      final chunks = [
        'data: ${jsonEncode({
          'choices': [
            {'delta': {'content': 'Hel'}}
          ]
        })}\n\n',
        'data: ${jsonEncode({
          'choices': [
            {'delta': {'content': 'lo'}}
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

    final model = OpenAiCompatibleModel(client: client);
    final deltas = <String>[];

    final result = await model.complete(
      config: const AgentModelConfig(
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'm',
      ),
      systemPrompt: 'agent',
      messages: const [AgentMessage.user('hi')],
      tools: const [],
      cancellationToken: AgentCancellationToken(),
      onDelta: deltas.add,
    );

    expect(result.text, 'Hello');
    expect(deltas, ['Hel', 'lo']);
  });

  test('parses streamed tool_calls', () async {
    final client = MockClient.streaming((request, bodyStream) async {
      await bodyStream.drain<void>();
      final chunks = [
        'data: ${jsonEncode({
          'choices': [
            {
              'delta': {
                'tool_calls': [
                  {
                    'id': 'call-1',
                    'function': {'name': 'read_file', 'arguments': '{"path":"a'}
                  }
                ]
              }
            }
          ]
        })}\n\n',
        'data: ${jsonEncode({
          'choices': [
            {
              'delta': {
                'tool_calls': [
                  {'function': {'arguments': '.txt"}'}}
                ]
              }
            }
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

    final model = OpenAiCompatibleModel(client: client);
    final result = await model.complete(
      config: const AgentModelConfig(
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'm',
      ),
      systemPrompt: 'agent',
      messages: const [AgentMessage.user('hi')],
      tools: const [],
      cancellationToken: AgentCancellationToken(),
    );

    expect(result.toolCalls.length, 1);
    expect(result.toolCalls.first.name, 'read_file');
    expect(result.toolCalls.first.arguments, {'path': 'a.txt'});
  });

  test('parses the final SSE event without a trailing newline', () async {
    final client = MockClient.streaming((request, bodyStream) async {
      await bodyStream.drain<void>();
      // 最后一行没有换行符也要被解析；[DONE] 作为终止标记不能少 ——
      // 缺了它算中断（见下面"marks a stream truncated"那条），不能当成功回复。
      final event =
          'data: ${jsonEncode({
            'choices': [
              {
                'delta': {
                  'tool_calls': [
                    {
                      'id': 'call-1',
                      'function': {
                        'name': 'read_file',
                        'arguments': '{"path":"a.txt"}',
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\ndata: [DONE]';
      return http.StreamedResponse(
        Stream.value(utf8.encode(event)),
        200,
        headers: {'content-type': 'text/event-stream'},
      );
    });
    final model = OpenAiCompatibleModel(client: client);

    final result = await model.complete(
      config: const AgentModelConfig(
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'm',
      ),
      systemPrompt: 'agent',
      messages: const [AgentMessage.user('hi')],
      tools: const [],
      cancellationToken: AgentCancellationToken(),
      onDelta: (_) {},
    );

    expect(result.toolCalls.single.name, 'read_file');
    expect(result.toolCalls.single.arguments, {'path': 'a.txt'});
    model.dispose();
  });

  // issue #40 问题 7：HTTP 200 的 SSE 里回报失败或半截断流，过去都被当成
  // 正常完成 —— 用户看到的是半句话，且没有任何错误提示。
  group('stream failure detection on an HTTP 200 SSE', () {
    Future<AgentModelResponse> runStream(List<String> events) {
      final bytes = <int>[];
      for (final event in events) {
        bytes.addAll(utf8.encode(event));
      }
      final client = MockClient.streaming((request, bodyStream) async {
        await bodyStream.drain<void>();
        return http.StreamedResponse(
          Stream.value(bytes),
          200,
          headers: {'content-type': 'text/event-stream'},
        );
      });
      return OpenAiCompatibleModel(client: client).complete(
        config: const AgentModelConfig(
          apiKey: 'k',
          baseUrl: 'https://example.test/v1',
          model: 'm',
        ),
        systemPrompt: 'agent',
        messages: const [AgentMessage.user('hi')],
        tools: const [],
        cancellationToken: AgentCancellationToken(),
        onDelta: (_) {},
      );
    }

    String deltaChunk(String content) => jsonEncode({
          'choices': [
            {'delta': {'content': content}}
          ]
        });

    test('throws instead of returning the partial answer when truncated',
        () async {
      await expectLater(
        runStream(['data: ${deltaChunk('partial answer')}\n\n']),
        throwsA(isA<StateError>().having(
            (e) => e.message, 'message', contains('中途断开'))),
      );
    });

    test('throws the server message when an error event follows the text',
        () async {
      final events = [
        'data: ${deltaChunk('partial answer')}\n\n',
        'event: error\ndata: ${jsonEncode({
              'error': {'message': 'context length exceeded'}
            })}\n\n',
      ];

      await expectLater(
        runStream(events),
        throwsA(isA<StateError>().having((e) => e.message, 'message',
            contains('context length exceeded'))),
      );
    });

    test('accepts a stream that ends on finish_reason without [DONE]',
        () async {
      final result = await runStream([
        'data: ${jsonEncode({
          'choices': [
            {
              'delta': {'content': 'full answer'},
              'finish_reason': 'stop'
            }
          ]
        })}\n\n',
      ]);

      expect(result.text, 'full answer');
    });
  });
}
