import 'package:flutter/foundation.dart' show visibleForTesting;
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

  /// 重新加载库索引并同步已安装状态。
  Future<void> refresh() async {
    final source = _source;
    if (source == null) return; // 测试模式直接返回
    state = state.copyWith(loading: true, error: null);
    try {
      final index = await source.load();
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
    final installer = _installer;
    final ref = _ref;
    if (installer == null || ref == null) return;
    await installer.install(skill);
    await ref.read(skillRegistryProvider.notifier).refresh();
    await refresh();
  }

  /// 卸载指定技能（复用 SkillRegistry.uninstall）。
  Future<void> uninstall(String name) async {
    final ref = _ref;
    if (ref == null) return;
    await ref.read(skillRegistryProvider.notifier).uninstall(name);
    await refresh();
  }

  /// 从 SkillRegistry 计算已安装技能名集合（user + github 来源）。
  Set<String> _computeInstalledNames() {
    final ref = _ref;
    if (ref == null) return const {};
    final skills = ref.read(skillRegistryProvider).skills;
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
