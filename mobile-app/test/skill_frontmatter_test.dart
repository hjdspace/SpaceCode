import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/skill_frontmatter.dart';

void main() {
  test('parses standard frontmatter', () {
    const markdown = '''---
name: code-review
description: 审查代码变更。
disable-model-invocation: true
---

# 代码审查
''';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.name, 'code-review');
    expect(fm.description, '审查代码变更。');
    expect(fm.disableModelInvocation, true);
  });

  test('returns defaults when frontmatter is missing', () {
    const markdown = '# No frontmatter here';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.name, isNull);
    expect(fm.description, isNull);
    expect(fm.disableModelInvocation, false);
  });

  test('ignores unknown fields', () {
    const markdown = '''---
name: foo
unknown-field: value
description: bar
''';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.name, 'foo');
    expect(fm.description, 'bar');
  });

  test('handles quoted descriptions', () {
    const markdown = '''---
name: foo
description: "A skill: with colon"
---
''';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.description, 'A skill: with colon');
  });

  test('parses boolean false for disable-model-invocation', () {
    const markdown = '''---
name: foo
disable-model-invocation: false
---
''';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.disableModelInvocation, false);
  });

  test('returns empty frontmatter when delimiter missing', () {
    const markdown = 'name: foo\ndescription: bar';
    final fm = SkillFrontmatter.parse(markdown);
    expect(fm.name, isNull);
    expect(fm.description, isNull);
  });
}
