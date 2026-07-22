import 'package:flutter/services.dart';

import '../skill_frontmatter.dart';
import '../skill_loader.dart';
import '../skill_types.dart';
import '../skill_validator.dart';

/// 随 APK/IPA 打包的内置技能来源。
///
/// 通过 `pubspec.yaml` 的 `flutter.assets` 声明技能路径，
/// 运行时用 [rootBundle] 读取。bundled 技能只读、不可写。
class BundledSkillSource implements SkillSource {
  /// 内置技能的 asset 路径列表（如 `['assets/skills/code-review/SKILL.md']`）。
  final List<String> assetPaths;

  const BundledSkillSource(this.assetPaths);

  @override
  SkillSourceKind get kind => SkillSourceKind.bundled;

  @override
  Future<LoadResult> load() async {
    final skills = <Skill>[];
    final diagnostics = <SkillDiagnostic>[];
    for (final path in assetPaths) {
      try {
        final content = await rootBundle.loadString(path);
        final frontmatter = SkillFrontmatter.parse(content);
        final name = frontmatter.name ?? '';
        final description = frontmatter.description;
        if (description == null) {
          diagnostics.add(SkillDiagnostic(
            type: SkillDiagnosticType.warning,
            message: '内置技能 $path 的 description 缺失，已跳过',
            path: path,
          ));
          continue;
        }
        SkillValidator.validate(name: name, description: description);
        skills.add(Skill(
          name: name.trim(),
          description: description.trim(),
          filePath: path,
          baseDir: path.substring(0, path.lastIndexOf('/')),
          source: SkillSourceKind.bundled,
          disableModelInvocation: frontmatter.disableModelInvocation,
        ));
      } catch (error) {
        diagnostics.add(SkillDiagnostic(
          type: SkillDiagnosticType.error,
          message: '加载内置技能 $path 失败：$error',
          path: path,
        ));
      }
    }
    return LoadResult(skills: skills, diagnostics: diagnostics);
  }
}
