/// 技能名称与描述校验器，规则对齐 Agent Skills spec。
class SkillValidator {
  static const int maxNameLength = 64;
  static const int maxDescriptionLength = 1024;

  static final _namePattern = RegExp(r'^[a-z0-9]+(?:-[a-z0-9]+)*$');

  /// 返回校验错误列表，空列表表示通过。
  static List<String> validateName(String name) {
    final errors = <String>[];
    final trimmed = name.trim();
    if (trimmed.isEmpty) {
      errors.add('name 不能为空');
      return errors;
    }
    if (trimmed.length > maxNameLength) {
      errors.add('name 长度不能超过 $maxNameLength 字符');
    }
    if (!_namePattern.hasMatch(trimmed)) {
      errors.add('name 只能包含小写字母、数字、连字符，不能以连字符开头/结尾，不能有连续连字符');
    }
    return errors;
  }

  /// 返回校验错误列表，空列表表示通过。
  static List<String> validateDescription(String? description) {
    final errors = <String>[];
    if (description == null) {
      errors.add('description 不能为空');
      return errors;
    }
    final trimmed = description.trim();
    if (trimmed.isEmpty) {
      errors.add('description 不能为空');
      return errors;
    }
    if (trimmed.length > maxDescriptionLength) {
      errors.add('description 长度不能超过 $maxDescriptionLength 字符');
    }
    return errors;
  }

  /// 综合校验：返回 (isValid, errors)。
  /// description 完全缺失（null）视为致命错误，调用方应跳过该技能。
  static ({bool skip, List<String> errors}) validate({
    required String name,
    required String? description,
  }) {
    final nameErrors = validateName(name);
    final descErrors = validateDescription(description);
    final allErrors = [...nameErrors, ...descErrors];
    return (skip: description == null, errors: allErrors);
  }
}
