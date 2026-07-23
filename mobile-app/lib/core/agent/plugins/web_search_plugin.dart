import 'dart:convert';

import '../agent_model.dart';
import '../agent_plugin.dart';
import '../agent_types.dart';
import '../web/web_search_provider.dart';

/// 提供 `web_search` 工具,委托 [WebSearchProvider] 执行搜索。
class WebSearchPlugin extends AgentPlugin {
  final WebSearchProvider provider;
  WebSearchPlugin(this.provider);

  static const int _maxSnippetChars = 1000;
  static const int _minResults = 1;
  static const int _maxResults = 10;
  static const int _defaultResults = 5;

  @override
  List<AgentTool> createTools() => [_WebSearchTool(this)];
}

class _WebSearchTool extends AgentTool {
  final WebSearchPlugin plugin;
  _WebSearchTool(this.plugin);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'web_search',
        description: '搜索互联网获取实时信息(新闻、天气、最新文档、股价等)。'
            '当问题涉及训练数据之后的事件或需要最新信息时使用。'
            '返回标题、摘要和 URL。需要全文时用 fetch_url 抓取。',
        inputSchema: {
          'type': 'object',
          'properties': {
            'query': {
              'type': 'string',
              'description': '搜索关键词',
            },
            'max_results': {
              'type': 'integer',
              'description': '返回结果数,默认 5,范围 1-10',
              'default': 5,
            },
          },
          'required': ['query'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    cancellationToken.throwIfCancelled();

    final query = (arguments['query'] as String? ?? '').trim();
    if (query.isEmpty) {
      return const AgentToolResult(
        content: '{"error":"query must not be empty"}',
        isError: true,
      );
    }

    final rawMax = arguments['max_results'] as int? ??
        WebSearchPlugin._defaultResults;
    final maxResults = rawMax.clamp(
        WebSearchPlugin._minResults, WebSearchPlugin._maxResults);

    try {
      final results = await plugin.provider.search(
        query: query,
        maxResults: maxResults,
      );
      final serialized = results
          .map((r) => WebSearchResult(
                title: r.title,
                url: r.url,
                snippet: r.snippet.length > WebSearchPlugin._maxSnippetChars
                    ? r.snippet.substring(0, WebSearchPlugin._maxSnippetChars)
                    : r.snippet,
              ).toJson())
          .toList();
      return AgentToolResult(
        content: jsonEncode({
          'results': serialized,
          'count': serialized.length,
          'provider': plugin.provider.type.name,
        }),
      );
    } on WebSearchException catch (e) {
      return AgentToolResult(
        content: jsonEncode({'error': e.message}),
        isError: true,
      );
    } on StateError catch (e) {
      return AgentToolResult(
        content: jsonEncode({'error': e.message}),
        isError: true,
      );
    } catch (e) {
      return AgentToolResult(
        content: jsonEncode({'error': '搜索失败: $e'}),
        isError: true,
      );
    }
  }
}
