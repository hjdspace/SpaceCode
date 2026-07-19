/// SKILL.md 的 YAML frontmatter 轻量解析器。
///
/// 仅支持扁平 `key: value` 字段，不支持嵌套/数组/多行字符串。
/// 解析失败时返回空 frontmatter（name/description 为 null）。
class SkillFrontmatter {
  /// frontmatter 的 `name` 字段（未校验）。
  final String? name;

  /// frontmatter 的 `description` 字段（未校验，可能含转义）。
  final String? description;

  /// frontmatter 的 `disable-model-invocation` 字段。
  final bool disableModelInvocation;

  const SkillFrontmatter({
    this.name,
    this.description,
    this.disableModelInvocation = false,
  });

  /// 解析 Markdown 文档的 YAML frontmatter（开头 --- ... --- 之间）。
  static SkillFrontmatter parse(String markdown) {
    final lines = markdown.split('\n');
    if (lines.isEmpty || lines.first.trim() != '---') {
      return const SkillFrontmatter();
    }
    String? name;
    String? description;
    bool disableModelInvocation = false;
    for (var i = 1; i < lines.length; i++) {
      final line = lines[i];
      if (line.trim() == '---') break;
      final colon = line.indexOf(':');
      if (colon <= 0) continue;
      final key = line.substring(0, colon).trim();
      var value = line.substring(colon + 1).trim();
      value = _stripQuotes(value);
      switch (key) {
        case 'name':
          name = value.isEmpty ? null : value;
          break;
        case 'description':
          description = value.isEmpty ? null : value;
          break;
        case 'disable-model-invocation':
          disableModelInvocation = value == 'true';
          break;
      }
    }
    return SkillFrontmatter(
      name: name,
      description: description,
      disableModelInvocation: disableModelInvocation,
    );
  }

  static String _stripQuotes(String value) {
    if (value.length >= 2) {
      final first = value[0];
      final last = value[value.length - 1];
      if ((first == '"' && last == '"') || (first == "'" && last == "'")) {
        return value.substring(1, value.length - 1);
      }
    }
    return value;
  }
}
