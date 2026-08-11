import 'package:flutter/material.dart';

import '../models/tool_call.dart';
import 'tool_call_card_views.dart';
import 'tool_call_data.dart';

/// 工具调用卡片。
///
/// 根据 [ToolCall.toolName] 归一化为 [ToolKind]，分发到对应的专业视图：
/// - [TerminalCardView]：run_command / Bash —— 终端风格
/// - [ReadFileCardView]：read_file / Read —— 语法高亮
/// - [WriteFileCardView]：write_file / Write —— 绿色新增样式
/// - [EditFileCardView]：edit_file / Edit / str_replace_editor —— diff 展示
/// - [ListFilesCardView]：list_files / LS / Glob
/// - [SearchCardView]：grep_files / Grep —— 匹配高亮
/// - [WebSearchCardView]：web_search —— 结果列表
/// - [WebFetchCardView]：fetch_url —— Markdown 内容
/// - [GitCardView]：git_* —— 原始输出 / diff
/// - [SkillCardView]：read_skill
/// - [GenericCardView]：兜底
class ToolCallCard extends StatefulWidget {
  final ToolCall toolCall;

  const ToolCallCard({
    super.key,
    required this.toolCall,
  });

  @override
  State<ToolCallCard> createState() => _ToolCallCardState();
}

class _ToolCallCardState extends State<ToolCallCard> {
  bool _isExpanded = false;

  void _toggle() => setState(() => _isExpanded = !_isExpanded);

  @override
  Widget build(BuildContext context) {
    final data = ToolCallData.from(widget.toolCall);
    final isExpanded = _isExpanded;
    final onToggle = _toggle;

    switch (data.kind) {
      case ToolKind.terminal:
        return TerminalCardView(
          data: data,
          isExpanded: isExpanded,
          onToggle: onToggle,
        );
      case ToolKind.readFile:
        return ReadFileCardView(
          data: data,
          isExpanded: isExpanded,
          onToggle: onToggle,
        );
      case ToolKind.writeFile:
        return WriteFileCardView(
          data: data,
          isExpanded: isExpanded,
          onToggle: onToggle,
        );
      case ToolKind.editFile:
        return EditFileCardView(
          data: data,
          isExpanded: isExpanded,
          onToggle: onToggle,
        );
      case ToolKind.listFiles:
        return ListFilesCardView(
          data: data,
          isExpanded: isExpanded,
          onToggle: onToggle,
        );
      case ToolKind.search:
        return SearchCardView(
          data: data,
          isExpanded: isExpanded,
          onToggle: onToggle,
        );
      case ToolKind.webSearch:
        return WebSearchCardView(
          data: data,
          isExpanded: isExpanded,
          onToggle: onToggle,
        );
      case ToolKind.webFetch:
        return WebFetchCardView(
          data: data,
          isExpanded: isExpanded,
          onToggle: onToggle,
        );
      case ToolKind.git:
        return GitCardView(
          data: data,
          isExpanded: isExpanded,
          onToggle: onToggle,
        );
      case ToolKind.skill:
        return SkillCardView(
          data: data,
          isExpanded: isExpanded,
          onToggle: onToggle,
        );
      case ToolKind.generic:
        return GenericCardView(
          data: data,
          isExpanded: isExpanded,
          onToggle: onToggle,
        );
    }
  }
}
