import 'dart:io';

import '../skill_loader.dart';
import '../skill_types.dart';
import 'filesystem_skill_source.dart';

/// 从 GitHub 仓库安装的技能来源。
///
/// 路径：`getApplicationDocumentsDirectory()/spacecode/skills/github/`
/// 每个安装的仓库作为子目录，扫描其中的所有 SKILL.md。
class GithubSkillSource extends SkillSource with FilesystemSkillSource {
  final Directory rootDirectory;

  GithubSkillSource(this.rootDirectory);

  @override
  SkillSourceKind get kind => SkillSourceKind.github;

  @override
  Future<LoadResult> load() => scanDirectory(rootDirectory);
}
