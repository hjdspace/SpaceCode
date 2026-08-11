import 'dart:convert';

import 'package:http/http.dart' as http;

import '../agent_model.dart';
import '../agent_plugin.dart';
import '../agent_types.dart';

/// 提供 `fetch_url` 工具,固定调用 Jina r.jina.ai 抓取网页全文转 Markdown。
///
/// 独立于 [WebSearchPlugin] 的 provider 选择,所有 provider 下均可用。
/// 不执行 JS,适合静态文章/文档/博客。
class WebFetchPlugin extends AgentPlugin {
  final http.Client client;
  final Duration timeout;

  WebFetchPlugin({http.Client? client, Duration? timeout})
      : client = client ?? http.Client(),
        timeout = timeout ?? const Duration(seconds: 30);

  static const int _minChars = 1000;
  static const int _maxChars = 50000;
  static const int _defaultChars = 20000;

  @override
  List<AgentTool> createTools() => [_FetchUrlTool(this)];
}

class _FetchUrlTool extends AgentTool {
  final WebFetchPlugin plugin;
  _FetchUrlTool(this.plugin);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'fetch_url',
        description: '抓取指定网页全文并转为 Markdown。'
            '当需要阅读 web_search 返回的某个 URL 的完整内容时使用。'
            '不执行 JS,适合静态文章/文档/博客。需要 JS 渲染的动态页面内容可能不全。',
        inputSchema: {
          'type': 'object',
          'properties': {
            'url': {
              'type': 'string',
              'description': '要抓取的完整 URL(含 http/https)',
            },
            'max_chars': {
              'type': 'integer',
              'description': '返回内容最大字符数,默认 20000,范围 1000-50000',
              'default': 20000,
            },
          },
          'required': ['url'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    cancellationToken.throwIfCancelled();

    final url = (arguments['url'] as String? ?? '').trim();
    if (url.isEmpty) {
      return const AgentToolResult(
        content: '{"error":"url must not be empty"}',
        isError: true,
      );
    }
    final uri = Uri.tryParse(url);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty ||
        (uri.scheme != 'http' && uri.scheme != 'https')) {
      return const AgentToolResult(
        content: '{"error":"URL 格式无效,必须是 http/https 完整地址"}',
        isError: true,
      );
    }

    final rawMax = arguments['max_chars'] as int? ??
        WebFetchPlugin._defaultChars;
    final maxChars =
        rawMax.clamp(WebFetchPlugin._minChars, WebFetchPlugin._maxChars);

    try {
      final response = await plugin.client
          .get(
            Uri.parse('https://r.jina.ai/$url'),
            headers: {'accept': 'application/json'},
          )
          .timeout(plugin.timeout);

      if (response.statusCode == 429) {
        return const AgentToolResult(
          content: '{"error":"请求过于频繁,请稍后重试"}',
          isError: true,
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return AgentToolResult(
          content: jsonEncode({
            'error': '抓取失败 (HTTP ${response.statusCode})',
          }),
          isError: true,
        );
      }

      final decoded = jsonDecode(response.body);
      String content = '';
      if (decoded is Map<String, dynamic>) {
        final data = decoded['data'];
        if (data is Map<String, dynamic>) {
          content = (data['content'] ?? '').toString();
        } else {
          content = (decoded['content'] ?? '').toString();
        }
      }

      final bool truncated = content.length > maxChars;
      final String truncatedContent =
          truncated ? content.substring(0, maxChars) : content;
      return AgentToolResult(
        content: jsonEncode({
          'url': url,
          'content': truncatedContent,
          'truncated': truncated,
          'chars': truncatedContent.length,
        }),
      );
    } catch (e) {
      return AgentToolResult(
        content: jsonEncode({'error': '抓取失败: $e'}),
        isError: true,
      );
    }
  }
}
