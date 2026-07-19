/// 技能系统核心数据类型。
library;

/// 技能来源类型。
///
/// - [bundled]：随 APK/IPA 打包的内置技能（assets/skills/）
/// - [user]：用户在应用文档目录创建的技能（~/.spacecode/skills/）
/// - [github]：从 GitHub 仓库安装的技能（~/.spacecode/skills/github/<repo>/）
/// - [desktopSync]：桌面端 SpaceCode 通过 WS 推送同步的技能
enum SkillSourceKind { bundled, user, github, desktopSync }

/// 诊断类型。
enum SkillDiagnosticType { warning, error, collision }

/// 技能加载诊断信息（非致命错误，用于在 UI 展示加载异常）。
class SkillDiagnostic {
  final SkillDiagnosticType type;
  final String message;
  final String? path;

  const SkillDiagnostic({
    required this.type,
    required this.message,
    this.path,
  });
}

/// 一个已加载的技能。
class Skill {
  /// 校验后的小写名（仅 a-z/0-9/连字符）。
  final String name;

  /// frontmatter 的 description，trim 后非空，≤1024 字符。
  final String description;

  /// SKILL.md 的绝对路径（bundled 技能为 assets 虚拟路径）。
  final String filePath;

  /// 技能目录（filePath 的 dirname）。
  final String baseDir;

  /// 技能来源。
  final SkillSourceKind source;

  /// frontmatter 的 `disable-model-invocation` 字段。
  /// 为 true 时该技能不进入系统提示词的 available_skills 列表，
  /// 但仍可通过 /skill:name 命令显式调用。
  final bool disableModelInvocation;

  const Skill({
    required this.name,
    required this.description,
    required this.filePath,
    required this.baseDir,
    required this.source,
    this.disableModelInvocation = false,
  });
}

/// SkillSource.load 与 SkillLoader.load 的返回值。
class LoadResult {
  final List<Skill> skills;
  final List<SkillDiagnostic> diagnostics;

  const LoadResult({
    required this.skills,
    required this.diagnostics,
  });

  static const empty = LoadResult(skills: [], diagnostics: []);
}
