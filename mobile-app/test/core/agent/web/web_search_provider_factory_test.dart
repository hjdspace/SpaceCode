import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/agent/web/brave_provider.dart';
import 'package:spacecode_mobile/core/agent/web/jina_provider.dart';
import 'package:spacecode_mobile/core/agent/web/tavily_provider.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider.dart';
import 'package:spacecode_mobile/core/agent/web/web_search_provider_factory.dart';

void main() {
  final mockClient = MockClient((_) async => http.Response('{}', 200));

  group('WebSearchProviderFactory', () {
    test('create jina returns JinaProvider', () {
      final p = WebSearchProviderFactory.create(
        WebSearchProviderType.jina,
        client: mockClient,
      );
      expect(p, isA<JinaProvider>());
      expect(p.type, WebSearchProviderType.jina);
      expect(p.requiresApiKey, isFalse);
    });

    test('create tavily returns TavilyProvider', () {
      final p = WebSearchProviderFactory.create(
        WebSearchProviderType.tavily,
        apiKey: 'k',
        client: mockClient,
      );
      expect(p, isA<TavilyProvider>());
      expect(p.type, WebSearchProviderType.tavily);
    });

    test('create brave returns BraveProvider', () {
      final p = WebSearchProviderFactory.create(
        WebSearchProviderType.brave,
        apiKey: 'k',
        client: mockClient,
      );
      expect(p, isA<BraveProvider>());
      expect(p.type, WebSearchProviderType.brave);
    });

    test('create tavily with null apiKey defaults to empty string', () {
      final p = WebSearchProviderFactory.create(
        WebSearchProviderType.tavily,
        client: mockClient,
      ) as TavilyProvider;
      expect(p.apiKey, '');
    });
  });
}
