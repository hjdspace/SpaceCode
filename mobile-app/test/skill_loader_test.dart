import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/skills/skill_loader.dart';
import 'package:spacecode_mobile/core/skills/skill_types.dart';
import 'package:spacecode_mobile/core/skills/sources/user_skill_source.dart';

void main() {
  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('skill-loader-test-');
  });

  tearDown(() async {
    if (await tempDir.exists()) await tempDir.delete(recursive: true);
  });

  Future<File> writeSkill(String relativePath, String content) async {
    final file = File('${tempDir.path}/$relativePath');
    await file.parent.create(recursive: true);
    await file.writeAsString(content);
    return file;
  }

  test('UserSkillSource loads skills from filesystem', () async {
    await writeSkill('code-review/SKILL.md', '''---
name: code-review
description: 审查代码
---

# 内容
''');
    await writeSkill('commit-message/SKILL.md', '''---
name: commit-message
description: 生成提交信息
---

# 内容
''');

    final source = UserSkillSource(tempDir);
    final result = await source.load();

    expect(result.skills.length, 2);
    expect(result.skills.map((s) => s.name).toSet(),
        {'code-review', 'commit-message'});
    expect(result.skills.every((s) => s.source == SkillSourceKind.user), true);
  });

  test('skips SKILL.md without description', () async {
    await writeSkill('no-desc/SKILL.md', '''---
name: no-desc
---

# 内容
''');

    final source = UserSkillSource(tempDir);
    final result = await source.load();

    expect(result.skills, isEmpty);
    expect(result.diagnostics, isNotEmpty);
  });

  test('SkillLoader dedupes by priority', () async {
    final highDir =
        await Directory.systemTemp.createTemp('skill-loader-high-');
    final lowDir = await Directory.systemTemp.createTemp('skill-loader-low-');
    try {
      await File('${highDir.path}/SKILL.md').writeAsString('''---
name: dup-skill
description: 高优先级
---
''');
      await File('${lowDir.path}/SKILL.md').writeAsString('''---
name: dup-skill
description: 低优先级
---
''');

      final high = _StubSource(SkillSourceKind.bundled, [
        Skill(
          name: 'dup-skill',
          description: '高优先级',
          filePath: '${highDir.path}/SKILL.md',
          baseDir: highDir.path,
          source: SkillSourceKind.bundled,
        ),
      ]);
      final low = _StubSource(SkillSourceKind.desktopSync, [
        Skill(
          name: 'dup-skill',
          description: '低优先级',
          filePath: '${lowDir.path}/SKILL.md',
          baseDir: lowDir.path,
          source: SkillSourceKind.desktopSync,
        ),
      ]);
      final loader = SkillLoader([high, low]);
      final result = await loader.load();

      expect(result.skills.length, 1);
      expect(result.skills.first.description, '高优先级');
      expect(
        result.diagnostics.any((d) => d.type == SkillDiagnosticType.collision),
        true,
      );
    } finally {
      await highDir.delete(recursive: true);
      await lowDir.delete(recursive: true);
    }
  });

  test('empty directory returns empty result', () async {
    final source = UserSkillSource(tempDir);
    final result = await source.load();
    expect(result.skills, isEmpty);
    expect(result.diagnostics, isEmpty);
  });
}

class _StubSource implements SkillSource {
  @override
  final SkillSourceKind kind;
  final List<Skill> skills;

  _StubSource(this.kind, this.skills);

  @override
  Future<LoadResult> load() async =>
      LoadResult(skills: skills, diagnostics: const []);
}
