import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/web/tavily_provider.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider.dart';

void main() {
  group('TavilyProvider', () {
    test('type is tavily and requires api key', () {
      final provider = TavilyProvider(apiKey: 'k', client: MockClient((_) async => http.Response('{}', 200)));
      expect(provider.type, WebSearchProviderType.tavily);
      expect(provider.requiresApiKey, isTrue);
    });

    test('search throws StateError when api key is empty', () async {
      final provider = TavilyProvider(apiKey: '', client: MockClient((_) async => http.Response('{}', 200)));
      expect(
        () => provider.search(query: 'test'),
        throwsA(isA<StateError>()),
      );
    });

    test('search sends POST to api.tavily.com/search with bearer token and body', () async {
      http.Request? capturedReq;
      String? capturedBody;
      final client = MockClient((request) async {
        capturedReq = request;
        capturedBody = request.body;
        return http.Response(
          jsonEncode({
            'results': [
              {'title': 'T1', 'url': 'https://x.com', 'content': 'c1'},
            ]
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final provider = TavilyProvider(apiKey: 'tavily-key', client: client);

      final results = await provider.search(query: 'rust async', maxResults: 3);

      expect(capturedReq!.method, 'POST');
      expect(capturedReq!.url.toString(), 'https://api.tavily.com/search');
      expect(capturedReq!.headers['authorization'], 'Bearer tavily-key');
      expect(capturedReq!.headers['content-type'], 'application/json');
      final body = jsonDecode(capturedBody!) as Map<String, dynamic>;
      expect(body['query'], 'rust async');
      expect(body['max_results'], 3);
      expect(body['search_depth'], 'basic');
      expect(results.length, 1);
      expect(results[0].title, 'T1');
      expect(results[0].snippet, 'c1');
    });

    test('search throws WebSearchException on HTTP 429', () async {
      final client = MockClient((_) async => http.Response('rate', 429));
      final provider = TavilyProvider(apiKey: 'k', client: client);
      expect(
        () => provider.search(query: 't'),
        throwsA(isA<WebSearchException>()),
      );
    });

    test('search returns empty list when results field absent', () async {
      final client = MockClient((_) async => http.Response(
          jsonEncode({}), 200,
          headers: {'content-type': 'application/json'}));
      final provider = TavilyProvider(apiKey: 'k', client: client);
      final results = await provider.search(query: 't');
      expect(results, isEmpty);
    });
  });
}
