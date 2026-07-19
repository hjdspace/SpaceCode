import 'skill_loader.dart';

/// 从 GitHub 安装技能的安装器。
///
/// 本桩在任务 8 完成；此处仅为编译通过。
class SkillInstaller {
  final SkillLoader loader;

  SkillInstaller({required this.loader});

  Future<void> installFromGithub(String repoUrl) async {
    throw UnimplementedError('installFromGithub 待任务 8 实现');
  }
}
