import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/web/jina_provider.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider.dart';

void main() {
  group('JinaProvider', () {
    test('type is jina and does not require api key', () {
      final provider = JinaProvider(client: MockClient((_) async => http.Response('{}', 200)));
      expect(provider.type, WebSearchProviderType.jina);
      expect(provider.requiresApiKey, isFalse);
    });

    test('search sends GET to s.jina.ai with Accept json header', () async {
      http.Request? captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'data': [
              {'title': 'Result 1', 'url': 'https://a.com', 'content': 'snippet 1'},
              {'title': 'Result 2', 'url': 'https://b.com', 'content': 'snippet 2'},
            ]
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final provider = JinaProvider(client: client);

      final results = await provider.search(query: 'flutter', maxResults: 5);

      expect(captured!.method, 'GET');
      expect(captured!.url.toString(),
          'https://s.jina.ai/flutter');
      expect(captured!.headers['accept'], 'application/json');
      expect(results.length, 2);
      expect(results[0].title, 'Result 1');
      expect(results[0].url, 'https://a.com');
      expect(results[0].snippet, 'snippet 1');
    });

    test('search includes Authorization header when api key provided', () async {
      http.Request? captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(jsonEncode({'data': []}), 200,
            headers: {'content-type': 'application/json'});
      });
      final provider = JinaProvider(apiKey: 'jina-key-123', client: client);

      await provider.search(query: 'test');

      expect(captured!.headers['authorization'], 'Bearer jina-key-123');
    });

    test('search without api key omits Authorization header', () async {
      http.Request? captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(jsonEncode({'data': []}), 200,
            headers: {'content-type': 'application/json'});
      });
      final provider = JinaProvider(client: client);

      await provider.search(query: 'test');

      expect(captured!.headers.containsKey('authorization'), isFalse);
    });

    test('search throws WebSearchException on HTTP 429', () async {
      final client = MockClient((_) async => http.Response('rate limited', 429));
      final provider = JinaProvider(client: client);

      expect(
        () => provider.search(query: 'test'),
        throwsA(isA<WebSearchException>()),
      );
    });

    test('search converts client connection failures to WebSearchException',
        () async {
      final client = MockClient(
        (request) async =>
            throw http.ClientException('Network is unreachable', request.url),
      );
      final provider = JinaProvider(client: client);

      expect(
        () => provider.search(query: 'test'),
        throwsA(
          isA<WebSearchException>().having(
            (error) => error.message,
            'message',
            contains('无法连接 Jina 搜索服务'),
          ),
        ),
      );
    });

    test('search returns empty list when data field is empty', () async {
      final client = MockClient((_) async => http.Response(
          jsonEncode({'data': []}), 200,
          headers: {'content-type': 'application/json'}));
      final provider = JinaProvider(client: client);

      final results = await provider.search(query: 'nothing');
      expect(results, isEmpty);
    });
  });
}
