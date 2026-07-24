import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/agent_types.dart';
import 'package:spacecode_mobile/core/agent/plugins/workspace_plugin.dart';

void main() {
  late Directory tempDir;
  late WorkspacePlugin plugin;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('workspace_plugin_test_');
    plugin = WorkspacePlugin(tempDir.path);
  });

  tearDown(() async {
    if (await tempDir.exists()) {
      await tempDir.delete(recursive: true);
    }
  });

  AgentCancellationToken token() => AgentCancellationToken();

  group('_WriteFileTool', () {
    test('path 字段应成功写入文件（本地 Agent 历史）', () async {
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'write_file');
      final result = await tool.execute({'path': 'foo.txt', 'content': 'hello'}, token());
      expect(result.isError, isFalse);
      expect(await File('${tempDir.path}/foo.txt').readAsString(), 'hello');
    });

    test('file_path 字段也应成功写入（Claude Code 习惯兼容）', () async {
      // LLM 基于 Claude Code 训练习惯会传 file_path 而非 path，
      // 工具必须兼容，否则 LLM 会反复失败。
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'write_file');
      final result = await tool.execute({'file_path': 'bar.txt', 'content': 'world'}, token());
      expect(result.isError, isFalse,
          reason: 'file_path 应作为 path 的别名被接受');
      expect(await File('${tempDir.path}/bar.txt').readAsString(), 'world');
    });

    test('空 path 应返回明确错误而非静默写入目录', () async {
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'write_file');
      final result = await tool.execute({'content': 'hello'}, token());
      expect(result.isError, isTrue,
          reason: '缺少 path/file_path 时应明确报错，而非试图写入 workspace 根目录');
      expect(result.content, contains('path'));
    });

    test('绝对路径应返回明确错误而非抛 StateError', () async {
      // LLM 习惯传绝对路径，safePath 抛 StateError 会被 agent_loop 兜底
      // 成 "Tool write_file failed: StateError(...)"，LLM 难以理解。
      // 应返回带提示的 isError 结果。
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'write_file');
      final result = await tool.execute(
        {'path': '/tmp/escape.txt', 'content': 'x'},
        token(),
      );
      expect(result.isError, isTrue);
      expect(result.content, contains('workspace'));
    });
  });

  group('_EditFileTool', () {
    Future<void> writeFile(String name, String content) async {
      await File('${tempDir.path}/$name').writeAsString(content);
    }

    test('old_string/new_string 字段应成功编辑（Claude Code 标准）', () async {
      // LLM 基于 Claude Code 训练习惯传 old_string/new_string，
      // 工具必须兼容，否则 LLM 会反复失败。
      await writeFile('foo.dart', 'old line\n');
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'edit_file');
      final result = await tool.execute({
        'path': 'foo.dart',
        'old_string': 'old line',
        'new_string': 'new line',
      }, token());
      expect(result.isError, isFalse,
          reason: 'old_string/new_string 应作为标准字段名被接受');
      expect(await File('${tempDir.path}/foo.dart').readAsString(), 'new line\n');
    });

    test('old_text/new_text 字段也应成功编辑（向后兼容）', () async {
      await writeFile('bar.dart', 'old line\n');
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'edit_file');
      final result = await tool.execute({
        'path': 'bar.dart',
        'old_text': 'old line',
        'new_text': 'new line',
      }, token());
      expect(result.isError, isFalse);
      expect(await File('${tempDir.path}/bar.dart').readAsString(), 'new line\n');
    });

    test('file_path 字段也应成功编辑（Claude Code 习惯兼容）', () async {
      await writeFile('baz.dart', 'old line\n');
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'edit_file');
      final result = await tool.execute({
        'file_path': 'baz.dart',
        'old_string': 'old line',
        'new_string': 'new line',
      }, token());
      expect(result.isError, isFalse,
          reason: 'file_path 应作为 path 的别名被接受');
      expect(await File('${tempDir.path}/baz.dart').readAsString(), 'new line\n');
    });

    test('old_string 未找到时返回明确错误', () async {
      await writeFile('foo.dart', 'existing\n');
      final tool = plugin.createTools().firstWhere((t) => t.definition.name == 'edit_file');
      final result = await tool.execute({
        'path': 'foo.dart',
        'old_string': 'not here',
        'new_string': 'whatever',
      }, token());
      expect(result.isError, isTrue);
      expect(result.content, contains('not found'));
    });
  });
}
