import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/bundled_skills.dart';
import '../config/mobile_config.dart';
import 'skill_installer.dart';
import 'skill_loader.dart';
import 'skill_types.dart';
import 'sources/bundled_skill_source.dart';
import 'sources/desktop_sync_skill_source.dart';
import 'sources/github_skill_source.dart';
import 'sources/user_skill_source.dart';

/// 技能注册表的不可变状态。
class SkillRegistryState {
  /// 所有已加载技能（含已禁用的）。
  final List<Skill> skills;

  /// 加载诊断信息。
  final List<SkillDiagnostic> diagnostics;

  /// 是否正在加载。
  final bool loading;

  /// 禁用的技能名集合（持久化到 SharedPreferences）。
  final Set<String> disabledNames;

  const SkillRegistryState({
    required this.skills,
    required this.diagnostics,
    required this.loading,
    required this.disabledNames,
  });

  static const empty = SkillRegistryState(
    skills: [],
    diagnostics: [],
    loading: false,
    disabledNames: {},
  );

  /// 仅 enabled 技能。
  List<Skill> get enabledSkills =>
      skills.where((s) => !disabledNames.contains(s.name)).toList();

  /// 按名查找技能（无论是否禁用）。
  Skill? find(String name) {
    for (final skill in skills) {
      if (skill.name == name) return skill;
    }
    return null;
  }

  /// 切换某技能的启用状态，返回新状态。
  SkillRegistryState toggle(String name) {
    final next = Set<String>.from(disabledNames);
    if (next.contains(name)) {
      next.remove(name);
    } else {
      next.add(name);
    }
    return SkillRegistryState(
      skills: skills,
      diagnostics: diagnostics,
      loading: loading,
      disabledNames: next,
    );
  }
}

/// 技能注册表的 Riverpod notifier。
class SkillRegistryNotifier extends StateNotifier<SkillRegistryState> {
  static const _disabledKey = 'skills_disabled_names';

  final Ref _ref;
  SkillLoader? _loader;
  SharedPreferences? _prefs;

  SkillRegistryNotifier(this._ref) : super(SkillRegistryState.empty) {
    refresh();
  }

  /// 重新扫描所有来源并刷新状态。
  Future<void> refresh() async {
    state = SkillRegistryState(
      skills: state.skills,
      diagnostics: state.diagnostics,
      loading: true,
      disabledNames: state.disabledNames,
    );
    try {
      _loader ??= await _buildLoader();
      _prefs ??= await SharedPreferences.getInstance();
      final result = await _loader!.load();
      final disabled = _loadDisabled();
      state = SkillRegistryState(
        skills: result.skills,
        diagnostics: result.diagnostics,
        loading: false,
        disabledNames: disabled,
      );
    } catch (error) {
      state = SkillRegistryState(
        skills: state.skills,
        diagnostics: [
          ...state.diagnostics,
          SkillDiagnostic(
            type: SkillDiagnosticType.error,
            message: '刷新技能列表失败：$error',
          ),
        ],
        loading: false,
        disabledNames: state.disabledNames,
      );
    }
  }

  /// 切换某技能的启用状态并持久化。
  Future<void> toggleEnabled(String name) async {
    _prefs ??= await SharedPreferences.getInstance();
    state = state.toggle(name);
    await _prefs!.setStringList(_disabledKey, state.disabledNames.toList());
  }

  /// 安装 GitHub 仓库技能。委托给 SkillInstaller。
  Future<void> installFromGithub(String repoUrl) async {
    _loader ??= await _buildLoader();
    final token = _ref.read(mobileConfigProvider).githubToken;
    if (token.isEmpty) {
      throw StateError('请先在设置中完成 GitHub 认证');
    }
    final installer = SkillInstaller();
    await installer.installFromGithub(repoUrl, githubToken: token);
    await refresh();
  }

  /// 卸载技能（仅支持 user/github 来源）。
  Future<void> uninstall(String name) async {
    final skill = state.find(name);
    if (skill == null) return;
    if (skill.source != SkillSourceKind.user &&
        skill.source != SkillSourceKind.github) {
      return;
    }
    final dir = Directory(skill.baseDir);
    if (await dir.exists()) {
      await dir.delete(recursive: true);
    }
    await refresh();
  }

  Future<SkillLoader> _buildLoader() async {
    final docs = await getApplicationDocumentsDirectory();
    final skillsRoot = Directory('${docs.path}/spacecode/skills');
    return SkillLoader([
      const BundledSkillSource(bundledSkillAssetPaths),
      UserSkillSource(Directory(skillsRoot.path)),
      GithubSkillSource(Directory('${skillsRoot.path}/github')),
      DesktopSyncSkillSource(Directory('${skillsRoot.path}/desktop-sync')),
    ]);
  }

  Set<String> _loadDisabled() {
    final list = _prefs?.getStringList(_disabledKey) ?? const [];
    return list.toSet();
  }
}

/// 全局技能注册表 provider。
final skillRegistryProvider =
    StateNotifierProvider<SkillRegistryNotifier, SkillRegistryState>(
  (ref) => SkillRegistryNotifier(ref),
);
