/// 同步桌面端 skills-lib 到 mobile-app/assets/skills-lib。
///
/// 用法：dart run mobile-app/scripts/sync_skills_lib.dart
///
/// 扫描 d:/AI/SpaceCode/skills-lib/ 下所有子目录：
/// - 含 .claude-plugin/plugin.json → 跳过（Bundle，首版不支持）
/// - 含 SKILL.md → 复制到 mobile-app/assets/skills-lib/<name>/SKILL.md
/// 生成 mobile-app/assets/skills-lib/index.json（含 name/description/category/assetPath）
/// 同时更新 mobile-app/pubspec.yaml 的 assets 段（追加所有子目录声明）
library;

import 'dart:convert';
import 'dart:io';

const skillsLibSource = 'd:/AI/SpaceCode/skills-lib';
const mobileAssetsTarget = 'd:/AI/SpaceCode/mobile-app/assets/skills-lib';
const pubspecPath = 'd:/AI/SpaceCode/mobile-app/pubspec.yaml';

void main() async {
  final sourceDir = Directory(skillsLibSource);
  if (!await sourceDir.exists()) {
    stderr.writeln('Error: skills-lib source not found: $skillsLibSource');
    exit(1);
  }

  final targetDir = Directory(mobileAssetsTarget);
  await targetDir.create(recursive: true);

  final entries = <Map<String, dynamic>>[];
  final subDirs = <String>[]; // 收集子目录路径用于更新 pubspec
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
    final skillName = frontmatter['name'];
    if (skillName == null || skillName.isEmpty) {
      stderr.writeln('Warning: $name/SKILL.md missing name field, skipping');
      noSkillSkipped++;
      continue;
    }

    final description = frontmatter['description'] ?? '';
    // 智能分类推断：基于技能名+描述关键词
    final category = inferCategory(skillName, description);

    // 复制 SKILL.md 到目标目录
    final skillTargetDir = Directory('$mobileAssetsTarget/$skillName');
    await skillTargetDir.create(recursive: true);
    await File('${skillTargetDir.path}/SKILL.md').writeAsString(content);
    subDirs.add('assets/skills-lib/$skillName/');

    entries.add({
      'name': skillName,
      'description': description,
      'category': category,
      'assetPath': 'assets/skills-lib/$skillName/SKILL.md',
    });
  }

  // 按 name 排序，确保 index.json 稳定
  entries.sort((a, b) =>
      (a['name'] as String).compareTo(b['name'] as String));
  subDirs.sort();

  final index = {
    'version': 1,
    'generatedAt': DateTime.now().toUtc().toIso8601String(),
    'skills': entries,
  };

  final indexFile = File('$mobileAssetsTarget/index.json');
  await indexFile.writeAsString(const JsonEncoder.withIndent('  ').convert(index));

  // 更新 pubspec.yaml 的 assets 段
  await updatePubspecAssets(subDirs);

  stdout.writeln('Synced ${entries.length} skills to $mobileAssetsTarget');
  stdout.writeln('Skipped: $bundledSkipped bundles, $noSkillSkipped without SKILL.md');

  // 输出分类统计
  final categoryStats = <String, int>{};
  for (final e in entries) {
    final cat = e['category'] as String;
    categoryStats[cat] = (categoryStats[cat] ?? 0) + 1;
  }
  stdout.writeln('Categories:');
  categoryStats.forEach((cat, count) => stdout.writeln('  $cat: $count'));
}

/// 基于技能名和描述推断分类。
String inferCategory(String name, String description) {
  final text = '$name $description'.toLowerCase();

  // AI/ML 关键词（优先判断，避免被 development 吞）
  if (RegExp(r'\b(ai|ml|llm|gpt|claude|model|anthropic|openai|gemini|dify)\b').hasMatch(text)) {
    return 'ai-ml';
  }
  // DevOps 关键词
  if (RegExp(r'\b(docker|kubernetes|k8s|deploy|ci|cd|pipeline|terraform|helm|jenkins)\b').hasMatch(text)) {
    return 'devops';
  }
  // Office 关键词
  if (RegExp(r'\b(pdf|word|excel|ppt|docx|xlsx|pptx|office|spreadsheet|markdown|doc)\b').hasMatch(text)) {
    return 'office';
  }
  // Frontend & Design 关键词
  if (RegExp(r'\b(ui|ux|frontend|css|html|design|landing|page|website|web|component|button|modal|react|vue|tailwind|figma)\b').hasMatch(text)) {
    return 'frontend-design';
  }
  // Creative 关键词
  if (RegExp(r'\b(art|draw|paint|creative|image|video|music|animation|brand|logo)\b').hasMatch(text)) {
    return 'creative';
  }
  // Communication 关键词
  if (RegExp(r'\b(chat|mail|email|message|slack|notion|meeting|calendar|im)\b').hasMatch(text)) {
    return 'communication';
  }
  // Development 关键词（最广，放最后）
  if (RegExp(r'\b(code|review|refactor|test|tdd|git|commit|debug|bug|plan|skill|agent|mcp|api|spec|prd|issue|triage|worktree|plan|skill|hook|cli)\b').hasMatch(text)) {
    return 'development';
  }

  return 'other';
}

/// 更新 pubspec.yaml 的 assets 段，确保所有子目录都被声明。
Future<void> updatePubspecAssets(List<String> subDirs) async {
  final file = File(pubspecPath);
  if (!await file.exists()) {
    stderr.writeln('Warning: pubspec.yaml not found at $pubspecPath');
    return;
  }

  final content = await file.readAsString();
  final lines = content.split('\n');

  // 找到 assets: 行
  var assetsLineIdx = -1;
  var flutterSectionIdx = -1;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() == 'flutter:') {
      flutterSectionIdx = i;
    }
    if (lines[i].trim() == 'assets:' && flutterSectionIdx >= 0) {
      assetsLineIdx = i;
      break;
    }
  }

  if (assetsLineIdx < 0) {
    stderr.writeln('Warning: assets: section not found in pubspec.yaml');
    return;
  }

  // 收集现有 assets 段中的所有条目
  final existingAssets = <String>{};
  var lastAssetLineIdx = assetsLineIdx;
  for (var i = assetsLineIdx + 1; i < lines.length; i++) {
    final line = lines[i];
    if (!line.startsWith('    - ') && !line.startsWith('      ')) break;
    if (line.startsWith('    - ')) {
      existingAssets.add(line.substring(6).trim());
    }
    lastAssetLineIdx = i;
  }

  // 添加新的子目录声明（去重）
  final newLines = <String>[];
  for (final dir in subDirs) {
    if (!existingAssets.contains(dir)) {
      newLines.add('    - $dir');
    }
  }

  if (newLines.isEmpty) {
    stdout.writeln('pubspec.yaml assets section already up to date');
    return;
  }

  // 在最后一个 asset 行后插入新行
  lines.insertAll(lastAssetLineIdx + 1, newLines);

  await file.writeAsString(lines.join('\n'));
  stdout.writeln('Updated pubspec.yaml with ${newLines.length} new asset entries');
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
