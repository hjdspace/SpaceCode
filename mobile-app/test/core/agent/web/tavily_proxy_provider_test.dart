import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/web/tavily_proxy_provider.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider.dart';

void main() {
  group('TavilyProxyProvider', () {
    test('type is tavilyProxy and does not require api key', () {
      final provider = TavilyProxyProvider(
          client: MockClient((_) async => http.Response('{}', 200)));
      expect(provider.type, WebSearchProviderType.tavilyProxy);
      expect(provider.requiresApiKey, isFalse);
    });

    test('default endpoint aligns with desktop engine tavilyAdapter', () {
      expect(TavilyProxyProvider.defaultEndpoint,
          'https://tavily.claude-code-best.win/search');
    });

    test('search sends POST to proxy endpoint without auth header', () async {
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
      final provider = TavilyProxyProvider(client: client);

      final results = await provider.search(query: 'rust async', maxResults: 3);

      expect(capturedReq!.method, 'POST');
      expect(capturedReq!.url.toString(),
          'https://tavily.claude-code-best.win/search');
      // 免 Key 代理:不应携带 authorization 头
      expect(capturedReq!.headers.containsKey('authorization'), isFalse);
      expect(capturedReq!.headers['content-type'], 'application/json');
      final body = jsonDecode(capturedBody!) as Map<String, dynamic>;
      expect(body['query'], 'rust async');
      expect(body['max_results'], 3);
      expect(body['search_depth'], 'basic');
      expect(body['include_domains'], isEmpty);
      expect(body['exclude_domains'], isEmpty);
      expect(results.length, 1);
      expect(results[0].title, 'T1');
      expect(results[0].url, 'https://x.com');
      expect(results[0].snippet, 'c1');
    });

    test('search throws WebSearchException on HTTP 429', () async {
      final client = MockClient((_) async => http.Response('rate', 429));
      final provider = TavilyProxyProvider(client: client);
      expect(
        () => provider.search(query: 't'),
        throwsA(isA<WebSearchException>()),
      );
    });

    test('search returns empty list when results field absent', () async {
      final client = MockClient((_) async => http.Response(
          jsonEncode({}), 200,
          headers: {'content-type': 'application/json'}));
      final provider = TavilyProxyProvider(client: client);
      final results = await provider.search(query: 't');
      expect(results, isEmpty);
    });
  });
}
