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
