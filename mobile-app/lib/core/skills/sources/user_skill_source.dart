import 'dart:io';

import '../skill_loader.dart';
import '../skill_types.dart';
import 'filesystem_skill_source.dart';

/// 用户本地创建的技能来源。
///
/// 路径：`getApplicationDocumentsDirectory()/spacecode/skills/`
class UserSkillSource extends SkillSource with FilesystemSkillSource {
  final Directory rootDirectory;

  UserSkillSource(this.rootDirectory);

  @override
  SkillSourceKind get kind => SkillSourceKind.user;

  @override
  Future<LoadResult> load() => scanDirectory(rootDirectory);
}
