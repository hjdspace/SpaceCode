import 'dart:io';

import '../skill_frontmatter.dart';
import '../skill_loader.dart';
import '../skill_types.dart';
import '../skill_validator.dart';

/// 文件系统技能来源的共享扫描逻辑。
///
/// user/github/desktopSync 三个 source 共用此 mixin。
mixin FilesystemSkillSource on SkillSource {
  /// 扫描 [rootDirectory] 下所有名为 SKILL.md 的文件（递归）。
  ///
  /// 遵循 .gitignore（若存在）中的 SKILL.md 路径排除规则——本版简化为：
  /// 遇到 node_modules、.git 目录直接跳过。
  Future<LoadResult> scanDirectory(Directory rootDirectory) async {
    if (!await rootDirectory.exists()) {
      return LoadResult.empty;
    }
    final skills = <Skill>[];
    final diagnostics = <SkillDiagnostic>[];
    try {
      await for (final entity in rootDirectory.list(
        recursive: true,
        followLinks: false,
      )) {
        if (entity is! File) continue;
        if (entity.path.split(Platform.pathSeparator).any(_isIgnoredSegment)) {
          continue;
        }
        if (_basename(entity.path) != 'SKILL.md') continue;
        final skill = await _loadSkillFile(entity, kind);
        if (skill != null) {
          skills.add(skill);
        } else {
          diagnostics.add(SkillDiagnostic(
            type: SkillDiagnosticType.warning,
            message: 'SKILL.md 解析失败或 description 缺失',
            path: entity.path,
          ));
        }
      }
    } catch (error) {
      diagnostics.add(SkillDiagnostic(
        type: SkillDiagnosticType.error,
        message: '扫描目录失败：$error',
        path: rootDirectory.path,
      ));
    }
    return LoadResult(skills: skills, diagnostics: diagnostics);
  }

  Future<Skill?> _loadSkillFile(
    File file,
    SkillSourceKind source,
  ) async {
    try {
      final content = await file.readAsString();
      final frontmatter = SkillFrontmatter.parse(content);
      final name = frontmatter.name ?? '';
      final description = frontmatter.description;
      final validation = SkillValidator.validate(
        name: name,
        description: description,
      );
      if (validation.skip) {
        return null;
      }
      if (validation.errors.isNotEmpty) {
        // 校验失败仍加载（与 pi 一致），由调用方根据 diagnostics 决定是否提示
      }
      return Skill(
        name: name.trim(),
        description: description!.trim(),
        filePath: file.path,
        baseDir: file.parent.path,
        source: source,
        disableModelInvocation: frontmatter.disableModelInvocation,
      );
    } catch (_) {
      return null;
    }
  }

  bool _isIgnoredSegment(String segment) {
    return segment == 'node_modules' || segment == '.git';
  }

  String _basename(String path) {
    final segments = path.split(Platform.pathSeparator);
    return segments.isEmpty ? '' : segments.last;
  }
}
