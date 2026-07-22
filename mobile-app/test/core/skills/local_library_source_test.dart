import 'dart:convert';

import 'package:flutter/foundation.dart' show FlutterError;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/local_library_source.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('LocalLibrarySource', () {
    test('load returns parsed index on valid JSON', () async {
      const indexJson = '''
{
  "version": 1,
  "generatedAt": "2026-07-20T10:00:00Z",
  "skills": [
    {
      "name": "code-review",
      "description": "Review changes",
      "category": "development",
      "assetPath": "assets/skills-lib/code-review/SKILL.md"
    }
  ]
}
''';
      // 注册 mock asset bundle
      final bundle = _MockAssetBundle({
        'assets/skills-lib/index.json': indexJson,
      });
      final source = LocalLibrarySource(bundle: bundle);

      final index = await source.load();

      expect(index.version, 1);
      expect(index.skills.length, 1);
      expect(index.skills[0].name, 'code-review');
      expect(index.skills[0].description, 'Review changes');
      expect(index.skills[0].category, 'development');
    });

    test('load returns empty index when asset missing', () async {
      final bundle = _MockAssetBundle({});
      final source = LocalLibrarySource(bundle: bundle);

      final index = await source.load();

      expect(index.skills, isEmpty);
    });

    test('load returns empty index on invalid JSON', () async {
      final bundle = _MockAssetBundle({
        'assets/skills-lib/index.json': 'not valid json {{{',
      });
      final source = LocalLibrarySource(bundle: bundle);

      final index = await source.load();

      expect(index.skills, isEmpty);
    });

    test('load returns empty index on valid JSON but invalid structure', () async {
      final bundle = _MockAssetBundle({
        'assets/skills-lib/index.json': '"just a string"',
      });
      final source = LocalLibrarySource(bundle: bundle);

      final index = await source.load();

      expect(index.skills, isEmpty);
    });

    test('load uses default rootBundle when no bundle provided', () async {
      // 验证默认构造不抛异常（仅验证构造可用，不实际加载）
      final source = LocalLibrarySource();
      expect(source, isNotNull);
    });
  });
}

class _MockAssetBundle extends CachingAssetBundle {
  final Map<String, String> assets;

  _MockAssetBundle(this.assets);

  @override
  Future<String> loadString(String key, {bool cache = true}) async {
    final value = assets[key];
    if (value == null) {
      throw FlutterError('Unable to load asset: $key');
    }
    return value;
  }

  @override
  Future<ByteData> load(String key) async {
    final value = assets[key];
    if (value == null) {
      throw FlutterError('Unable to load asset: $key');
    }
    return ByteData.sublistView(utf8.encode(value));
  }
}
