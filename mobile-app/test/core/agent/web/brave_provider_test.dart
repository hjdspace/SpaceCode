import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/web/brave_provider.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider.dart';

void main() {
  group('BraveProvider', () {
    test('type is brave and requires api key', () {
      final provider = BraveProvider(apiKey: 'k', client: MockClient((_) async => http.Response('{}', 200)));
      expect(provider.type, WebSearchProviderType.brave);
      expect(provider.requiresApiKey, isTrue);
    });

    test('search throws StateError when api key is empty', () async {
      final provider = BraveProvider(apiKey: '', client: MockClient((_) async => http.Response('{}', 200)));
      expect(
        () => provider.search(query: 'test'),
        throwsA(isA<StateError>()),
      );
    });

    test('search sends GET to brave api with X-Subscription-Token and query params', () async {
      http.Request? captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'web': {
              'results': [
                {'title': 'B1', 'url': 'https://y.com', 'description': 'desc1'},
              ]
            }
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final provider = BraveProvider(apiKey: 'brave-key', client: client);

      final results = await provider.search(query: 'dart language', maxResults: 7);

      expect(captured!.method, 'GET');
      expect(captured!.url.host, 'api.search.brave.com');
      expect(captured!.url.path, '/res/v1/web/search');
      expect(captured!.url.queryParameters['q'], 'dart language');
      expect(captured!.url.queryParameters['count'], '7');
      expect(captured!.headers['x-subscription-token'], 'brave-key');
      expect(captured!.headers['accept'], 'application/json');
      expect(results.length, 1);
      expect(results[0].title, 'B1');
      expect(results[0].snippet, 'desc1');
    });

    test('search throws WebSearchException on HTTP 429', () async {
      final client = MockClient((_) async => http.Response('rate', 429));
      final provider = BraveProvider(apiKey: 'k', client: client);
      expect(
        () => provider.search(query: 't'),
        throwsA(isA<WebSearchException>()),
      );
    });

    test('search returns empty list when web.results absent', () async {
      final client = MockClient((_) async => http.Response(
          jsonEncode({}), 200,
          headers: {'content-type': 'application/json'}));
      final provider = BraveProvider(apiKey: 'k', client: client);
      final results = await provider.search(query: 't');
      expect(results, isEmpty);
    });
  });
}
