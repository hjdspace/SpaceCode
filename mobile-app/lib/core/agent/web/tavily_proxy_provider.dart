import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'web_search_provider.dart';

/// Tavily 自建免费代理实现(对齐桌面端 engine 的 tavilyAdapter)。
///
/// 桌面端默认通过自建代理 `https://tavily.claude-code-best.win/search` 免 Key
/// 免费使用联网搜索,手机端复用同一端点,实现零配置可用。
///
/// 端点:POST https://tavily.claude-code-best.win/search
/// Header:Content-Type: application/json (无认证)
/// Body:{ query, search_depth: "basic", max_results, include_domains: [], exclude_domains: [] }
/// 响应:{ results: [ { title, url, content, score } ] }
class TavilyProxyProvider implements WebSearchProvider {
  /// 桌面端 engine 内置的默认 Tavily 代理端点(免 Key 免费)。
  static const String defaultEndpoint =
      'https://tavily.claude-code-best.win/search';

  final String endpoint;
  final http.Client client;

  TavilyProxyProvider({this.endpoint = defaultEndpoint, http.Client? client})
      : client = client ?? http.Client();

  @override
  WebSearchProviderType get type => WebSearchProviderType.tavilyProxy;

  @override
  bool get requiresApiKey => false;

  @override
  Future<List<WebSearchResult>> search({
    required String query,
    int maxResults = 5,
    Duration timeout = const Duration(seconds: 30),
  }) async {
    final http.Response response;
    try {
      response = await client
          .post(
            Uri.parse(endpoint),
            headers: {'content-type': 'application/json'},
            body: jsonEncode({
              'query': query,
              'search_depth': 'basic',
              'max_results': maxResults,
              'include_domains': <String>[],
              'exclude_domains': <String>[],
            }),
          )
          .timeout(timeout);
    } on TimeoutException {
      throw const WebSearchException('搜索请求超时,请检查网络后重试');
    } on SocketException {
      throw const WebSearchException('无法连接搜索服务,请检查网络或代理');
    } on http.ClientException {
      throw const WebSearchException('无法连接搜索服务,请检查网络或代理');
    }

    if (response.statusCode == 429) {
      throw const WebSearchException('请求过于频繁,请稍后重试', statusCode: 429);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final body = response.body;
      throw WebSearchException(
        'Tavily 代理搜索失败: ${body.length > 500 ? body.substring(0, 500) : body}',
        statusCode: response.statusCode,
      );
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) return const [];
    final results = decoded['results'];
    if (results is! List) return const [];
    return results
        .whereType<Map<String, dynamic>>()
        .take(maxResults)
        .map((item) => WebSearchResult(
              title: (item['title'] ?? '').toString(),
              url: (item['url'] ?? '').toString(),
              snippet: (item['content'] ?? '').toString(),
            ))
        .toList(growable: false);
  }
}
