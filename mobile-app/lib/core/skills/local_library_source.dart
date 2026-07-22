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
