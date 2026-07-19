import 'skill_types.dart';

/// 单一技能来源的扫描器接口。
abstract class SkillSource {
  /// 来源类型。
  SkillSourceKind get kind;

  /// 扫描该来源下所有可用技能。
  ///
  /// 返回 [LoadResult] 包含扫描到的技能列表与诊断信息。
  /// 单个技能加载失败应记 diagnostic，不抛异常中断整体扫描。
  Future<LoadResult> load();
}

/// 聚合多个 [SkillSource] 的加载结果。
class SkillLoader {
  /// 按优先级排序的来源列表（高优先级在前）。
  ///
  /// 默认顺序：bundled > user > github > desktopSync。
  /// 同名技能先到先得，被覆盖的记 collision diagnostic。
  final List<SkillSource> sources;

  SkillLoader(this.sources);

  /// 并行加载所有 source，按 sources 列表顺序去重。
  Future<LoadResult> load() async {
    final results = await Future.wait(sources.map((s) => s.load()));
    final skillsByName = <String, Skill>{};
    final diagnostics = <SkillDiagnostic>[];

    for (var i = 0; i < sources.length; i++) {
      final result = results[i];
      diagnostics.addAll(result.diagnostics);
      for (final skill in result.skills) {
        if (skillsByName.containsKey(skill.name)) {
          final existing = skillsByName[skill.name]!;
          diagnostics.add(SkillDiagnostic(
            type: SkillDiagnosticType.collision,
            message:
                '技能 ${skill.name} 在 ${skill.source.name} 与 ${existing.source.name} 中都存在，保留 ${existing.source.name}',
            path: skill.filePath,
          ));
          continue;
        }
        skillsByName[skill.name] = skill;
      }
    }

    return LoadResult(
      skills: skillsByName.values.toList(growable: false),
      diagnostics: diagnostics,
    );
  }
}
