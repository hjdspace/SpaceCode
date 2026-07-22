import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;

import '../agent_model.dart';
import '../agent_plugin.dart';
import '../agent_types.dart';
import '../../skills/skill_registry.dart';
import '../../skills/skill_types.dart';

/// 把技能能力注入 AgentSession 的插件。
///
/// 职责：
/// - 在系统提示词末尾追加 <available_skills> XML 列出可用技能
/// - 注册 `read_skill` 工具，让模型按需加载 SKILL.md 全文
class SkillPlugin extends AgentPlugin {
  final SkillRegistryState registry;

  SkillPlugin(this.registry);

  @override
  List<AgentTool> createTools() => [_ReadSkillTool(registry)];

  @override
  String buildSystemPromptSuffix() {
    final visible =
        registry.enabledSkills.where((s) => !s.disableModelInvocation).toList();
    if (visible.isEmpty) return '';
    return _formatSkillsXml(visible);
  }

  String _formatSkillsXml(List<Skill> skills) {
    final buffer = StringBuffer('\n<available_skills>\n');
    for (final skill in skills) {
      buffer.write('  <skill>\n');
      buffer.write('    <name>${_escapeXml(skill.name)}</name>\n');
      buffer.write(
          '    <description>${_escapeXml(skill.description)}</description>\n');
      buffer.write('    <location>${_escapeXml(skill.filePath)}</location>\n');
      buffer.write('  </skill>\n');
    }
    buffer.write('</available_skills>\n');
    buffer.write(
        '\nUse the read_skill tool to load a skill\'s full instructions '
        'when the task matches its description.\n');
    return buffer.toString();
  }

  String _escapeXml(String text) {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
  }
}

class _ReadSkillTool extends AgentTool {
  final SkillRegistryState registry;

  _ReadSkillTool(this.registry);

  @override
  AgentToolDefinition get definition => const AgentToolDefinition(
        name: 'read_skill',
        description: "Load a skill's full SKILL.md instructions by name. "
            "Use this when the task matches a skill's description.",
        inputSchema: {
          'type': 'object',
          'properties': {
            'skill_name': {'type': 'string'}
          },
          'required': ['skill_name'],
        },
      );

  @override
  Future<AgentToolResult> execute(
    Map<String, dynamic> arguments,
    AgentCancellationToken cancellationToken,
  ) async {
    final name = arguments['skill_name'] as String?;
    if (name == null || name.isEmpty) {
      return const AgentToolResult(
        content: 'skill_name is required',
        isError: true,
      );
    }
    final skill = registry.find(name);
    if (skill == null) {
      return AgentToolResult(
        content: 'Skill "$name" not found',
        isError: true,
      );
    }
    try {
      final content = skill.source == SkillSourceKind.bundled
          ? await rootBundle.loadString(skill.filePath)
          : await File(skill.filePath).readAsString();
      return AgentToolResult(content: content);
    } catch (error) {
      return AgentToolResult(
        content: 'Failed to read skill: $error',
        isError: true,
      );
    }
  }
}
