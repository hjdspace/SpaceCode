import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/plugins/skill_plugin.dart';
import 'package:spacecode_mobile/core/skills/skill_registry.dart';
import 'package:spacecode_mobile/core/skills/skill_types.dart';

void main() {
  const skillA = Skill(
    name: 'code-review',
    description: '审查代码',
    filePath: '/tmp/does-not-exist/SKILL.md',
    baseDir: '/tmp/does-not-exist',
    source: SkillSourceKind.user,
  );

  test('buildSystemPromptSuffix returns empty when no skills', () {
    final plugin = SkillPlugin(SkillRegistryState.empty);
    expect(plugin.buildSystemPromptSuffix(), isEmpty);
  });

  test('buildSystemPromptSuffix formats skills as XML', () {
    const state = SkillRegistryState(
      skills: [skillA],
      diagnostics: [],
      loading: false,
      disabledNames: {},
    );
    final plugin = SkillPlugin(state);
    final suffix = plugin.buildSystemPromptSuffix();

    expect(suffix, contains('<available_skills>'));
    expect(suffix, contains('</available_skills>'));
    expect(suffix, contains('<name>code-review</name>'));
    expect(suffix, contains('<description>审查代码</description>'));
    expect(suffix, contains('<location>/tmp/does-not-exist/SKILL.md</location>'));
  });

  test('buildSystemPromptSuffix excludes disabled skills', () {
    const state = SkillRegistryState(
      skills: [skillA],
      diagnostics: [],
      loading: false,
      disabledNames: {'code-review'},
    );
    final plugin = SkillPlugin(state);
    expect(plugin.buildSystemPromptSuffix(), isEmpty);
  });

  test('buildSystemPromptSuffix excludes disableModelInvocation skills', () {
    const skill = Skill(
      name: 'hidden',
      description: '隐藏技能',
      filePath: '/tmp/x/SKILL.md',
      baseDir: '/tmp/x',
      source: SkillSourceKind.user,
      disableModelInvocation: true,
    );
    const state = SkillRegistryState(
      skills: [skill],
      diagnostics: [],
      loading: false,
      disabledNames: {},
    );
    final plugin = SkillPlugin(state);
    expect(plugin.buildSystemPromptSuffix(), isEmpty);
  });

  test('read_skill tool returns error for unknown skill', () async {
    const state = SkillRegistryState(
      skills: [skillA],
      diagnostics: [],
      loading: false,
      disabledNames: {},
    );
    final plugin = SkillPlugin(state);
    final tools = plugin.createTools();
    final readSkill = tools.firstWhere(
      (t) => t.definition.name == 'read_skill',
    );
    final result = await readSkill.execute(
      {'skill_name': 'missing'},
      AgentCancellationToken(),
    );
    expect(result.isError, true);
    expect(result.content, contains('not found'));
  });

  test('read_skill tool reads file content', () async {
    // 通过 FilesystemSkillSource 的实际文件读取需要文件系统；
    // 此处用一个虚拟 Skill（filePath 指向临时文件）验证读取逻辑。
    final tmpFile = await _createTempSkillFile('content-here');
    final skill = Skill(
      name: 'temp',
      description: 'temp',
      filePath: tmpFile.path,
      baseDir: tmpFile.parent.path,
      source: SkillSourceKind.user,
    );
    final state = SkillRegistryState(
      skills: [skill],
      diagnostics: const [],
      loading: false,
      disabledNames: const {},
    );
    final plugin = SkillPlugin(state);
    final tools = plugin.createTools();
    final readSkill = tools.firstWhere(
      (t) => t.definition.name == 'read_skill',
    );
    final result = await readSkill.execute(
      {'skill_name': 'temp'},
      AgentCancellationToken(),
    );
    expect(result.isError, false);
    expect(result.content, 'content-here');
    await tmpFile.delete();
  });
}

Future<File> _createTempSkillFile(String content) async {
  final dir = await Directory.systemTemp.createTemp('skill-plugin-test-');
  final file = File('${dir.path}/SKILL.md');
  await file.writeAsString(content);
  return file;
}
