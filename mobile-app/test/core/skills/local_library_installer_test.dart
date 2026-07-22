import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart' show FlutterError;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';
import 'package:spacecode_mobile/core/skills/local_library_installer.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('local_lib_installer_test_');
    PathProviderPlatform.instance = _MockPathProvider(tempDir.path);
  });

  tearDown(() async {
    if (await tempDir.exists()) {
      await tempDir.delete(recursive: true);
    }
  });

  group('LocalLibraryInstaller', () {
    test('install writes SKILL.md to user skills directory', () async {
      const skillContent = '''---
name: code-review
description: Review changes
---

# Code Review
''';
      final bundle = _MockAssetBundle({
        'assets/skills-lib/code-review/SKILL.md': skillContent,
      });
      final installer = LocalLibraryInstaller(bundle: bundle);

      const skill = LocalLibrarySkill(
        name: 'code-review',
        description: 'Review changes',
        category: 'development',
        assetPath: 'assets/skills-lib/code-review/SKILL.md',
      );

      final installedPath = await installer.install(skill);

      // 验证返回的目标目录路径
      expect(installedPath, contains('spacecode/skills/code-review'));

      // 验证文件实际写入
      final writtenFile = File('$installedPath/SKILL.md');
      expect(await writtenFile.exists(), true);
      expect(await writtenFile.readAsString(), skillContent);
    });

    test('install creates target directory if not exists', () async {
      const skillContent = '---\nname: foo\ndescription: bar\n---\n';
      final bundle = _MockAssetBundle({
        'assets/skills-lib/foo/SKILL.md': skillContent,
      });
      final installer = LocalLibraryInstaller(bundle: bundle);

      const skill = LocalLibrarySkill(
        name: 'foo',
        description: 'bar',
        category: 'other',
        assetPath: 'assets/skills-lib/foo/SKILL.md',
      );

      final installedPath = await installer.install(skill);

      final dir = Directory(installedPath);
      expect(await dir.exists(), true);
    });

    test('install overwrites existing SKILL.md (idempotent)', () async {
      const originalContent = '---\nname: foo\n---\nold content';
      const newContent = '---\nname: foo\n---\nnew content';

      // 预先创建目录和文件
      final targetDir = Directory('${tempDir.path}/spacecode/skills/foo');
      await targetDir.create(recursive: true);
      await File('${targetDir.path}/SKILL.md').writeAsString(originalContent);

      final bundle = _MockAssetBundle({
        'assets/skills-lib/foo/SKILL.md': newContent,
      });
      final installer = LocalLibraryInstaller(bundle: bundle);

      const skill = LocalLibrarySkill(
        name: 'foo',
        description: '',
        category: 'other',
        assetPath: 'assets/skills-lib/foo/SKILL.md',
      );

      await installer.install(skill);

      final writtenFile = File('${targetDir.path}/SKILL.md');
      expect(await writtenFile.readAsString(), newContent);
    });

    test('install throws when asset not found', () async {
      final bundle = _MockAssetBundle({});
      final installer = LocalLibraryInstaller(bundle: bundle);

      const skill = LocalLibrarySkill(
        name: 'missing',
        description: '',
        category: 'other',
        assetPath: 'assets/skills-lib/missing/SKILL.md',
      );

      expect(() => installer.install(skill), throwsA(isA<Object>()));
    });
  });
}

class _MockPathProvider extends PathProviderPlatform {
  final String appDocsPath;

  _MockPathProvider(this.appDocsPath);

  @override
  Future<String?> getApplicationDocumentsPath() async => appDocsPath;
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
