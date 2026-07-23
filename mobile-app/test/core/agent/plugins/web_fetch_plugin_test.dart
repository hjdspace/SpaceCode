import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/plugins/web_fetch_plugin.dart';

void main() {
  AgentCancellationToken token() => AgentCancellationToken();

  group('WebFetchPlugin', () {
    test('exposes single fetch_url tool with correct definition', () {
      final plugin = WebFetchPlugin(client: MockClient((_) async => http.Response('{}', 200)));
      final tools = plugin.createTools();
      expect(tools, hasLength(1));
      final def = tools.first.definition;
      expect(def.name, 'fetch_url');
      final props = def.inputSchema['properties'] as Map<String, dynamic>;
      expect(props.containsKey('url'), isTrue);
      expect(props.containsKey('max_chars'), isTrue);
      expect(def.inputSchema['required'], ['url']);
    });

    test('execute sends GET to r.jina.ai/<url> with Accept json', () async {
      http.Request? captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'data': {'content': '# Title\nbody text'}
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final plugin = WebFetchPlugin(client: client);
      final tool = plugin.createTools().single;

      final result = await tool.execute(
        {'url': 'https://example.com/article'}, token());

      expect(captured!.method, 'GET');
      expect(captured!.url.toString(),
          'https://r.jina.ai/https://example.com/article');
      expect(captured!.headers['accept'], 'application/json');
      expect(result.isError, isFalse);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['url'], 'https://example.com/article');
      expect(decoded['content'], '# Title\nbody text');
      expect(decoded['truncated'], isFalse);
      expect(decoded['chars'], '# Title\nbody text'.length);
    });

    test('execute truncates content to max_chars and sets truncated true', () async {
      final longContent = 'a' * 30000;
      final client = MockClient((_) async => http.Response(
          jsonEncode({'data': {'content': longContent}}), 200,
          headers: {'content-type': 'application/json'}));
      final plugin = WebFetchPlugin(client: client);
      final tool = plugin.createTools().single;

      final result = await tool.execute(
        {'url': 'https://x.com', 'max_chars': 5000}, token());

      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['truncated'], isTrue);
      expect((decoded['content'] as String).length, 5000);
      expect(decoded['chars'], 5000);
    });

    test('execute clamps max_chars to 1000..50000', () async {
      final client = MockClient((_) async => http.Response(
          jsonEncode({'data': {'content': 'short'}}), 200,
          headers: {'content-type': 'application/json'}));
      final plugin = WebFetchPlugin(client: client);
      final tool = plugin.createTools().single;

      // max_chars=0 → clamp 到 1000,但 content 仅 5 字符,不截断
      var result = await tool.execute(
        {'url': 'https://x.com', 'max_chars': 0}, token());
      var decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['content'], 'short');
      expect(decoded['truncated'], isFalse);
    });

    test('execute returns isError for invalid url', () async {
      final plugin = WebFetchPlugin(client: MockClient((_) async => http.Response('{}', 200)));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'url': 'not-a-url'}, token());
      expect(result.isError, isTrue);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['error'], contains('URL'));
    });

    test('execute returns isError for empty url', () async {
      final plugin = WebFetchPlugin(client: MockClient((_) async => http.Response('{}', 200)));
      final tool = plugin.createTools().single;

      final result = await tool.execute({'url': ''}, token());
      expect(result.isError, isTrue);
    });

    test('execute returns isError on HTTP 429', () async {
      final client = MockClient((_) async => http.Response('rate', 429));
      final plugin = WebFetchPlugin(client: client);
      final tool = plugin.createTools().single;

      final result = await tool.execute(
        {'url': 'https://example.com'}, token());
      expect(result.isError, isTrue);
      final decoded = jsonDecode(result.content) as Map<String, dynamic>;
      expect(decoded['error'], contains('频繁'));
    });
  });
}
