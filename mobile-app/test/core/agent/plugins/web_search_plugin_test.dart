import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_plugin.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/plugins/web_search_plugin.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider.dart';

/// 可控的假 Provider,用于注入测试。
class _FakeProvider implements WebSearchProvider {
  final List<WebSearchResult> results;
  final Object? error;
  _FakeProvider(this.results, {this.error});

  @override
  WebSearchProviderType get type => WebSearchProviderType.jina;

  @override
  bool get requiresApiKey => false;

  @override
  Future<List<WebSearchResult>> search({
    required String query,
    int maxResults = 5,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    if (error != null) throw error!;
    return results.take(maxResults).toList(growable: false);
  }
}

void main() {
  AgentCancellationToken token() => AgentCancellationToken();

  group('WebSearchPlugin', () {
    test('exposes single web_search tool with correct definition', () {
      final plugin = WebSearchPlugin(_FakeProvider(const []));
      final tools = plugin.createTools();
      expect(tools, hasLength(1));
      final def = tools.first.definition;
      expect(def.name, 'web_search');
      final props = def.inputSchema['properties'] as Map<String, dynamic>;
      expect(props.containsKey('query'), isTrue);
      expect(props.containsKey('max_results'), isTrue);
      expect(def.inputSchema['required'], ['query']);
    });

    test('execute returns JSON results array with count and provider', () async {
      final plugin = WebSearchPlugin(_FakeProvider([
        const WebSearchResult(title: 'T1', url: 'https://a.com', snippet: 's1'),
        const WebSearchResult(title: 'T2', url: 'https://b.com', snippet: 's2'),
      ]));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'query': 'flutter'}, token());

      expect(result.isError, isFalse);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['count'], 2);
      expect(decoded['provider'], 'jina');
      final results = decoded['results'] as List;
      expect(results[0]['title'], 'T1');
      expect(results[0]['url'], 'https://a.com');
      expect(results[0]['snippet'], 's1');
    });

    test('execute truncates snippet beyond 1000 chars', () async {
      final longSnippet = 'x' * 1500;
      final plugin = WebSearchPlugin(_FakeProvider([
        WebSearchResult(title: 'T', url: 'https://a.com', snippet: longSnippet),
      ]));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'query': 'q'}, token());

      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      final results = decoded['results'] as List;
      expect((results[0]['snippet'] as String).length, 1000);
    });

    test('execute clamps max_results to 1..10', () async {
      final plugin = WebSearchPlugin(_FakeProvider([
        const WebSearchResult(title: 'T', url: 'u', snippet: 's'),
      ]));
      final tool = plugin.createTools().single;

      // max_results=0 → clamp 到 1
      var result = await tool.execute({'query': 'q', 'max_results': 0}, token());
      var decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['count'], 1);

      // max_results=999 → clamp 到 10,但 provider 只有 1 条
      result = await tool.execute({'query': 'q', 'max_results': 999}, token());
      decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['count'], 1);
    });

    test('execute returns count 0 for empty results', () async {
      final plugin = WebSearchPlugin(_FakeProvider(const []));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'query': 'nothing'}, token());

      expect(result.isError, isFalse);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['count'], 0);
      expect(decoded['results'], isEmpty);
    });

    test('execute returns isError when provider throws WebSearchException', () async {
      final plugin = WebSearchPlugin(_FakeProvider(
        const [],
        error: const WebSearchException('rate limited', statusCode: 429),
      ));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'query': 'q'}, token());

      expect(result.isError, isTrue);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['error'], contains('rate limited'));
    });

    test('execute returns isError for empty query', () async {
      final plugin = WebSearchPlugin(_FakeProvider(const []));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'query': ''}, token());

      expect(result.isError, isTrue);
    });
  });
}
