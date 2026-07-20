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
