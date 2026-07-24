import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/chat/models/tool_call.dart';
import 'package:spacecode_mobile/features/chat/widgets/tool_call_data.dart';

void main() {
  group('ToolCallData.editFile 字段提取', () {
    test('old_string/new_string 应正确提取（Claude Code 标准字段名）', () {
      final call = ToolCall(
        id: 'tc1',
        toolName: 'edit_file',
        input:
            '{"file_path":"foo.dart","old_string":"a","new_string":"b"}',
        output: 'Edited foo.dart',
        status: ToolCallStatus.completed,
      );
      final data = ToolCallData.from(call);
      expect(data.kind, ToolKind.editFile);
      expect(data.filePath, 'foo.dart');
      expect(data.oldString, 'a');
      expect(data.newString, 'b');
    });

    test('old_text/new_text 也应正确提取（本地 Agent 历史字段名兼容）', () {
      // 本地 Agent 的 workspace_plugin 曾用 old_text/new_text，
      // 历史会话持久化数据可能仍是该字段名，UI 必须能渲染。
      final call = ToolCall(
        id: 'tc2',
        toolName: 'edit_file',
        input:
            '{"path":"foo.dart","old_text":"a","new_text":"b"}',
        output: 'Edited foo.dart',
        status: ToolCallStatus.completed,
      );
      final data = ToolCallData.from(call);
      expect(data.kind, ToolKind.editFile);
      expect(data.oldString, 'a',
          reason: 'old_text 应作为 old_string 的别名被提取');
      expect(data.newString, 'b',
          reason: 'new_text 应作为 new_string 的别名被提取');
    });

    test('oldString/newString 驼峰命名也应正确提取', () {
      final call = ToolCall(
        id: 'tc3',
        toolName: 'Edit',
        input:
            '{"file_path":"foo.dart","oldString":"a","newString":"b"}',
        output: 'The file foo.dart has been updated successfully.',
        status: ToolCallStatus.completed,
      );
      final data = ToolCallData.from(call);
      expect(data.kind, ToolKind.editFile);
      expect(data.oldString, 'a');
      expect(data.newString, 'b');
    });
  });

  group('ToolCallData.writeFile 字段提取', () {
    test('file_path 字段应正确提取（Claude Code 标准）', () {
      final call = ToolCall(
        id: 'tc4',
        toolName: 'write_file',
        input: '{"file_path":"foo.dart","content":"hello"}',
        output: 'Wrote foo.dart',
        status: ToolCallStatus.completed,
      );
      final data = ToolCallData.from(call);
      expect(data.kind, ToolKind.writeFile);
      expect(data.filePath, 'foo.dart');
      expect(data.fileContent, 'hello');
    });

    test('path 字段也应正确提取（本地 Agent 历史）', () {
      final call = ToolCall(
        id: 'tc5',
        toolName: 'Write',
        input: '{"path":"foo.dart","content":"hello"}',
        output: 'Wrote foo.dart',
        status: ToolCallStatus.completed,
      );
      final data = ToolCallData.from(call);
      expect(data.kind, ToolKind.writeFile);
      expect(data.filePath, 'foo.dart');
      expect(data.fileContent, 'hello');
    });
  });

  group('ToolCallData 桌面协同模式 Map input 容错', () {
    test('input 为 Dart Map.toString() 格式时不应崩溃', () {
      // 桌面协同模式历史 bug：data['input'] 是 Map，经 .toString() 后
      // 得到 {file_path: foo.dart, old_string: a, new_string: b}（非合法 JSON）。
      // _parseJson 应优雅回退，不应抛异常。
      final call = ToolCall(
        id: 'tc6',
        toolName: 'edit_file',
        input: '{file_path: foo.dart, old_string: a, new_string: b}',
        output: 'Edited foo.dart',
        status: ToolCallStatus.completed,
      );
      // 不应抛异常，字段优雅降级为 null
      final data = ToolCallData.from(call);
      expect(data.kind, ToolKind.editFile);
      // 非合法 JSON 时字段为 null（不崩溃），由后续修复保证 input 序列化正确
    });
  });
}
