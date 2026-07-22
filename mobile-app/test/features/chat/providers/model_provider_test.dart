import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'package:spacecode_mobile/features/chat/providers/model_provider.dart';

class _MockClient extends http.BaseClient {
  final http.Response Function(http.BaseRequest request) onSend;

  _MockClient(this.onSend);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = onSend(request);
    final bytes = utf8.encode(response.body);
    return http.StreamedResponse(
      Stream.fromIterable([bytes]),
      response.statusCode,
      headers: response.headers,
      request: request,
      contentLength: bytes.length,
    );
  }
}

void main() {
  group('ModelService', () {
    test('fetchModels returns model ids from OpenAI compatible /models response',
        () async {
      final client = _MockClient((request) {
        expect(request.url.toString(), 'https://api.example.com/v1/models');
        expect(request.headers['Authorization'], 'Bearer test-key');
        return http.Response(
          jsonEncode({
            'data': [
              {'id': 'gpt-4o'},
              {'id': 'gpt-4o-mini'},
              {'id': 'custom-model'},
            ],
          }),
          200,
        );
      });

      final service = ModelService(
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com/v1',
        client: client,
      );

      final models = await service.fetchModels();

      expect(models, ['gpt-4o', 'gpt-4o-mini', 'custom-model']);
    });

    test('fetchModels falls back to defaultModels on HTTP 500', () async {
      final client = _MockClient((request) {
        return http.Response('Internal Server Error', 500);
      });

      final service = ModelService(
        apiKey: 'test-key',
        baseUrl: 'https://api.example.com/v1',
        client: client,
      );

      final models = await service.fetchModels();

      expect(models, ModelService.defaultModels);
    });
  });
}
