/// 本地技能库索引数据模型。
///
/// index.json 的序列化/反序列化。不参与 Agent 加载（仅用于库浏览 UI）。
library;

/// 本地库中的单个技能元数据。
class LocalLibrarySkill {
  /// 技能名（与 SKILL.md frontmatter 的 name 一致）。
  final String name;

  /// 技能描述（与 frontmatter 的 description 一致）。
  final String description;

  /// 分类（frontmatter 的 category 字段，默认 'other'）。
  final String category;

  /// SKILL.md 在 assets 中的相对路径。
  final String assetPath;

  const LocalLibrarySkill({
    required this.name,
    required this.description,
    required this.category,
    required this.assetPath,
  });

  factory LocalLibrarySkill.fromJson(Map<String, dynamic> json) {
    return LocalLibrarySkill(
      name: json['name'] as String,
      description: json['description'] as String? ?? '',
      category: json['category'] as String? ?? 'other',
      assetPath: json['assetPath'] as String,
    );
  }
}

/// 本地技能库索引。
class LocalLibraryIndex {
  /// 索引格式版本。
  final int version;

  /// 索引生成时间（UTC ISO 8601）。
  final DateTime generatedAt;

  /// 所有库技能列表。
  final List<LocalLibrarySkill> skills;

  const LocalLibraryIndex({
    required this.version,
    required this.generatedAt,
    required this.skills,
  });

  /// 空索引（用于加载失败的降级）。
  /// 注意：Dart 不允许 const DateTime，因此使用 static getter。
  static LocalLibraryIndex get empty => LocalLibraryIndex(
        version: 0,
        generatedAt: DateTime.fromMillisecondsSinceEpoch(0),
        skills: const [],
      );

  factory LocalLibraryIndex.fromJson(Map<String, dynamic> json) {
    return LocalLibraryIndex(
      version: json['version'] as int? ?? 1,
      generatedAt:
          DateTime.tryParse(json['generatedAt'] as String? ?? '') ??
              DateTime.now(),
      skills: (json['skills'] as List? ?? [])
          .map((e) => LocalLibrarySkill.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

/// 本地库分类常量（与桌面端 src/stores/localSkills.ts 的 CATEGORIES 一致）。
class LocalLibraryCategories {
  static const all = 'all';
  static const development = 'development';
  static const frontendDesign = 'frontend-design';
  static const office = 'office';
  static const aiMl = 'ai-ml';
  static const devops = 'devops';
  static const creative = 'creative';
  static const communication = 'communication';
  static const other = 'other';

  static const allValues = [
    all,
    development,
    frontendDesign,
    office,
    aiMl,
    devops,
    creative,
    communication,
    other,
  ];

  LocalLibraryCategories._();
}
