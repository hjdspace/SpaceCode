import 'dart:io';

import '../skill_loader.dart';
import '../skill_types.dart';
import 'filesystem_skill_source.dart';

/// 桌面端 SpaceCode 通过 WS 推送同步的技能来源。
///
/// 路径：`getApplicationDocumentsDirectory()/spacecode/skills/desktop-sync/`
class DesktopSyncSkillSource extends SkillSource with FilesystemSkillSource {
  final Directory rootDirectory;

  DesktopSyncSkillSource(this.rootDirectory);

  @override
  SkillSourceKind get kind => SkillSourceKind.desktopSync;

  @override
  Future<LoadResult> load() => scanDirectory(rootDirectory);
}
