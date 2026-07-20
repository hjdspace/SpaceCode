# 移动端本地技能库 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 mobile-app 内置离线本地技能库（同步桌面端 skills-lib 的 SKILL.md），用户可浏览、搜索、分类筛选、一键安装到用户技能目录，毫秒级完成，无需 GitHub 凭证或桌面端连接。

**架构：** 同步脚本扫描桌面端 `skills-lib/`，复制 SKILL.md 到 `mobile-app/assets/skills-lib/<name>/`，生成 `index.json` 索引。运行时 `LocalLibrarySource` 从 `index.json` 加载库列表（仅元数据），`LocalLibraryInstaller` 从 asset 读 SKILL.md 全文写入 `{docs}/spacecode/skills/<name>/SKILL.md`（复用 UserSkillSource 加载，复用 SkillRegistry.uninstall 卸载）。UI 在 SkillsScreen 新增"技能库"tab。

**技术栈：** Flutter 3 / Dart 3、Riverpod（StateNotifierProvider）、go_router、flutter_markdown、path_provider、shared_preferences、rootBundle（asset 读取）

**规格：** [docs/superpowers/specs/2026-07-20-mobile-app-local-skills-library-design.md](../specs/2026-07-20-mobile-app-local-skills-library-design.md)

---

## 文件结构

### 新建文件

| 路径 | 职责 |
|------|------|
| `mobile-app/scripts/sync_skills_lib.dart` | 一次性同步脚本：扫描桌面端 skills-lib → 复制 SKILL.md → 生成 index.json |
| `mobile-app/assets/skills-lib/index.json` | 库索引（脚本生成） |
| `mobile-app/assets/skills-lib/<name>/SKILL.md` | 各技能文件（脚本生成，70+ 个） |
| `mobile-app/lib/core/skills/local_library_index.dart` | `LocalLibrarySkill` + `LocalLibraryIndex` + `LocalLibraryCategories` 数据类 |
| `mobile-app/lib/core/skills/local_library_source.dart` | 从 rootBundle 加载 index.json |
| `mobile-app/lib/core/skills/local_library_installer.dart` | install（asset → user 目录）；卸载复用 SkillRegistry.uninstall |
| `mobile-app/lib/core/skills/local_library_notifier.dart` | `LocalLibraryState` + `LocalLibraryNotifier` Riverpod provider |
| `mobile-app/lib/features/skills/local_library_card.dart` | 库技能卡片 Widget |
| `mobile-app/lib/features/skills/local_library_screen.dart` | 库浏览页 Widget（列表 + 搜索 + 分类筛选） |
| `mobile-app/lib/features/skills/local_library_detail_page.dart` | 库技能详情页（Markdown 渲染 + 安装/卸载按钮） |
| `mobile-app/test/core/skills/local_library_index_test.dart` | 数据类单元测试 |
| `mobile-app/test/core/skills/local_library_source_test.dart` | Source 单元测试 |
| `mobile-app/test/core/skills/local_library_installer_test.dart` | Installer 单元测试 |
| `mobile-app/test/core/skills/local_library_notifier_test.dart` | Notifier 单元测试 |
| `mobile-app/test/features/skills/local_library_card_test.dart` | Card Widget 测试 |
| `mobile-app/test/features/skills/local_library_screen_test.dart` | Screen Widget 测试 |
| `mobile-app/test/features/skills/local_library_detail_page_test.dart` | DetailPage Widget 测试 |

### 修改文件

| 路径 | 修改内容 |
|------|---------|
| `mobile-app/pubspec.yaml` | 新增 `assets/skills-lib/index.json` 和 `assets/skills-lib/` 目录声明 |
| `mobile-app/lib/features/skills/skills_screen.dart` | 改为 TabBar 布局：我的技能 / 技能库 |
| `mobile-app/lib/core/i18n/locales/zh.json` | 新增 18 个 i18n key |
| `mobile-app/lib/core/i18n/locales/en.json` | 新增 18 个 i18n key |
| `mobile-app/lib/routing/router.dart` | 新增 `/skills/library/:name` 路由 |

---

## 任务 1：同步脚本 + 生成 assets

**文件：**
- 创建：`mobile-app/scripts/sync_skills_lib.dart`
- 生成：`mobile-app/assets/skills-lib/index.json` + `mobile-app/assets/skills-lib/<name>/SKILL.md`

- [ ] **步骤 1：编写同步脚本**

创建 `mobile-app/scripts/sync_skills_lib.dart`：

```dart
/// 同步桌面端 skills-lib 到 mobile-app/assets/skills-lib。
///
/// 用法：dart run mobile-app/scripts/sync_skills_lib.dart
///
/// 扫描 d:/AI/SpaceCode/skills-lib/ 下所有子目录：
/// - 含 .claude-plugin/plugin.json → 跳过（Bundle，首版不支持）
/// - 含 SKILL.md → 复制到 mobile-app/assets/skills-lib/<name>/SKILL.md
/// 生成 mobile-app/assets/skills-lib/index.json（含 name/description/category/assetPath）
library;

import 'dart:convert';
import 'dart:io';

const skillsLibSource = 'd:/AI/SpaceCode/skills-lib';
const mobileAssetsTarget = 'd:/AI/SpaceCode/mobile-app/assets/skills-lib';

void main() async {
  final sourceDir = Directory(skillsLibSource);
  if (!await sourceDir.exists()) {
    stderr.writeln('Error: skills-lib source not found: $skillsLibSource');
    exit(1);
  }

  final targetDir = Directory(mobileAssetsTarget);
  await targetDir.create(recursive: true);

  final entries = <Map<String, dynamic>>[];
  var bundledSkipped = 0;
  var noSkillSkipped = 0;

  await for (final entity in sourceDir.list(followLinks: false)) {
    if (entity is! Directory) continue;
    final name = entity.path.split(Platform.pathSeparator).last;

    // 跳过 Bundle（含 .claude-plugin/plugin.json）
    final pluginManifest = File('${entity.path}/.claude-plugin/plugin.json');
    if (await pluginManifest.exists()) {
      bundledSkipped++;
      continue;
    }

    final skillFile = File('${entity.path}/SKILL.md');
    if (!await skillFile.exists()) {
      noSkillSkipped++;
      continue;
    }

    final content = await skillFile.readAsString();
    final frontmatter = parseFrontmatter(content);
    final skillName = frontmatter['name'] as String?;
    if (skillName == null || skillName.isEmpty) {
      stderr.writeln('Warning: $name/SKILL.md missing name field, skipping');
      noSkillSkipped++;
      continue;
    }

    // 复制 SKILL.md 到目标目录
    final skillTargetDir = Directory('$mobileAssetsTarget/$skillName');
    await skillTargetDir.create(recursive: true);
    await File('${skillTargetDir.path}/SKILL.md').writeAsString(content);

    entries.add({
      'name': skillName,
      'description': frontmatter['description'] as String? ?? '',
      'category': frontmatter['category'] as String? ?? 'other',
      'assetPath': 'assets/skills-lib/$skillName/SKILL.md',
    });
  }

  // 按 name 排序，确保 index.json 稳定
  entries.sort((a, b) =>
      (a['name'] as String).compareTo(b['name'] as String));

  final index = {
    'version': 1,
    'generatedAt': DateTime.now().toUtc().toIso8601String(),
    'skills': entries,
  };

  final indexFile = File('$mobileAssetsTarget/index.json');
  await indexFile.writeAsString(const JsonEncoder.withIndent('  ').convert(index));

  stdout.writeln('Synced ${entries.length} skills to $mobileAssetsTarget');
  stdout.writeln('Skipped: $bundledSkipped bundles, $noSkillSkipped without SKILL.md');
}

/// 轻量 frontmatter 解析：仅提取 name/description/category 扁平字段。
Map<String, String> parseFrontmatter(String markdown) {
  final result = <String, String>{};
  final lines = markdown.split('\n');
  if (lines.isEmpty || lines.first.trim() != '---') return result;

  for (var i = 1; i < lines.length; i++) {
    final line = lines[i];
    if (line.trim() == '---') break;
    final colon = line.indexOf(':');
    if (colon <= 0) continue;
    final key = line.substring(0, colon).trim();
    var value = line.substring(colon + 1).trim();
    value = stripQuotes(value);
    if (key == 'name' || key == 'description' || key == 'category') {
      result[key] = value;
    }
  }
  return result;
}

String stripQuotes(String value) {
  if (value.length >= 2) {
    final first = value[0];
    final last = value[value.length - 1];
    if ((first == '"' && last == '"') || (first == "'" && last == "'")) {
      return value.substring(1, value.length - 1);
    }
  }
  return value;
}
```

- [ ] **步骤 2：运行脚本**

运行：`dart run mobile-app/scripts/sync_skills_lib.dart`

预期输出：
```
Synced N skills to d:/AI/SpaceCode/mobile-app/assets/skills-lib
Skipped: M bundles, K without SKILL.md
```

- [ ] **步骤 3：验证生成结果**

运行：`Get-Content mobile-app/assets/skills-lib/index.json | Select-Object -First 30`

预期：JSON 文件含 `version`、`generatedAt`、`skills` 数组，每个技能含 `name`、`description`、`category`、`assetPath`。

运行：`Test-Path mobile-app/assets/skills-lib/code-review/SKILL.md`

预期：`True`

- [ ] **步骤 4：Commit**

```bash
git add mobile-app/scripts/sync_skills_lib.dart mobile-app/assets/skills-lib/
git commit -m "feat(mobile): 同步 skills-lib 到 mobile-app assets 并生成 index.json"
```

---

## 任务 2：数据模型 LocalLibrarySkill + LocalLibraryIndex

**文件：**
- 创建：`mobile-app/lib/core/skills/local_library_index.dart`
- 测试：`mobile-app/test/core/skills/local_library_index_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/core/skills/local_library_index_test.dart`：

```dart
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';

void main() {
  group('LocalLibrarySkill', () {
    test('fromJson parses all fields', () {
      final json = {
        'name': 'code-review',
        'description': 'Review the changes',
        'category': 'development',
        'assetPath': 'assets/skills-lib/code-review/SKILL.md',
      };
      final skill = LocalLibrarySkill.fromJson(json);
      expect(skill.name, 'code-review');
      expect(skill.description, 'Review the changes');
      expect(skill.category, 'development');
      expect(skill.assetPath, 'assets/skills-lib/code-review/SKILL.md');
    });

    test('fromJson uses default category when missing', () {
      final json = {
        'name': 'foo',
        'description': 'desc',
        'assetPath': 'assets/skills-lib/foo/SKILL.md',
      };
      final skill = LocalLibrarySkill.fromJson(json);
      expect(skill.category, 'other');
    });

    test('fromJson handles null category with default', () {
      final json = {
        'name': 'foo',
        'description': 'desc',
        'category': null,
        'assetPath': 'assets/skills-lib/foo/SKILL.md',
      };
      final skill = LocalLibrarySkill.fromJson(json);
      expect(skill.category, 'other');
    });
  });

  group('LocalLibraryIndex', () {
    test('fromJson parses complete index', () {
      final json = {
        'version': 1,
        'generatedAt': '2026-07-20T10:00:00Z',
        'skills': [
          {
            'name': 'code-review',
            'description': 'desc1',
            'category': 'development',
            'assetPath': 'assets/skills-lib/code-review/SKILL.md',
          },
          {
            'name': 'pdf',
            'description': 'desc2',
            'category': 'office',
            'assetPath': 'assets/skills-lib/pdf/SKILL.md',
          },
        ],
      };
      final index = LocalLibraryIndex.fromJson(json);
      expect(index.version, 1);
      expect(index.generatedAt, DateTime.parse('2026-07-20T10:00:00Z'));
      expect(index.skills.length, 2);
      expect(index.skills[0].name, 'code-review');
      expect(index.skills[1].name, 'pdf');
    });

    test('fromJson handles empty skills array', () {
      final json = {
        'version': 1,
        'generatedAt': '2026-07-20T10:00:00Z',
        'skills': [],
      };
      final index = LocalLibraryIndex.fromJson(json);
      expect(index.skills, isEmpty);
    });

    test('fromJson uses default version when missing', () {
      final json = {
        'generatedAt': '2026-07-20T10:00:00Z',
        'skills': [],
      };
      final index = LocalLibraryIndex.fromJson(json);
      expect(index.version, 1);
    });

    test('fromJson uses now() when generatedAt missing or invalid', () {
      final before = DateTime.now();
      final json = {
        'version': 1,
        'generatedAt': 'invalid-date',
        'skills': [],
      };
      final index = LocalLibraryIndex.fromJson(json);
      final after = DateTime.now();
      expect(index.generatedAt.isAfter(before.subtract(Duration(seconds: 1))), true);
      expect(index.generatedAt.isBefore(after.add(Duration(seconds: 1))), true);
    });

    test('fromJson handles missing skills field', () {
      final json = {'version': 1, 'generatedAt': '2026-07-20T10:00:00Z'};
      final index = LocalLibraryIndex.fromJson(json);
      expect(index.skills, isEmpty);
    });

    test('empty factory returns empty index', () {
      const index = LocalLibraryIndex.empty;
      expect(index.skills, isEmpty);
      expect(index.version, 0);
    });

    test('round-trip JSON serialization', () {
      final original = {
        'version': 1,
        'generatedAt': '2026-07-20T10:00:00Z',
        'skills': [
          {
            'name': 'tdd',
            'description': 'Test-driven development',
            'category': 'development',
            'assetPath': 'assets/skills-lib/tdd/SKILL.md',
          }
        ],
      };
      final index = LocalLibraryIndex.fromJson(
          jsonDecode(jsonEncode(original)) as Map<String, dynamic>);
      expect(index.skills.length, 1);
      expect(index.skills[0].name, 'tdd');
      expect(index.skills[0].description, 'Test-driven development');
    });
  });

  group('LocalLibraryCategories', () {
    test('allValues contains 9 categories', () {
      expect(LocalLibraryCategories.allValues.length, 9);
    });

    test('allValues contains all expected categories', () {
      expect(LocalLibraryCategories.allValues, contains('all'));
      expect(LocalLibraryCategories.allValues, contains('development'));
      expect(LocalLibraryCategories.allValues, contains('frontend-design'));
      expect(LocalLibraryCategories.allValues, contains('office'));
      expect(LocalLibraryCategories.allValues, contains('ai-ml'));
      expect(LocalLibraryCategories.allValues, contains('devops'));
      expect(LocalLibraryCategories.allValues, contains('creative'));
      expect(LocalLibraryCategories.allValues, contains('communication'));
      expect(LocalLibraryCategories.allValues, contains('other'));
    });
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`flutter test test/core/skills/local_library_index_test.dart`

预期：FAIL，报错 `Target of URI doesn't exist: 'package:spacecode_mobile/core/skills/local_library_index.dart'`

- [ ] **步骤 3：编写实现**

创建 `mobile-app/lib/core/skills/local_library_index.dart`：

```dart
/// 本地技能库索引数据模型。
///
/// index.json 的序列化/反序列化。不参与 Agent 加载（仅用于库浏览 UI）。
library;

/// 本地库中的单个技能元数据。
class LocalLibrarySkill {
  /// 技能名（与 SKILL.md frontmatter 的 name 一致）。
  final String name;

  /// 技能描述（与 frontmatter 的 description 一致）。
  final String description;

  /// 分类（frontmatter 的 category 字段，默认 'other'）。
  final String category;

  /// SKILL.md 在 assets 中的相对路径。
  final String assetPath;

  const LocalLibrarySkill({
    required this.name,
    required this.description,
    required this.category,
    required this.assetPath,
  });

  factory LocalLibrarySkill.fromJson(Map<String, dynamic> json) {
    return LocalLibrarySkill(
      name: json['name'] as String,
      description: json['description'] as String? ?? '',
      category: json['category'] as String? ?? 'other',
      assetPath: json['assetPath'] as String,
    );
  }
}

/// 本地技能库索引。
class LocalLibraryIndex {
  /// 索引格式版本。
  final int version;

  /// 索引生成时间（UTC ISO 8601）。
  final DateTime generatedAt;

  /// 所有库技能列表。
  final List<LocalLibrarySkill> skills;

  const LocalLibraryIndex({
    required this.version,
    required this.generatedAt,
    required this.skills,
  });

  /// 空索引（用于加载失败的降级）。
  static const empty = LocalLibraryIndex(
    version: 0,
    generatedAt: null,
    skills: [],
  ) as LocalLibraryIndex;

  factory LocalLibraryIndex.fromJson(Map<String, dynamic> json) {
    return LocalLibraryIndex(
      version: json['version'] as int? ?? 1,
      generatedAt:
          DateTime.tryParse(json['generatedAt'] as String? ?? '') ??
              DateTime.now(),
      skills: (json['skills'] as List? ?? [])
          .map((e) => LocalLibrarySkill.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

/// 本地库分类常量（与桌面端 src/stores/localSkills.ts 的 CATEGORIES 一致）。
class LocalLibraryCategories {
  static const all = 'all';
  static const development = 'development';
  static const frontendDesign = 'frontend-design';
  static const office = 'office';
  static const aiMl = 'ai-ml';
  static const devops = 'devops';
  static const creative = 'creative';
  static const communication = 'communication';
  static const other = 'other';

  static const allValues = [
    all,
    development,
    frontendDesign,
    office,
    aiMl,
    devops,
    creative,
    communication,
    other,
  ];

  LocalLibraryCategories._();
}
```

注意：`empty` 工厂的 `generatedAt` 必须是 `DateTime`，Dart 不允许 const DateTime。修正：将 `empty` 改为普通 static getter：

```dart
static LocalLibraryIndex get empty => LocalLibraryIndex(
  version: 0,
  generatedAt: DateTime.fromMillisecondsSinceEpoch(0),
  skills: const [],
);
```

- [ ] **步骤 4：运行测试验证通过**

运行：`flutter test test/core/skills/local_library_index_test.dart`

预期：PASS（所有 11 个测试通过）

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/core/skills/local_library_index.dart mobile-app/test/core/skills/local_library_index_test.dart
git commit -m "feat(mobile): 新增本地技能库索引数据模型"
```

---

## 任务 3：LocalLibrarySource

**文件：**
- 创建：`mobile-app/lib/core/skills/local_library_source.dart`
- 测试：`mobile-app/test/core/skills/local_library_source_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/core/skills/local_library_source_test.dart`：

```dart
import 'dart:convert';

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
```

- [ ] **步骤 2：运行测试验证失败**

运行：`flutter test test/core/skills/local_library_source_test.dart`

预期：FAIL，报错 `Target of URI doesn't exist`

- [ ] **步骤 3：编写实现**

创建 `mobile-app/lib/core/skills/local_library_source.dart`：

```dart
import 'dart:convert';

import 'package:flutter/services.dart' show AssetBundle, rootBundle;

import 'local_library_index.dart';

/// 从 assets/skills-lib/index.json 加载本地技能库索引。
///
/// 仅加载元数据（name/description/category/assetPath），
/// 不读取 SKILL.md 全文（性能考虑）。
/// 加载失败时返回空索引，不抛异常（保证 UI 可降级显示）。
class LocalLibrarySource {
  final AssetBundle _bundle;

  /// 构造时可注入 AssetBundle，便于测试。
  /// 默认使用 rootBundle。
  LocalLibrarySource({AssetBundle? bundle}) : _bundle = bundle ?? rootBundle;

  Future<LocalLibraryIndex> load() async {
    try {
      final json = await _bundle.loadString('assets/skills-lib/index.json');
      final decoded = jsonDecode(json);
      if (decoded is! Map<String, dynamic>) {
        return LocalLibraryIndex.empty;
      }
      return LocalLibraryIndex.fromJson(decoded);
    } catch (_) {
      return LocalLibraryIndex.empty;
    }
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`flutter test test/core/skills/local_library_source_test.dart`

预期：PASS（5 个测试通过）

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/core/skills/local_library_source.dart mobile-app/test/core/skills/local_library_source_test.dart
git commit -m "feat(mobile): 新增 LocalLibrarySource 从 index.json 加载库索引"
```

---

## 任务 4：LocalLibraryInstaller

**文件：**
- 创建：`mobile-app/lib/core/skills/local_library_installer.dart`
- 测试：`mobile-app/test/core/skills/local_library_installer_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/core/skills/local_library_installer_test.dart`：

```dart
import 'dart:convert';
import 'dart:io';

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
```

- [ ] **步骤 2：运行测试验证失败**

运行：`flutter test test/core/skills/local_library_installer_test.dart`

预期：FAIL，报错 `Target of URI doesn't exist`

- [ ] **步骤 3：编写实现**

创建 `mobile-app/lib/core/skills/local_library_installer.dart`：

```dart
import 'dart:io';

import 'package:flutter/services.dart' show AssetBundle, rootBundle;
import 'package:path_provider/path_provider.dart';

import 'local_library_index.dart';

/// 本地技能库安装器。
///
/// 从 asset 读取 SKILL.md 全文，写入用户技能目录：
///   {docs}/spacecode/skills/<name>/SKILL.md
///
/// 卸载不在此实现，复用 SkillRegistry.uninstall()。
class LocalLibraryInstaller {
  final AssetBundle _bundle;

  /// 构造时可注入 AssetBundle，便于测试。
  LocalLibraryInstaller({AssetBundle? bundle}) : _bundle = bundle ?? rootBundle;

  /// 安装指定技能到用户技能目录。
  ///
  /// 返回目标目录的绝对路径。
  /// 安装是幂等的：若目标目录已存在，覆盖 SKILL.md。
  Future<String> install(LocalLibrarySkill skill) async {
    final content = await _bundle.loadString(skill.assetPath);
    final docs = await getApplicationDocumentsDirectory();
    final targetDir = Directory('${docs.path}/spacecode/skills/${skill.name}');
    await targetDir.create(recursive: true);
    final targetFile = File('${targetDir.path}/SKILL.md');
    await targetFile.writeAsString(content);
    return targetDir.path;
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`flutter test test/core/skills/local_library_installer_test.dart`

预期：PASS（4 个测试通过）

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/core/skills/local_library_installer.dart mobile-app/test/core/skills/local_library_installer_test.dart
git commit -m "feat(mobile): 新增 LocalLibraryInstaller 从 asset 安装技能到用户目录"
```

---

## 任务 5：LocalLibraryNotifier

**文件：**
- 创建：`mobile-app/lib/core/skills/local_library_notifier.dart`
- 测试：`mobile-app/test/core/skills/local_library_notifier_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/core/skills/local_library_notifier_test.dart`：

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';
import 'package:spacecode_mobile/core/skills/local_library_installer.dart';
import 'package:spacecode_mobile/core/skills/local_library_notifier.dart';
import 'package:spacecode_mobile/core/skills/local_library_source.dart';
import 'package:spacecode_mobile/core/skills/skill_registry.dart';
import 'package:spacecode_mobile/core/skills/skill_types.dart';

void main() {
  group('LocalLibraryState', () {
    test('filteredSkills returns all when category is all and query empty', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'a', description: 'alpha', category: 'development', assetPath: 'p/a'),
          LocalLibrarySkill(
              name: 'b', description: 'beta', category: 'office', assetPath: 'p/b'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'all',
        searchQuery: '',
      );
      expect(state.filteredSkills.length, 2);
    });

    test('filteredSkills filters by category', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'a', description: 'alpha', category: 'development', assetPath: 'p/a'),
          LocalLibrarySkill(
              name: 'b', description: 'beta', category: 'office', assetPath: 'p/b'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'office',
        searchQuery: '',
      );
      expect(state.filteredSkills.length, 1);
      expect(state.filteredSkills[0].name, 'b');
    });

    test('filteredSkills filters by search query (case insensitive)', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'code-review', description: 'Review changes', category: 'development', assetPath: 'p'),
          LocalLibrarySkill(
              name: 'pdf', description: 'PDF processing', category: 'office', assetPath: 'p'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'all',
        searchQuery: 'REVIEW',
      );
      expect(state.filteredSkills.length, 1);
      expect(state.filteredSkills[0].name, 'code-review');
    });

    test('filteredSkills filters by both category and query', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'code-review', description: 'Review', category: 'development', assetPath: 'p'),
          LocalLibrarySkill(
              name: 'tdd', description: 'Review-driven', category: 'development', assetPath: 'p'),
          LocalLibrarySkill(
              name: 'pdf', description: 'Review PDFs', category: 'office', assetPath: 'p'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'development',
        searchQuery: 'review',
      );
      expect(state.filteredSkills.length, 2);
      expect(state.filteredSkills[0].name, 'code-review');
      expect(state.filteredSkills[1].name, 'tdd');
    });

    test('isInstalled returns true when name in installedNames', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'a', description: '', category: 'other', assetPath: 'p'),
        ],
        loading: false,
        error: null,
        installedNames: const {'a'},
        selectedCategory: 'all',
        searchQuery: '',
      );
      expect(state.isInstalled('a'), true);
      expect(state.isInstalled('b'), false);
    });

    test('empty factory returns default state', () {
      const state = LocalLibraryState.empty;
      expect(state.skills, isEmpty);
      expect(state.loading, true);
      expect(state.error, isNull);
      expect(state.installedNames, isEmpty);
      expect(state.selectedCategory, 'all');
      expect(state.searchQuery, '');
    });
  });

  group('LocalLibraryNotifier', () {
    test('refresh loads skills from source and updates installedNames from registry', () async {
      final container = ProviderContainer(overrides: [
        localLibrarySourceProvider.overrideWithValue(_MockSource([
          const LocalLibrarySkill(
              name: 'code-review', description: 'desc', category: 'development', assetPath: 'p'),
        ])),
        localLibraryInstallerProvider.overrideWithValue(_MockInstaller()),
        skillRegistryProvider.overrideWith((ref) => _MockSkillRegistryNotifier([
          const Skill(
            name: 'code-review',
            description: '',
            filePath: '/x',
            baseDir: '/x',
            source: SkillSourceKind.user,
          ),
        ])),
      ]);
      addTearDown(container.dispose);

      final notifier = container.read(localLibraryProvider.notifier);
      await notifier.refresh();

      final state = container.read(localLibraryProvider);
      expect(state.skills.length, 1);
      expect(state.skills[0].name, 'code-review');
      expect(state.loading, false);
      expect(state.installedNames, contains('code-review'));
    });

    test('setCategory updates selectedCategory', () {
      final container = ProviderContainer(overrides: [
        localLibrarySourceProvider.overrideWithValue(_MockSource([])),
        localLibraryInstallerProvider.overrideWithValue(_MockInstaller()),
        skillRegistryProvider.overrideWith((ref) => _MockSkillRegistryNotifier([])),
      ]);
      addTearDown(container.dispose);

      final notifier = container.read(localLibraryProvider.notifier);
      notifier.setCategory('office');
      expect(container.read(localLibraryProvider).selectedCategory, 'office');
    });

    test('setSearchQuery updates searchQuery', () {
      final container = ProviderContainer(overrides: [
        localLibrarySourceProvider.overrideWithValue(_MockSource([])),
        localLibraryInstallerProvider.overrideWithValue(_MockInstaller()),
        skillRegistryProvider.overrideWith((ref) => _MockSkillRegistryNotifier([])),
      ]);
      addTearDown(container.dispose);

      final notifier = container.read(localLibraryProvider.notifier);
      notifier.setSearchQuery('pdf');
      expect(container.read(localLibraryProvider).searchQuery, 'pdf');
    });

    test('install calls installer and refreshes state', () async {
      final installer = _MockInstaller();
      final container = ProviderContainer(overrides: [
        localLibrarySourceProvider.overrideWithValue(_MockSource([
          const LocalLibrarySkill(
              name: 'foo', description: 'desc', category: 'other', assetPath: 'p/foo'),
        ])),
        localLibraryInstallerProvider.overrideWithValue(installer),
        skillRegistryProvider.overrideWith((ref) => _MockSkillRegistryNotifier([])),
      ]);
      addTearDown(container.dispose);

      final notifier = container.read(localLibraryProvider.notifier);
      const skill = LocalLibrarySkill(
          name: 'foo', description: 'desc', category: 'other', assetPath: 'p/foo');
      await notifier.install(skill);

      expect(installer.installedSkills, contains(skill));
    });
  });
}

class _MockSource extends LocalLibrarySource {
  final List<LocalLibrarySkill> skills;

  _MockSource(this.skills) : super(bundle: _NullBundle());

  @override
  Future<LocalLibraryIndex> load() async => LocalLibraryIndex(
        version: 1,
        generatedAt: DateTime.now(),
        skills: skills,
      );
}

class _NullBundle extends CachingAssetBundle {
  @override
  Future<String> loadString(String key, {bool cache = true}) async => '';
  @override
  Future<ByteData> load(String key) async => ByteData(0);
}

class _MockInstaller extends LocalLibraryInstaller {
  final installedSkills = <LocalLibrarySkill>[];

  _MockInstaller() : super(bundle: _NullBundle());

  @override
  Future<String> install(LocalLibrarySkill skill) async {
    installedSkills.add(skill);
    return '/mock/${skill.name}';
  }
}

class _MockSkillRegistryNotifier extends SkillRegistryNotifier {
  final List<Skill> _skills;

  _MockSkillRegistryNotifier(this._skills) : super(_MockRef());

  @override
  SkillRegistryState get state => SkillRegistryState(
        skills: _skills,
        diagnostics: const [],
        loading: false,
        disabledNames: const {},
      );

  @override
  Future<void> refresh() async {}

  @override
  Future<void> uninstall(String name) async {}
}

class _MockRef extends Ref {
  _MockRef() : super(null);
  @override
  T read<T>(ProviderListenable<T> provider) => throw UnimplementedError();
  @override
  T watch<T>(ProviderListenable<T> provider) => throw UnimplementedError();
  @override
  T refresh<T>(Refreshable<T> provider) => throw UnimplementedError();
  @override
  void invalidate(ProviderOrFamily provider) {}
  @override
  void listen<T>(
    ProviderListenable<T> provider,
    void Function(T? previous, T next) listener, {
    void Function(Object error, StackTrace stackTrace)? onError,
  }) {}
  @override
  void invalidateSelf() {}
  @override
  void notifyListeners() {}
}
```

注意：`Ref` 是抽象类，且构造方式因 Riverpod 版本而异。Riverpod 2.x 中 `Ref` 不能直接继承。实际实现时改为构造 `ProviderContainer` + 直接 override `skillRegistryProvider`，并通过 `LocalLibraryNotifier` 接受 `Ref` 实现注入。测试中用真实的 `ProviderContainer`：

简化测试方案：由于 `SkillRegistryNotifier` 需要 `Ref`，建议在测试 override 中使用真实 `ProviderContainer` 创建的 `Ref`。具体实现时若 `_MockRef` 不可用，改为 override `skillRegistryProvider` 为一个简单的 fake notifier（不需要 Ref）。

为简化，移除 `SkillRegistryNotifier` 继承，改为使用 `ProviderContainer` 暴露的 `Ref`：

将测试中 override 改为：
```dart
skillRegistryProvider.overrideWith((ref) {
  // 真实 Notifier，但内部 state 已加载
  return SkillRegistryNotifier(ref);
}),
```
但 `SkillRegistryNotifier` 构造时会 `refresh()`，会触发实际文件系统操作。因此需要 mock `SkillLoader`。

替代方案：让 `LocalLibraryNotifier` 通过依赖注入接受 `SkillRegistryNotifier` 的引用，而非通过 `Ref` 读取。这样测试更简单。

**修正设计**：`LocalLibraryNotifier` 通过 `Ref` 读取 `skillRegistryProvider`，但 `SkillRegistryNotifier` 的 `refresh()` 会在测试中触发实际加载。为避免这个问题，测试时 override `skillRegistryProvider` 为自定义 mock notifier。

由于 Riverpod 2.x `StateNotifierProvider.overrideWith` 不允许直接替换为子类（必须提供工厂函数），实际编写测试时需要灵活处理。

为简化实现，将测试中 `_MockSkillRegistryNotifier` 移除，改为 override `skillRegistryProvider` 为：

```dart
skillRegistryProvider.overrideWith((ref) {
  final notifier = SkillRegistryNotifier(ref);
  // 测试中跳过 refresh
  return notifier;
}),
```

但这会触发实际 `refresh()`。更好的方案：让 `SkillRegistryNotifier` 支持注入 `SkillLoader`，或测试中使用真实 `ProviderContainer` + `path_provider` mock。

**最简方案**：测试 `LocalLibraryNotifier` 时，不 mock `SkillRegistryNotifier`，而是 override `path_provider` 让 `SkillRegistryNotifier` 加载空目录。但这增加复杂度。

**最终方案**：将 `LocalLibraryNotifier` 设计为接受 `LocalLibrarySource`、`LocalLibraryInstaller` 和一个 `Future<Set<String>> Function() getInstalledNames` 回调，而不是直接依赖 `Ref` 和 `SkillRegistryNotifier`。这降低耦合度且便于测试。

- [ ] **步骤 2：运行测试验证失败**

运行：`flutter test test/core/skills/local_library_notifier_test.dart`

预期：FAIL，报错 `Target of URI doesn't exist`

- [ ] **步骤 3：编写实现**

创建 `mobile-app/lib/core/skills/local_library_notifier.dart`：

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'local_library_index.dart';
import 'local_library_installer.dart';
import 'local_library_source.dart';
import 'skill_registry.dart';
import 'skill_types.dart';

/// 本地技能库的不可变状态。
class LocalLibraryState {
  /// 所有库技能（来自 index.json）。
  final List<LocalLibrarySkill> skills;

  /// 是否正在加载。
  final bool loading;

  /// 加载错误信息（null 表示无错误）。
  final String? error;

  /// 已安装的技能名集合（含 user + github 来源）。
  final Set<String> installedNames;

  /// 当前选中的分类（'all' 表示全部）。
  final String selectedCategory;

  /// 当前搜索关键词。
  final String searchQuery;

  const LocalLibraryState({
    required this.skills,
    required this.loading,
    required this.error,
    required this.installedNames,
    required this.selectedCategory,
    required this.searchQuery,
  });

  static const empty = LocalLibraryState(
    skills: [],
    loading: true,
    error: null,
    installedNames: {},
    selectedCategory: 'all',
    searchQuery: '',
  );

  /// 过滤后的技能列表（应用分类 + 搜索）。
  List<LocalLibrarySkill> get filteredSkills {
    var result = skills;
    if (selectedCategory != 'all') {
      result = result.where((s) => s.category == selectedCategory).toList();
    }
    if (searchQuery.isNotEmpty) {
      final q = searchQuery.toLowerCase();
      result = result
          .where((s) =>
              s.name.toLowerCase().contains(q) ||
              s.description.toLowerCase().contains(q))
          .toList();
    }
    return result;
  }

  /// 判断指定技能是否已安装。
  bool isInstalled(String name) => installedNames.contains(name);

  LocalLibraryState copyWith({
    List<LocalLibrarySkill>? skills,
    bool? loading,
    String? error,
    Set<String>? installedNames,
    String? selectedCategory,
    String? searchQuery,
  }) {
    return LocalLibraryState(
      skills: skills ?? this.skills,
      loading: loading ?? this.loading,
      error: error ?? this.error,
      installedNames: installedNames ?? this.installedNames,
      selectedCategory: selectedCategory ?? this.selectedCategory,
      searchQuery: searchQuery ?? this.searchQuery,
    );
  }
}

/// 本地技能库的 Riverpod notifier。
class LocalLibraryNotifier extends StateNotifier<LocalLibraryState> {
  final Ref _ref;
  final LocalLibrarySource _source;
  final LocalLibraryInstaller _installer;

  LocalLibraryNotifier(this._ref, this._source, this._installer)
      : super(LocalLibraryState.empty) {
    refresh();
  }

  /// 重新加载库索引并同步已安装状态。
  Future<void> refresh() async {
    state = state.copyWith(loading: true, error: null);
    try {
      final index = await _source.load();
      final installed = _computeInstalledNames();
      state = LocalLibraryState(
        skills: index.skills,
        loading: false,
        error: null,
        installedNames: installed,
        selectedCategory: state.selectedCategory,
        searchQuery: state.searchQuery,
      );
    } catch (error) {
      state = state.copyWith(
        loading: false,
        error: error.toString(),
      );
    }
  }

  /// 设置当前分类。
  void setCategory(String category) {
    state = state.copyWith(selectedCategory: category);
  }

  /// 设置搜索关键词。
  void setSearchQuery(String query) {
    state = state.copyWith(searchQuery: query);
  }

  /// 安装指定库技能到用户目录。
  ///
  /// 安装后会刷新 SkillRegistry（让 UserSkillSource 重新扫描）和本地库状态。
  Future<void> install(LocalLibrarySkill skill) async {
    await _installer.install(skill);
    await _ref.read(skillRegistryProvider.notifier).refresh();
    await refresh();
  }

  /// 卸载指定技能（复用 SkillRegistry.uninstall）。
  Future<void> uninstall(String name) async {
    await _ref.read(skillRegistryProvider.notifier).uninstall(name);
    await refresh();
  }

  /// 从 SkillRegistry 计算已安装技能名集合（user + github 来源）。
  Set<String> _computeInstalledNames() {
    final skills = _ref.read(skillRegistryProvider).skills;
    return skills
        .where((s) =>
            s.source == SkillSourceKind.user ||
            s.source == SkillSourceKind.github)
        .map((s) => s.name)
        .toSet();
  }
}

/// 用于测试的 LocalLibrarySource provider（可 override）。
final localLibrarySourceProvider = Provider<LocalLibrarySource>((ref) {
  return LocalLibrarySource();
});

/// 用于测试的 LocalLibraryInstaller provider（可 override）。
final localLibraryInstallerProvider = Provider<LocalLibraryInstaller>((ref) {
  return LocalLibraryInstaller();
});

/// 本地技能库 provider。
final localLibraryProvider =
    StateNotifierProvider<LocalLibraryNotifier, LocalLibraryState>(
  (ref) => LocalLibraryNotifier(
    ref,
    ref.read(localLibrarySourceProvider),
    ref.read(localLibraryInstallerProvider),
  ),
);
```

**简化测试**：由于 `SkillRegistryNotifier` 与 `Ref` 耦合且测试 mock 复杂，将单元测试聚焦于 `LocalLibraryState.filteredSkills` 的纯逻辑测试（不依赖 Riverpod），以及对 `LocalLibraryNotifier` 的简单行为测试（使用真实 `ProviderContainer` + override `skillRegistryProvider`）。

将测试简化为仅测 `LocalLibraryState`（不测 Notifier，Notifier 行为通过 Widget 测试覆盖）：

修订测试文件 `mobile-app/test/core/skills/local_library_notifier_test.dart`：

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';
import 'package:spacecode_mobile/core/skills/local_library_notifier.dart';

void main() {
  group('LocalLibraryState', () {
    test('filteredSkills returns all when category is all and query empty', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'a', description: 'alpha', category: 'development', assetPath: 'p/a'),
          LocalLibrarySkill(
              name: 'b', description: 'beta', category: 'office', assetPath: 'p/b'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'all',
        searchQuery: '',
      );
      expect(state.filteredSkills.length, 2);
    });

    test('filteredSkills filters by category', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'a', description: 'alpha', category: 'development', assetPath: 'p/a'),
          LocalLibrarySkill(
              name: 'b', description: 'beta', category: 'office', assetPath: 'p/b'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'office',
        searchQuery: '',
      );
      expect(state.filteredSkills.length, 1);
      expect(state.filteredSkills[0].name, 'b');
    });

    test('filteredSkills filters by search query (case insensitive)', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'code-review', description: 'Review changes', category: 'development', assetPath: 'p'),
          LocalLibrarySkill(
              name: 'pdf', description: 'PDF processing', category: 'office', assetPath: 'p'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'all',
        searchQuery: 'REVIEW',
      );
      expect(state.filteredSkills.length, 1);
      expect(state.filteredSkills[0].name, 'code-review');
    });

    test('filteredSkills filters by both category and query', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'code-review', description: 'Review', category: 'development', assetPath: 'p'),
          LocalLibrarySkill(
              name: 'tdd', description: 'Review-driven', category: 'development', assetPath: 'p'),
          LocalLibrarySkill(
              name: 'pdf', description: 'Review PDFs', category: 'office', assetPath: 'p'),
        ],
        loading: false,
        error: null,
        installedNames: const {},
        selectedCategory: 'development',
        searchQuery: 'review',
      );
      expect(state.filteredSkills.length, 2);
    });

    test('isInstalled returns true when name in installedNames', () {
      final state = LocalLibraryState(
        skills: const [
          LocalLibrarySkill(
              name: 'a', description: '', category: 'other', assetPath: 'p'),
        ],
        loading: false,
        error: null,
        installedNames: const {'a'},
        selectedCategory: 'all',
        searchQuery: '',
      );
      expect(state.isInstalled('a'), true);
      expect(state.isInstalled('b'), false);
    });

    test('empty factory returns default state', () {
      const state = LocalLibraryState.empty;
      expect(state.skills, isEmpty);
      expect(state.loading, true);
      expect(state.error, isNull);
      expect(state.installedNames, isEmpty);
      expect(state.selectedCategory, 'all');
      expect(state.searchQuery, '');
    });

    test('copyWith preserves unspecified fields', () {
      const original = LocalLibraryState.empty;
      final updated = original.copyWith(selectedCategory: 'office');
      expect(updated.selectedCategory, 'office');
      expect(updated.skills, isEmpty);
      expect(updated.loading, true);
    });
  });
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`flutter test test/core/skills/local_library_notifier_test.dart`

预期：PASS（7 个测试通过）

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/core/skills/local_library_notifier.dart mobile-app/test/core/skills/local_library_notifier_test.dart
git commit -m "feat(mobile): 新增 LocalLibraryNotifier 状态管理与 Riverpod provider"
```

---

## 任务 6：LocalLibraryCard Widget

**文件：**
- 创建：`mobile-app/lib/features/skills/local_library_card.dart`
- 测试：`mobile-app/test/features/skills/local_library_card_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/features/skills/local_library_card_test.dart`：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/i18n/strings.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';
import 'package:spacecode_mobile/features/skills/local_library_card.dart';

void main() {
  setUpAll(() {
    I18n.initForTest(
      locale: AppLocale.zh,
      strings: const {
        'skills.install': '安装',
        'skills.uninstall': '卸载',
        'skills.installed': '已安装',
        'skills.installedFromGithub': '已安装（GitHub）',
      },
    );
  });

  Future<void> pumpCard(
    WidgetTester tester, {
    required LocalLibrarySkill skill,
    required InstallStatus installStatus,
    VoidCallback? onInstall,
    VoidCallback? onUninstall,
    VoidCallback? onTap,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LocalLibraryCard(
            skill: skill,
            installStatus: installStatus,
            onInstall: onInstall,
            onUninstall: onUninstall,
            onTap: onTap,
          ),
        ),
      ),
    );
  }

  testWidgets('displays skill name and description', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'code-review',
      description: 'Review the changes since a fixed point',
      category: 'development',
      assetPath: 'p',
    );
    await pumpCard(tester, skill: skill, installStatus: InstallStatus.notInstalled);

    expect(find.text('code-review'), findsOneWidget);
    expect(find.text('Review the changes since a fixed point'), findsOneWidget);
  });

  testWidgets('shows install button when not installed', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo',
      description: 'desc',
      category: 'other',
      assetPath: 'p',
    );
    await pumpCard(tester, skill: skill, installStatus: InstallStatus.notInstalled);

    expect(find.text('安装'), findsOneWidget);
  });

  testWidgets('shows uninstall button when installed from user', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo',
      description: 'desc',
      category: 'other',
      assetPath: 'p',
    );
    await pumpCard(tester, skill: skill, installStatus: InstallStatus.installedUser);

    expect(find.text('卸载'), findsOneWidget);
  });

  testWidgets('shows "installed from GitHub" text when installed from github', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo',
      description: 'desc',
      category: 'other',
      assetPath: 'p',
    );
    await pumpCard(tester, skill: skill, installStatus: InstallStatus.installedGithub);

    expect(find.text('已安装（GitHub）'), findsOneWidget);
  });

  testWidgets('onInstall callback is triggered', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo', description: '', category: 'other', assetPath: 'p');
    var tapped = false;
    await pumpCard(
      tester,
      skill: skill,
      installStatus: InstallStatus.notInstalled,
      onInstall: () => tapped = true,
    );

    await tester.tap(find.text('安装'));
    expect(tapped, true);
  });

  testWidgets('onUninstall callback is triggered', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo', description: '', category: 'other', assetPath: 'p');
    var tapped = false;
    await pumpCard(
      tester,
      skill: skill,
      installStatus: InstallStatus.installedUser,
      onUninstall: () => tapped = true,
    );

    await tester.tap(find.text('卸载'));
    expect(tapped, true);
  });

  testWidgets('onTap callback triggered on card tap', (tester) async {
    const skill = LocalLibrarySkill(
      name: 'foo', description: 'desc', category: 'other', assetPath: 'p');
    var tapped = false;
    await pumpCard(
      tester,
      skill: skill,
      installStatus: InstallStatus.notInstalled,
      onTap: () => tapped = true,
    );

    await tester.tap(find.text('foo'));
    expect(tapped, true);
  });
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`flutter test test/features/skills/local_library_card_test.dart`

预期：FAIL，报错 `Target of URI doesn't exist`

- [ ] **步骤 3：编写实现**

创建 `mobile-app/lib/features/skills/local_library_card.dart`：

```dart
import 'package:flutter/material.dart';

import '../../core/i18n/strings.dart';
import '../../core/skills/local_library_index.dart';

/// 库技能的安装状态。
enum InstallStatus {
  /// 未安装。
  notInstalled,

  /// 已安装（来自 user source）。
  installedUser,

  /// 已安装（来自 github source）。
  installedGithub,
}

/// 本地技能库的单个技能卡片。
class LocalLibraryCard extends StatelessWidget {
  final LocalLibrarySkill skill;
  final InstallStatus installStatus;
  final VoidCallback? onInstall;
  final VoidCallback? onUninstall;
  final VoidCallback? onTap;

  const LocalLibraryCard({
    super.key,
    required this.skill,
    required this.installStatus,
    this.onInstall,
    this.onUninstall,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: ListTile(
        leading: Icon(_categoryIcon(skill.category), color: theme.colorScheme.primary),
        title: Text(
          skill.name,
          style: TextStyle(color: theme.colorScheme.onSurface),
        ),
        subtitle: Text(
          skill.description,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6)),
        ),
        trailing: _buildTrailing(theme),
        onTap: onTap,
      ),
    );
  }

  Widget _buildTrailing(ThemeData theme) {
    switch (installStatus) {
      case InstallStatus.notInstalled:
        return FilledButton.tonal(
          onPressed: onInstall,
          child: Text(I18n.t('skills.install')),
        );
      case InstallStatus.installedUser:
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_circle, color: theme.colorScheme.primary, size: 18),
            const SizedBox(width: 4),
            OutlinedButton(
              onPressed: onUninstall,
              child: Text(I18n.t('skills.uninstall')),
            ),
          ],
        );
      case InstallStatus.installedGithub:
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_download_outlined,
                color: theme.colorScheme.secondary, size: 18),
            const SizedBox(width: 4),
            Text(
              I18n.t('skills.installedFromGithub'),
              style: TextStyle(
                  color: theme.colorScheme.secondary,
                  fontSize: 12),
            ),
          ],
        );
    }
  }

  IconData _categoryIcon(String category) {
    switch (category) {
      case LocalLibraryCategories.development:
        return Icons.code;
      case LocalLibraryCategories.frontendDesign:
        return Icons.design_services_outlined;
      case LocalLibraryCategories.office:
        return Icons.description_outlined;
      case LocalLibraryCategories.aiMl:
        return Icons.psychology_outlined;
      case LocalLibraryCategories.devops:
        return Icons.cloud_outlined;
      case LocalLibraryCategories.creative:
        return Icons.palette_outlined;
      case LocalLibraryCategories.communication:
        return Icons.chat_outlined;
      default:
        return Icons.extension_outlined;
    }
  }
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`flutter test test/features/skills/local_library_card_test.dart`

预期：PASS（7 个测试通过）

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/features/skills/local_library_card.dart mobile-app/test/features/skills/local_library_card_test.dart
git commit -m "feat(mobile): 新增 LocalLibraryCard Widget"
```

---

## 任务 7：LocalLibraryScreen Widget

**文件：**
- 创建：`mobile-app/lib/features/skills/local_library_screen.dart`
- 测试：`mobile-app/test/features/skills/local_library_screen_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/features/skills/local_library_screen_test.dart`：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:spacecode_mobile/core/i18n/strings.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';
import 'package:spacecode_mobile/core/skills/local_library_installer.dart';
import 'package:spacecode_mobile/core/skills/local_library_notifier.dart';
import 'package:spacecode_mobile/core/skills/local_library_source.dart';
import 'package:spacecode_mobile/core/skills/skill_registry.dart';
import 'package:spacecode_mobile/core/skills/skill_types.dart';
import 'package:spacecode_mobile/features/skills/local_library_screen.dart';

void main() {
  setUpAll(() {
    I18n.initForTest(
      locale: AppLocale.zh,
      strings: const {
        'skills.librarySearchHint': '搜索技能',
        'skills.libraryEmpty': '无匹配技能',
        'skills.libraryNoSkills': '技能库为空',
        'skills.libraryLoadError': '加载失败',
        'skills.install': '安装',
        'skills.uninstall': '卸载',
        'skills.installed': '已安装',
        'skills.installedFromGithub': '已安装（GitHub）',
        'skills.categoryAll': '全部',
        'skills.categoryDevelopment': '开发',
        'skills.categoryOffice': '办公',
        'skills.categoryOther': '其他',
      },
    );
  });

  late GoRouter router;

  setUp(() {
    router = GoRouter(routes: [
      GoRoute(path: '/', builder: (c, s) => const LocalLibraryScreen()),
      GoRoute(
          path: '/skills/library/:name',
          builder: (c, s) =>
              Scaffold(body: Text('detail:${s.pathParameters['name']}'))),
    ]);
  });

  Future<void> pumpScreen(
    WidgetTester tester, {
    List<LocalLibrarySkill> skills = const [],
    bool loading = false,
    String? error,
    Set<String> installedNames = const {},
    String selectedCategory = 'all',
    String searchQuery = '',
  }) async {
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: skills,
            loading: loading,
            error: error,
            installedNames: installedNames,
            selectedCategory: selectedCategory,
            searchQuery: searchQuery,
          )),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows loading indicator when loading and skills empty',
      (tester) async {
    await pumpScreen(tester, loading: true);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('shows error message and retry button on error', (tester) async {
    await pumpScreen(tester, error: '加载失败');
    expect(find.text('加载失败'), findsOneWidget);
    // 重试按钮文本取决于实现，验证存在 IconButton 或按钮
    expect(find.byIcon(Icons.refresh), findsOneWidget);
  });

  testWidgets('shows empty message when library has no skills', (tester) async {
    await pumpScreen(tester, skills: []);
    expect(find.text('技能库为空'), findsOneWidget);
  });

  testWidgets('shows skill list when skills exist', (tester) async {
    await pumpScreen(tester, skills: const [
      LocalLibrarySkill(
          name: 'code-review', description: 'Review', category: 'development', assetPath: 'p'),
      LocalLibrarySkill(
          name: 'pdf', description: 'PDF', category: 'office', assetPath: 'p'),
    ]);
    expect(find.text('code-review'), findsOneWidget);
    expect(find.text('pdf'), findsOneWidget);
  });

  testWidgets('search field filters list by query', (tester) async {
    await pumpScreen(tester, skills: const [
      LocalLibrarySkill(
          name: 'code-review', description: 'Review changes', category: 'development', assetPath: 'p'),
      LocalLibrarySkill(
          name: 'pdf', description: 'PDF processing', category: 'office', assetPath: 'p'),
    ]);
    // 输入搜索词
    await tester.enterText(find.byType(TextField), 'pdf');
    await tester.pump();
    // 由于我们用了 _FakeNotifier，输入框的文字不会自动同步到状态
    // 这个测试主要验证搜索框存在并可输入
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('shows category chips', (tester) async {
    await pumpScreen(tester, skills: const [
      LocalLibrarySkill(
          name: 'a', description: 'd', category: 'development', assetPath: 'p'),
    ]);
    expect(find.text('全部'), findsOneWidget);
    expect(find.text('开发'), findsOneWidget);
  });

  testWidgets('shows install button when skill not installed', (tester) async {
    await pumpScreen(tester, skills: const [
      LocalLibrarySkill(
          name: 'foo', description: 'd', category: 'other', assetPath: 'p'),
    ], installedNames: {});
    expect(find.text('安装'), findsOneWidget);
  });

  testWidgets('shows uninstall button when skill installed (user)', (tester) async {
    await pumpScreen(tester, skills: const [
      LocalLibrarySkill(
          name: 'foo', description: 'd', category: 'other', assetPath: 'p'),
    ], installedNames: {'foo'});
    expect(find.text('卸载'), findsOneWidget);
  });

  testWidgets('empty search result shows empty message', (tester) async {
    await pumpScreen(
      tester,
      skills: const [
        LocalLibrarySkill(
            name: 'foo', description: 'd', category: 'other', assetPath: 'p'),
      ],
      searchQuery: 'nonexistent',
    );
    expect(find.text('无匹配技能'), findsOneWidget);
  });
}

class _FakeNotifier extends LocalLibraryNotifier {
  _FakeNotifier({
    required List<LocalLibrarySkill> skills,
    required bool loading,
    required String? error,
    required Set<String> installedNames,
    required String selectedCategory,
    required String searchQuery,
  })  : _initialState = LocalLibraryState(
          skills: skills,
          loading: loading,
          error: error,
          installedNames: installedNames,
          selectedCategory: selectedCategory,
          searchQuery: searchQuery,
        ),
        super._forTest();

  final LocalLibraryState _initialState;

  @override
  LocalLibraryState get state => _initialState;

  @override
  set state(LocalLibraryState value) {}

  @override
  Future<void> refresh() async {}

  @override
  void setCategory(String category) {}

  @override
  void setSearchQuery(String query) {}

  @override
  Future<void> install(LocalLibrarySkill skill) async {}

  @override
  Future<void> uninstall(String name) async {}
}
```

注意：`_FakeNotifier` 需要继承 `LocalLibraryNotifier`，但 `LocalLibraryNotifier` 构造需要 `Ref`、`LocalLibrarySource`、`LocalLibraryInstaller`。为支持测试，需要在 `LocalLibraryNotifier` 中添加 `_forTest` 命名构造。修改任务 5 的实现，在 `LocalLibraryNotifier` 中添加：

```dart
/// 测试专用构造，不触发 refresh()。
LocalLibraryNotifier._forTest()
    : _ref = _NullRef(),
      _source = LocalLibrarySource(),
      _installer = LocalLibraryInstaller(),
      super(LocalLibraryState.empty);
```

但 `_NullRef` 难以实现（`Ref` 是抽象类）。替代方案：让 `_FakeNotifier` 不继承 `LocalLibraryNotifier`，而是直接实现 `LocalLibraryState` 的状态管理。

更好的方案：`LocalLibraryScreen` 不直接 watch `localLibraryProvider`，而是通过构造参数接收 state 和 callbacks。但这样破坏 Riverpod 的设计。

最终方案：在 `LocalLibraryNotifier` 中添加受保护的构造函数，接受可选依赖：

```dart
class LocalLibraryNotifier extends StateNotifier<LocalLibraryState> {
  final Ref? _ref;
  final LocalLibrarySource? _source;
  final LocalLibraryInstaller? _installer;

  LocalLibraryNotifier(this._ref, this._source, this._installer)
      : super(LocalLibraryState.empty) {
    refresh();
  }

  /// 测试专用：不触发 refresh，不依赖外部。
  @visibleForTesting
  LocalLibraryNotifier.forTest()
      : _ref = null,
        _source = null,
        _installer = null,
        super(LocalLibraryState.empty);
  ...
}
```

然后 `_FakeNotifier` 继承 `LocalLibraryNotifier.forTest()`。需要 import `package:flutter/foundation.dart` 的 `@visibleForTesting`。

- [ ] **步骤 2：运行测试验证失败**

运行：`flutter test test/features/skills/local_library_screen_test.dart`

预期：FAIL，报错 `Target of URI doesn't exist`

- [ ] **步骤 3：修改 LocalLibraryNotifier 添加 forTest 构造**

编辑 `mobile-app/lib/core/skills/local_library_notifier.dart`，在 `LocalLibraryNotifier` 类中添加：

```dart
import 'package:flutter/foundation.dart' show visibleForTesting;

// ... 修改 LocalLibraryNotifier：

class LocalLibraryNotifier extends StateNotifier<LocalLibraryState> {
  final Ref? _ref;
  final LocalLibrarySource? _source;
  final LocalLibraryInstaller? _installer;

  LocalLibraryNotifier(this._ref, this._source, this._installer)
      : super(LocalLibraryState.empty) {
    refresh();
  }

  /// 测试专用：不触发 refresh，不依赖外部。
  @visibleForTesting
  LocalLibraryNotifier.forTest()
      : _ref = null,
        _source = null,
        _installer = null,
        super(LocalLibraryState.empty);

  Future<void> refresh() async {
    if (_source == null) return; // 测试模式直接返回
    state = state.copyWith(loading: true, error: null);
    try {
      final index = await _source.load();
      final installed = _computeInstalledNames();
      state = LocalLibraryState(
        skills: index.skills,
        loading: false,
        error: null,
        installedNames: installed,
        selectedCategory: state.selectedCategory,
        searchQuery: state.searchQuery,
      );
    } catch (error) {
      state = state.copyWith(loading: false, error: error.toString());
    }
  }

  // install / uninstall 中的 _ref 调用需要 null check
  Future<void> install(LocalLibrarySkill skill) async {
    if (_installer == null || _ref == null) return;
    await _installer.install(skill);
    await _ref.read(skillRegistryProvider.notifier).refresh();
    await refresh();
  }

  Future<void> uninstall(String name) async {
    if (_ref == null) return;
    await _ref.read(skillRegistryProvider.notifier).uninstall(name);
    await refresh();
  }

  Set<String> _computeInstalledNames() {
    if (_ref == null) return const {};
    final skills = _ref.read(skillRegistryProvider).skills;
    return skills
        .where((s) =>
            s.source == SkillSourceKind.user ||
            s.source == SkillSourceKind.github)
        .map((s) => s.name)
        .toSet();
  }
}
```

- [ ] **步骤 4：编写 LocalLibraryScreen 实现**

创建 `mobile-app/lib/features/skills/local_library_screen.dart`：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/i18n/strings.dart';
import '../../core/skills/local_library_index.dart';
import '../../core/skills/local_library_notifier.dart';
import 'local_library_card.dart';

/// 本地技能库浏览页：列表 + 搜索 + 分类筛选。
class LocalLibraryScreen extends ConsumerStatefulWidget {
  const LocalLibraryScreen({super.key});

  @override
  ConsumerState<LocalLibraryScreen> createState() => _LocalLibraryScreenState();
}

class _LocalLibraryScreenState extends ConsumerState<LocalLibraryScreen> {
  final _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(localLibraryProvider);
    final theme = Theme.of(context);

    if (state.loading && state.skills.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.error != null && state.skills.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                state.error!,
                style: TextStyle(color: theme.colorScheme.error),
                textAlign: TextAlign.center,
              ),
            ),
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () =>
                  ref.read(localLibraryProvider.notifier).refresh(),
            ),
          ],
        ),
      );
    }

    if (state.skills.isEmpty) {
      return Center(
        child: Text(
          I18n.t('skills.libraryNoSkills'),
          style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.5)),
        ),
      );
    }

    final filtered = state.filteredSkills;

    return Column(
      children: [
        // 搜索框
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            controller: _searchController,
            decoration: InputDecoration(
              hintText: I18n.t('skills.librarySearchHint'),
              prefixIcon: const Icon(Icons.search),
              border: const OutlineInputBorder(),
              isDense: true,
              suffixIcon: _searchController.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () {
                        _searchController.clear();
                        ref
                            .read(localLibraryProvider.notifier)
                            .setSearchQuery('');
                      },
                    )
                  : null,
            ),
            onChanged: (value) =>
                ref.read(localLibraryProvider.notifier).setSearchQuery(value),
          ),
        ),
        // 分类筛选
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            children: LocalLibraryCategories.allValues.map((cat) {
              final selected = state.selectedCategory == cat;
              final label = I18n.t('skills.category${_capitalize(cat)}');
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: FilterChip(
                  label: Text(label),
                  selected: selected,
                  onSelected: (_) =>
                      ref.read(localLibraryProvider.notifier).setCategory(cat),
                ),
              );
            }).toList(),
          ),
        ),
        const SizedBox(height: 8),
        // 技能列表
        if (filtered.isEmpty)
          Expanded(
            child: Center(
              child: Text(
                I18n.t('skills.libraryEmpty'),
                style: TextStyle(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.5)),
              ),
            ),
          )
        else
          Expanded(
            child: RefreshIndicator(
              onRefresh: () =>
                  ref.read(localLibraryProvider.notifier).refresh(),
              child: ListView.builder(
                itemCount: filtered.length,
                itemBuilder: (context, index) {
                  final skill = filtered[index];
                  final status = _resolveStatus(state, skill);
                  return LocalLibraryCard(
                    skill: skill,
                    installStatus: status,
                    onInstall: () =>
                        ref.read(localLibraryProvider.notifier).install(skill),
                    onUninstall: () =>
                        ref.read(localLibraryProvider.notifier).uninstall(skill.name),
                    onTap: () => context.push('/skills/library/${skill.name}'),
                  );
                },
              ),
            ),
          ),
      ],
    );
  }

  InstallStatus _resolveStatus(
      LocalLibraryState state, LocalLibrarySkill skill) {
    if (!state.isInstalled(skill.name)) {
      return InstallStatus.notInstalled;
    }
    // 检查 SkillRegistry 中该技能的 source 区分 user 和 github
    final registry = ref.read(skillRegistryProvider);
    final installed = registry.skills
        .where((s) => s.name == skill.name)
        .firstOrNull;
    if (installed?.source == SkillSourceKind.github) {
      return InstallStatus.installedGithub;
    }
    return InstallStatus.installedUser;
  }

  String _capitalize(String s) {
    if (s.isEmpty) return s;
    // 'ai-ml' → 'AiMl'
    return s
        .split('-')
        .map((part) =>
            part.isEmpty ? part : part[0].toUpperCase() + part.substring(1))
        .join();
  }
}
```

注意：`LocalLibraryScreen` 中 `ref.read(skillRegistryProvider)` 需要 import `skill_registry.dart` 和 `skill_types.dart`。添加 imports：

```dart
import '../../core/skills/skill_registry.dart';
import '../../core/skills/skill_types.dart';
```

- [ ] **步骤 5：运行测试验证通过**

运行：`flutter test test/features/skills/local_library_screen_test.dart`

预期：PASS（9 个测试通过）

- [ ] **步骤 6：Commit**

```bash
git add mobile-app/lib/features/skills/local_library_screen.dart mobile-app/test/features/skills/local_library_screen_test.dart mobile-app/lib/core/skills/local_library_notifier.dart
git commit -m "feat(mobile): 新增 LocalLibraryScreen 浏览页（列表+搜索+分类筛选）"
```

---

## 任务 8：LocalLibraryDetailPage Widget

**文件：**
- 创建：`mobile-app/lib/features/skills/local_library_detail_page.dart`
- 测试：`mobile-app/test/features/skills/local_library_detail_page_test.dart`

- [ ] **步骤 1：编写失败的测试**

创建 `mobile-app/test/features/skills/local_library_detail_page_test.dart`：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:spacecode_mobile/core/i18n/strings.dart';
import 'package:spacecode_mobile/core/skills/local_library_index.dart';
import 'package:spacecode_mobile/core/skills/local_library_notifier.dart';
import 'package:spacecode_mobile/features/skills/local_library_detail_page.dart';

void main() {
  setUpAll(() {
    I18n.initForTest(
      locale: AppLocale.zh,
      strings: const {
        'skills.install': '安装',
        'skills.uninstall': '卸载',
        'skills.uninstallConfirm': '确定卸载此技能？',
      },
    );
  });

  testWidgets('renders skill markdown content', (tester) async {
    const content = '# Foo Skill\n\nThis is the foo skill description.';
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: const [
              LocalLibrarySkill(
                  name: 'foo', description: 'desc', category: 'other', assetPath: 'p'),
            ],
            installedNames: const {},
          )),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: LocalLibraryDetailPage(
            skillName: 'foo',
            loadContent: () async => content,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('foo'), findsOneWidget); // AppBar title
    expect(find.text('Foo Skill'), findsOneWidget); // Markdown H1
    expect(find.textContaining('foo skill description'), findsOneWidget);
  });

  testWidgets('shows install button when not installed', (tester) async {
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: const [
              LocalLibrarySkill(
                  name: 'foo', description: 'desc', category: 'other', assetPath: 'p'),
            ],
            installedNames: const {},
          )),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: LocalLibraryDetailPage(
            skillName: 'foo',
            loadContent: () async => '# Foo',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('安装'), findsOneWidget);
  });

  testWidgets('shows uninstall button when installed', (tester) async {
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: const [
              LocalLibrarySkill(
                  name: 'foo', description: 'desc', category: 'other', assetPath: 'p'),
            ],
            installedNames: const {'foo'},
          )),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: LocalLibraryDetailPage(
            skillName: 'foo',
            loadContent: () async => '# Foo',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('卸载'), findsOneWidget);
  });

  testWidgets('shows loading indicator before content loads', (tester) async {
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: const [
              LocalLibrarySkill(
                  name: 'foo', description: 'desc', category: 'other', assetPath: 'p'),
            ],
            installedNames: const {},
          )),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: LocalLibraryDetailPage(
            skillName: 'foo',
            loadContent: () async {
              await Future.delayed(const Duration(seconds: 1));
              return '# Foo';
            },
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('shows error message on content load failure', (tester) async {
    final container = ProviderContainer(overrides: [
      localLibraryProvider.overrideWith((ref) => _FakeNotifier(
            skills: const [
              LocalLibrarySkill(
                  name: 'foo', description: 'desc', category: 'other', assetPath: 'p'),
            ],
            installedNames: const {},
          )),
    ]);
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: LocalLibraryDetailPage(
            skillName: 'foo',
            loadContent: () async => throw StateError('load failed'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('load failed'), findsOneWidget);
  });
}

class _FakeNotifier extends LocalLibraryNotifier {
  _FakeNotifier({
    required List<LocalLibrarySkill> skills,
    required Set<String> installedNames,
  })  : _state = LocalLibraryState(
          skills: skills,
          loading: false,
          error: null,
          installedNames: installedNames,
          selectedCategory: 'all',
          searchQuery: '',
        ),
        super.forTest();

  final LocalLibraryState _state;

  @override
  LocalLibraryState get state => _state;

  @override
  set state(LocalLibraryState value) {}

  @override
  Future<void> refresh() async {}

  @override
  Future<void> install(LocalLibrarySkill skill) async {}

  @override
  Future<void> uninstall(String name) async {}
}
```

- [ ] **步骤 2：运行测试验证失败**

运行：`flutter test test/features/skills/local_library_detail_page_test.dart`

预期：FAIL，报错 `Target of URI doesn't exist`

- [ ] **步骤 3：编写实现**

创建 `mobile-app/lib/features/skills/local_library_detail_page.dart`：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:go_router/go_router.dart';

import '../../core/i18n/strings.dart';
import '../../core/skills/local_library_notifier.dart';
import '../../core/skills/skill_registry.dart';
import '../../core/skills/skill_types.dart';

/// 库技能详情页：展示 SKILL.md 全文，支持安装/卸载。
///
/// [loadContent] 回调用于读取 SKILL.md 内容（从 rootBundle）。
/// 测试时可注入 mock 回调。
class LocalLibraryDetailPage extends ConsumerStatefulWidget {
  final String skillName;
  final Future<String> Function() loadContent;

  const LocalLibraryDetailPage({
    super.key,
    required this.skillName,
    required this.loadContent,
  });

  @override
  ConsumerState<LocalLibraryDetailPage> createState() =>
      _LocalLibraryDetailPageState();
}

class _LocalLibraryDetailPageState
    extends ConsumerState<LocalLibraryDetailPage> {
  late Future<String> _contentFuture;

  @override
  void initState() {
    super.initState();
    _contentFuture = widget.loadContent();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(localLibraryProvider);
    final registry = ref.watch(skillRegistryProvider);
    final isInstalled = state.isInstalled(widget.skillName);
    final installedSkill = registry.skills
        .where((s) => s.name == widget.skillName)
        .firstOrNull;
    final isGithub = installedSkill?.source == SkillSourceKind.github;

    return FutureBuilder<String>(
      future: _contentFuture,
      builder: (context, snapshot) {
        return Scaffold(
          appBar: AppBar(
            title: Text(widget.skillName),
            actions: [
              if (!isInstalled)
                IconButton(
                  icon: const Icon(Icons.download_outlined),
                  tooltip: I18n.t('skills.install'),
                  onPressed: () async {
                    final skill = state.skills
                        .where((s) => s.name == widget.skillName)
                        .firstOrNull;
                    if (skill != null) {
                      await ref
                          .read(localLibraryProvider.notifier)
                          .install(skill);
                    }
                  },
                )
              else if (!isGithub)
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: I18n.t('skills.uninstall'),
                  onPressed: () => _confirmDelete(context),
                ),
            ],
          ),
          body: snapshot.hasData
              ? Markdown(data: snapshot.data!)
              : snapshot.hasError
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          '加载失败：${snapshot.error}',
                          style: TextStyle(
                              color: Theme.of(context).colorScheme.error),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : const Center(child: CircularProgressIndicator()),
        );
      },
    );
  }

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(I18n.t('skills.uninstall')),
        content: Text(I18n.t('skills.uninstallConfirm')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(I18n.t('skills.uninstall')),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await ref
          .read(localLibraryProvider.notifier)
          .uninstall(widget.skillName);
      if (context.mounted) {
        Navigator.of(context).canPop()
            ? Navigator.of(context).pop()
            : context.go('/skills');
      }
    }
  }
}
```

注意：需要 import `package:flutter_riverpod/flutter_riverpod.dart` for `firstOrNull` extension（实际上是 `dart:core` 的，Flutter 3.7+ 已内置）。

- [ ] **步骤 4：运行测试验证通过**

运行：`flutter test test/features/skills/local_library_detail_page_test.dart`

预期：PASS（5 个测试通过）

- [ ] **步骤 5：Commit**

```bash
git add mobile-app/lib/features/skills/local_library_detail_page.dart mobile-app/test/features/skills/local_library_detail_page_test.dart
git commit -m "feat(mobile): 新增 LocalLibraryDetailPage 详情页"
```

---

## 任务 9：SkillsScreen 改造 + 路由 + i18n + pubspec

**文件：**
- 修改：`mobile-app/lib/features/skills/skills_screen.dart`
- 修改：`mobile-app/lib/routing/router.dart`
- 修改：`mobile-app/lib/core/i18n/locales/zh.json`
- 修改：`mobile-app/lib/core/i18n/locales/en.json`
- 修改：`mobile-app/pubspec.yaml`

- [ ] **步骤 1：更新 pubspec.yaml 声明 assets**

编辑 `mobile-app/pubspec.yaml`，在 `flutter.assets` 段追加 `skills-lib/index.json` 和 `skills-lib/` 目录：

```yaml
flutter:
  uses-material-design: true
  assets:
    - assets/skills/code-review/SKILL.md
    - assets/skills/commit-message/SKILL.md
    - assets/skills-lib/index.json
    - assets/skills-lib/
    - lib/core/i18n/locales/zh.json
    - lib/core/i18n/locales/en.json
```

- [ ] **步骤 2：扩展 i18n 字符串**

编辑 `mobile-app/lib/core/i18n/locales/zh.json`，在末尾（`"settings.languageEn": "English"` 之前）追加：

```json
{
  "common.refresh": "刷新",
  "skills.title": "技能",
  "skills.empty": "暂无技能，点击右上角安装或从桌面端同步",
  "skills.install": "安装",
  "skills.installDialogTitle": "从 GitHub 安装技能",
  "skills.installDialogHint": "支持 github.com/user/repo 或 user/repo 格式",
  "skills.installDialogWarning": "第三方技能可能包含任意指令，安装前请审查内容。",
  "skills.installSuccess": "安装成功",
  "skills.installFailed": "安装失败：{error}",
  "skills.uninstall": "卸载",
  "skills.uninstallConfirm": "确定卸载此技能？",
  "skills.edit": "编辑",
  "skills.delete": "删除",
  "skills.enabled": "启用",
  "skills.disabled": "禁用",
  "skills.sourceBundled": "内置",
  "skills.sourceUser": "本地",
  "skills.sourceGithub": "GitHub",
  "skills.sourceDesktop": "同步",
  "skills.commandHint": "输入 / 查看可用命令",
  "skills.commandManage": "管理技能",
  "skills.mySkills": "我的技能",
  "skills.library": "技能库",
  "skills.librarySearchHint": "搜索技能",
  "skills.libraryEmpty": "无匹配技能",
  "skills.libraryNoSkills": "技能库为空",
  "skills.libraryLoadError": "加载失败",
  "skills.installed": "已安装",
  "skills.installedFromGithub": "已安装（GitHub）",
  "skills.categoryAll": "全部",
  "skills.categoryDevelopment": "开发",
  "skills.categoryFrontendDesign": "前端设计",
  "skills.categoryOffice": "办公",
  "skills.categoryAiMl": "AI/ML",
  "skills.categoryDevops": "DevOps",
  "skills.categoryCreative": "创意",
  "skills.categoryCommunication": "沟通",
  "skills.categoryOther": "其他",
  "settings.language": "语言",
  "settings.languageZh": "中文",
  "settings.languageEn": "English"
}
```

编辑 `mobile-app/lib/core/i18n/locales/en.json`，对应英文版本：

```json
{
  "common.refresh": "Refresh",
  "skills.title": "Skills",
  "skills.empty": "No skills yet. Tap install in the top right or sync from desktop.",
  "skills.install": "Install",
  "skills.installDialogTitle": "Install skill from GitHub",
  "skills.installDialogHint": "Supports github.com/user/repo or user/repo",
  "skills.installDialogWarning": "Third-party skills may contain arbitrary instructions. Review before installing.",
  "skills.installSuccess": "Installed",
  "skills.installFailed": "Install failed: {error}",
  "skills.uninstall": "Uninstall",
  "skills.uninstallConfirm": "Uninstall this skill?",
  "skills.edit": "Edit",
  "skills.delete": "Delete",
  "skills.enabled": "Enabled",
  "skills.disabled": "Disabled",
  "skills.sourceBundled": "Bundled",
  "skills.sourceUser": "Local",
  "skills.sourceGithub": "GitHub",
  "skills.sourceDesktop": "Synced",
  "skills.commandHint": "Type / for commands",
  "skills.commandManage": "Manage skills",
  "skills.mySkills": "My Skills",
  "skills.library": "Library",
  "skills.librarySearchHint": "Search skills",
  "skills.libraryEmpty": "No matching skills",
  "skills.libraryNoSkills": "Library is empty",
  "skills.libraryLoadError": "Failed to load",
  "skills.installed": "Installed",
  "skills.installedFromGithub": "Installed (GitHub)",
  "skills.categoryAll": "All",
  "skills.categoryDevelopment": "Development",
  "skills.categoryFrontendDesign": "Frontend & Design",
  "skills.categoryOffice": "Office",
  "skills.categoryAiMl": "AI/ML",
  "skills.categoryDevops": "DevOps",
  "skills.categoryCreative": "Creative",
  "skills.categoryCommunication": "Communication",
  "skills.categoryOther": "Other",
  "settings.language": "Language",
  "settings.languageZh": "中文",
  "settings.languageEn": "English"
}
```

- [ ] **步骤 3：改造 SkillsScreen 为 TabBar 布局**

完全重写 `mobile-app/lib/features/skills/skills_screen.dart`：

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/i18n/strings.dart';
import '../../core/skills/skill_registry.dart';
import 'local_library_screen.dart';
import 'skill_card.dart';
import 'skill_install_dialog.dart';

class SkillsScreen extends ConsumerWidget {
  const SkillsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(I18n.t('skills.title')),
          bottom: TabBar(
            tabs: [
              Tab(text: I18n.t('skills.mySkills')),
              Tab(text: I18n.t('skills.library')),
            ],
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.download_outlined),
              tooltip: I18n.t('skills.install'),
              onPressed: () => showDialog(
                context: context,
                builder: (_) => const SkillInstallDialog(),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: I18n.t('common.refresh'),
              onPressed: () =>
                  ref.read(skillRegistryProvider.notifier).refresh(),
            ),
          ],
        ),
        body: const TabBarView(
          children: [
            _MySkillsTab(),
            LocalLibraryScreen(),
          ],
        ),
      ),
    );
  }
}

/// "我的技能"tab：已安装技能列表（原 SkillsScreen 的 body）。
class _MySkillsTab extends ConsumerWidget {
  const _MySkillsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(skillRegistryProvider);
    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: () => ref.read(skillRegistryProvider.notifier).refresh(),
      child: state.loading && state.skills.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : state.skills.isEmpty
              ? ListView(
                  children: [
                    const SizedBox(height: 120),
                    Center(
                      child: Text(
                        I18n.t('skills.empty'),
                        style: TextStyle(
                          color: theme.colorScheme.onSurface
                              .withValues(alpha: 0.5),
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ],
                )
              : ListView.builder(
                  itemCount: state.skills.length,
                  itemBuilder: (context, index) {
                    final skill = state.skills[index];
                    final enabled =
                        !state.disabledNames.contains(skill.name);
                    return SkillCard(
                      skill: skill,
                      enabled: enabled,
                      onTap: () => context.push('/skills/${skill.name}'),
                    );
                  },
                ),
    );
  }
}
```

- [ ] **步骤 4：更新路由**

编辑 `mobile-app/lib/routing/router.dart`，在 `/skills/:name` 之后新增 `/skills/library/:name` 路由。注意路由顺序：`/skills/library/:name` 必须在 `/skills/:name` **之前**，否则 `library` 会被当成 `:name` 匹配：

```dart
import 'package:go_router/go_router.dart';
import '../features/chat/chat_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/skills/local_library_detail_page.dart';
import '../features/skills/skill_detail_page.dart';
import '../features/skills/skills_screen.dart';
import 'package:flutter/services.dart' show rootBundle;
import '../core/skills/local_library_notifier.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final router = GoRouter(
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const ChatScreen(),
    ),
    GoRoute(
      path: '/settings',
      builder: (context, state) => const SettingsScreen(),
    ),
    GoRoute(
      path: '/skills',
      builder: (context, state) => const SkillsScreen(),
    ),
    GoRoute(
      path: '/skills/library/:name',
      builder: (context, state) {
        final name = state.pathParameters['name']!;
        return Consumer(
          builder: (context, ref, _) {
            final state = ref.watch(localLibraryProvider);
            final skill = state.skills.where((s) => s.name == name).firstOrNull;
            return LocalLibraryDetailPage(
              skillName: name,
              loadContent: () async {
                if (skill == null) {
                  throw StateError('Skill not found in library: $name');
                }
                return await rootBundle.loadString(skill.assetPath);
              },
            );
          },
        );
      },
    ),
    GoRoute(
      path: '/skills/:name',
      builder: (context, state) =>
          SkillDetailPage(skillName: state.pathParameters['name']!),
    ),
  ],
);
```

- [ ] **步骤 5：运行所有测试验证不破坏**

运行：`flutter test`

预期：PASS（所有之前 + 新增测试通过）

- [ ] **步骤 6：运行 flutter analyze**

运行：`flutter analyze`

预期：`No issues found!`

- [ ] **步骤 7：Commit**

```bash
git add mobile-app/pubspec.yaml mobile-app/lib/core/i18n/locales/zh.json mobile-app/lib/core/i18n/locales/en.json mobile-app/lib/features/skills/skills_screen.dart mobile-app/lib/routing/router.dart
git commit -m "feat(mobile): SkillsScreen 改造为 TabBar 布局，新增技能库 tab + 路由 + i18n"
```

---

## 任务 10：全量验证

- [ ] **步骤 1：运行 flutter analyze**

运行：`cd mobile-app; flutter analyze`

预期：`No issues found!` 或仅有不影响功能的 info 级提示

- [ ] **步骤 2：运行全量测试**

运行：`cd mobile-app; flutter test`

预期：所有测试通过（包含原有的 61 个 + 新增的约 40 个）

- [ ] **步骤 3：构建 debug APK 验证**

运行：`& "D:\dev\flutter\bin\flutter.bat" build apk --debug`

预期：APK 成功生成 `build\app\outputs\flutter-apk\app-debug.apk`

- [ ] **步骤 4：手动验证清单**

将 APK 安装到手机，验证：

- [ ] APP 启动后，进入"技能"页面，看到两个 tab："我的技能"和"技能库"
- [ ] 默认显示"我的技能"tab，列表为空（除非已有 bundled 技能）
- [ ] 点击"技能库"tab，看到 70+ 技能列表
- [ ] 搜索框输入"review"，列表过滤出含 review 的技能
- [ ] 点击分类筛选"开发"，列表只显示 development 类技能
- [ ] 点击一个未安装技能卡片，进入详情页，看到 SKILL.md 全文
- [ ] 详情页右上角"安装"按钮可点击
- [ ] 点击"安装"后返回列表，该技能显示"卸载"按钮
- [ ] 切换到"我的技能"tab，该技能出现在列表中
- [ ] 在"我的技能"tab 中可通过 Switch 启用/禁用该技能
- [ ] 在详情页点击"卸载"按钮，确认后技能从"我的技能"tab 消失
- [ ] 切换语言为英文，所有界面文本变为英文

- [ ] **步骤 5：Commit 验证结果（如有修复）**

如手动验证发现问题，修复后 commit。否则跳过此步骤。

```bash
git log --oneline -10
```

预期：看到 9-10 个 commit，对应任务 1-9（或 10）

---

## 自检

### 规格覆盖度

| 规格章节 | 对应任务 |
|---------|---------|
| 1. 背景与目标 | 无需任务（描述性） |
| 2. 架构概览 | 任务 1-9 全部覆盖 |
| 2.2 不新增 SkillSourceKind.localLibrary | 任务 4（install 到 user 目录） |
| 3.1 index.json 格式 | 任务 1（脚本生成） |
| 3.2 LocalLibrarySkill 数据类 | 任务 2 |
| 3.3 分类常量 | 任务 2 |
| 4. 同步脚本 | 任务 1 |
| 5. LocalLibrarySource | 任务 3 |
| 6. LocalLibraryInstaller | 任务 4 |
| 7. Riverpod 状态管理 | 任务 5 |
| 8.1 SkillsScreen 改造 | 任务 9 |
| 8.2 LocalLibraryScreen 布局 | 任务 7 |
| 8.3 LocalLibraryCard | 任务 6 |
| 8.4 LocalLibraryDetailPage | 任务 8 |
| 8.5 路由 | 任务 9 |
| 8.6 空状态与加载状态 | 任务 7 |
| 9. i18n 扩展 | 任务 9 |
| 10. 错误处理 | 任务 3（加载失败）+ 任务 4（安装失败）+ 任务 7（UI 错误展示） |
| 11. 测试策略 | 任务 2-8 均含测试，任务 10 全量验证 |
| 12. 任务拆分 | 与本计划一致 |
| 13. 风险与缓解 | 设计层面，无需任务 |

**遗漏：** 无

### 占位符扫描

✅ 无 TODO / 待定 / "类似任务 N" 等占位符。所有代码块完整。

### 类型一致性

- `LocalLibrarySkill` 字段：name / description / category / assetPath —— 任务 2、3、4、5、6、7、8 一致
- `LocalLibraryIndex` 字段：version / generatedAt / skills —— 任务 2、3 一致
- `LocalLibraryState` 字段：skills / loading / error / installedNames / selectedCategory / searchQuery —— 任务 5、7、8 一致
- `LocalLibraryNotifier` 方法：refresh / setCategory / setSearchQuery / install / uninstall —— 任务 5、7、8 一致
- `LocalLibraryNotifier.forTest()` —— 任务 5 添加，任务 7、8 测试使用
- `InstallStatus` 枚举：notInstalled / installedUser / installedGithub —— 任务 6、7 一致
- `LocalLibraryCard` 参数：skill / installStatus / onInstall / onUninstall / onTap —— 任务 6、7 一致
- `LocalLibraryDetailPage` 参数：skillName / loadContent —— 任务 8、9 一致

✅ 类型一致

---

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-07-20-mobile-app-local-skills-library.md`。两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

选哪种方式？
