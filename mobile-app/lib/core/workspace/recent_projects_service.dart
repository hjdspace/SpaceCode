// 最近打开的本地项目路径持久化存储。
//
// 使用 SharedPreferences（key: 'recent_local_projects'），
// 存储格式为 JSON 字符串数组，最多保留 20 条。
// 路径按规范化 key 去重，最新路径排在最前。
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class RecentProjectsService {
  static const _key = 'recent_local_projects';
  static const _maxEntries = 20;

  /// 规范化路径用于去重比较（统一斜杠、去尾部分隔符、转小写）。
  static String normalizePathKey(String path) {
    return path
        .trim()
        .replaceAll(RegExp(r'[/\\]+$'), '')
        .replaceAll(RegExp(r'\\'), '/')
        .toLowerCase();
  }

  /// 从路径中提取项目名称（最后一级目录名）。
  static String projectDisplayName(String path) {
    final parts = path
        .replaceAll(RegExp(r'\\'), '/')
        .split('/')
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return path;
    return parts.last;
  }

  /// 获取所有最近打开的本地项目路径（最新在前）。
  static Future<List<String>> getRecentProjects() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key);
      if (raw == null || raw.isEmpty) return [];
      final parsed = jsonDecode(raw);
      if (parsed is! List) return [];
      return parsed
          .whereType<String>()
          .where((p) => p.isNotEmpty)
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// 记录一个新打开的本地项目路径（去重并放到最前）。
  static Future<void> recordProject(String path) async {
    final trimmed = path.trim();
    if (trimmed.isEmpty) return;
    try {
      final key = normalizePathKey(trimmed);
      final prev = await getRecentProjects();
      final next = [
        trimmed,
        ...prev.where((p) => normalizePathKey(p) != key),
      ].take(_maxEntries).toList();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, jsonEncode(next));
    } catch (_) {
      // 持久化失败不影响 UI
    }
  }

  /// 从最近项目列表中移除指定路径。
  static Future<void> removeProject(String path) async {
    try {
      final key = normalizePathKey(path);
      final prev = await getRecentProjects();
      final next = prev.where((p) => normalizePathKey(p) != key).toList();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, jsonEncode(next));
    } catch (_) {
      // ignore
    }
  }
}
