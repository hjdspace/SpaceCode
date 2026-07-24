/// 工具卡片的具体视图集合。
///
/// [ToolCallCard] 根据 [ToolCallData.kind] 分发到这里的对应视图。
/// 每个视图都是独立的 StatelessWidget，接收 [ToolCallData] + [isExpanded] +
/// [onToggle]，自行管理头部与展开内容。
library;

import 'dart:convert';

import 'package:flutter/material.dart';

import '../../../core/i18n/strings.dart';
import '../../../core/theme/code_theme.dart';
import '../models/tool_call.dart';
import 'code_block.dart';
import 'diff_parser.dart';
import 'tool_call_data.dart';

// ============================================================
// 语义色辅助
// ============================================================

class _SemanticColors {
  final Color success;
  final Color warning;
  final Color error;

  const _SemanticColors({
    required this.success,
    required this.warning,
    required this.error,
  });

  /// 按 scaffoldBackgroundColor 精确匹配 4 套主题的语义色。
  static _SemanticColors of(BuildContext context) {
    final bg = Theme.of(context).scaffoldBackgroundColor;
    if (bg == const Color(0xfffaf9f5) || bg == const Color(0xff181715)) {
      // anthropic / anthropicDark
      return const _SemanticColors(
        success: Color(0xff5db872),
        warning: Color(0xffd4a017),
        error: Color(0xffc64545),
      );
    }
    if (bg == const Color(0xff0d0d0d)) {
      // dark
      return const _SemanticColors(
        success: Color(0xff22c55e),
        warning: Color(0xfff59e0b),
        error: Color(0xffef4444),
      );
    }
    // light（含自定义回退）
    return const _SemanticColors(
      success: Color(0xff059669),
      warning: Color(0xffd97706),
      error: Color(0xffdc2626),
    );
  }
}

Color _statusColor(BuildContext context, ToolCallStatus status) {
  final semantic = _SemanticColors.of(context);
  switch (status) {
    case ToolCallStatus.running:
      return semantic.warning;
    case ToolCallStatus.completed:
      return semantic.success;
    case ToolCallStatus.error:
      return semantic.error;
  }
}

String _statusLabel(ToolCallStatus status) {
  switch (status) {
    case ToolCallStatus.running:
      return I18n.t('chat.tool.statusRunning');
    case ToolCallStatus.completed:
      return I18n.t('chat.tool.statusCompleted');
    case ToolCallStatus.error:
      return I18n.t('chat.tool.statusError');
  }
}

// ============================================================
// 共享头部
// ============================================================

class ToolCardHeader extends StatelessWidget {
  final ToolCallData data;
  final IconData icon;
  final Color? iconColor;
  final String title;
  final String? subtitle;
  final Color? subtitleColor;
  final bool isExpanded;
  final VoidCallback onToggle;

  const ToolCardHeader({
    super.key,
    required this.data,
    required this.icon,
    this.iconColor,
    required this.title,
    this.subtitle,
    this.subtitleColor,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final statusColor = _statusColor(context, data.status);
    final statusLabel = _statusLabel(data.status);

    return InkWell(
      onTap: onToggle,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: statusColor,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 8),
            Icon(icon, size: 16, color: iconColor ?? statusColor),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      fontFamily: 'monospace',
                    ),
                  ),
                  if (subtitle != null && subtitle!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: subtitleColor ??
                            theme.colorScheme.onSurface.withValues(alpha: 0.5),
                        fontSize: 11,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                statusLabel,
                style: TextStyle(
                  color: statusColor,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: 4),
            Icon(
              isExpanded ? Icons.expand_less_rounded : Icons.expand_more_rounded,
              size: 18,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================
// 卡片外壳（共享圆角 + 边框）
// ============================================================

class ToolCardShell extends StatelessWidget {
  final ToolCallData data;
  final Widget header;
  final Widget? body;

  const ToolCardShell({
    super.key,
    required this.data,
    required this.header,
    this.body,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: theme.cardColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          header,
          if (body != null) body!,
        ],
      ),
    );
  }
}

// ============================================================
// TerminalCardView — 终端风格
// ============================================================

class TerminalCardView extends StatelessWidget {
  final ToolCallData data;
  final bool isExpanded;
  final VoidCallback onToggle;

  const TerminalCardView({
    super.key,
    required this.data,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final command = data.command ?? data.rawInput;
    final parsed = _parseOutput(data.rawOutput);
    final stdout = parsed.stdout;
    final stderr = parsed.stderr;
    final exitCode = parsed.exitCode;
    final durationMs = parsed.durationMs;

    final subtitle = StringBuffer()
      ..write('\$ ')
      ..write(command);
    if (durationMs != null) {
      subtitle
        ..write('  ·  ')
        ..write(I18n.t('chat.tool.duration', {'ms': durationMs.toString()}));
    }

    return ToolCardShell(
      data: data,
      header: ToolCardHeader(
        data: data,
        icon: Icons.terminal_rounded,
        iconColor: _statusColor(context, data.status),
        title: subtitle.toString(),
        isExpanded: isExpanded,
        onToggle: onToggle,
      ),
      body: isExpanded ? _TerminalBody(data: data, stdout: stdout, stderr: stderr, exitCode: exitCode, command: command) : null,
    );
  }

  _ParsedShell _parseOutput(String? output) {
    if (output == null || output.isEmpty) {
      return const _ParsedShell();
    }
    try {
      final decoded = jsonDecode(output);
      if (decoded is Map<String, dynamic>) {
        return _ParsedShell(
          stdout: decoded['stdout'] as String? ?? decoded['partial_stdout'] as String? ?? '',
          stderr: decoded['stderr'] as String? ?? decoded['error'] as String? ?? '',
          exitCode: decoded['exit_code'] as int?,
          durationMs: decoded['duration_ms'] as int?,
        );
      }
    } catch (_) {
      // 非 JSON，当作纯 stdout
      return _ParsedShell(stdout: output);
    }
    return const _ParsedShell();
  }
}

class _ParsedShell {
  final String stdout;
  final String stderr;
  final int? exitCode;
  final int? durationMs;
  const _ParsedShell({
    this.stdout = '',
    this.stderr = '',
    this.exitCode,
    this.durationMs,
  });
}

class _TerminalBody extends StatelessWidget {
  final ToolCallData data;
  final String stdout;
  final String stderr;
  final int? exitCode;
  final String command;

  const _TerminalBody({
    required this.data,
    required this.stdout,
    required this.stderr,
    required this.exitCode,
    required this.command,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final semantic = _SemanticColors.of(context);
    final isError = data.status == ToolCallStatus.error ||
        (exitCode != null && exitCode != 0);

    final bg = theme.brightness == Brightness.dark
        ? const Color(0xff0a0a0a)
        : const Color(0xff1a1a1a);
    final promptColor = isError ? semantic.error : semantic.success;
    const fgColor = Color(0xffe4e4e7);

    return Padding(
      padding: const EdgeInsets.fromLTRB(0, 0, 0, 8),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 320),
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 8),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: promptColor.withValues(alpha: 0.3),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // 命令行
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color: fgColor.withValues(alpha: 0.08),
                    ),
                  ),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '\$ ',
                      style: TextStyle(
                        color: promptColor,
                        fontSize: 12,
                        fontFamily: 'monospace',
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Expanded(
                      child: Text(
                        command,
                        style: const TextStyle(
                          color: fgColor,
                          fontSize: 12,
                          fontFamily: 'monospace',
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              // 输出
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (stdout.isNotEmpty)
                        SelectableText(
                          stdout,
                          style: TextStyle(
                            color: fgColor.withValues(alpha: 0.9),
                            fontSize: 12,
                            fontFamily: 'monospace',
                            height: 1.5,
                          ),
                        ),
                      if (stderr.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        SelectableText(
                          stderr,
                          style: TextStyle(
                            color: semantic.error,
                            fontSize: 12,
                            fontFamily: 'monospace',
                            height: 1.5,
                          ),
                        ),
                      ],
                      if (stdout.isEmpty && stderr.isEmpty)
                        Text(
                          I18n.t('chat.tool.noOutput'),
                          style: TextStyle(
                            color: fgColor.withValues(alpha: 0.4),
                            fontSize: 12,
                            fontStyle: FontStyle.italic,
                            fontFamily: 'monospace',
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              // 退出码
              if (exitCode != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    border: Border(
                      top: BorderSide(
                        color: fgColor.withValues(alpha: 0.08),
                      ),
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        exitCode == 0
                            ? Icons.check_circle_rounded
                            : Icons.error_outline_rounded,
                        size: 12,
                        color: exitCode == 0 ? semantic.success : semantic.error,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        I18n.t('chat.tool.exitCode',
                            {'code': exitCode.toString()}),
                        style: TextStyle(
                          color: exitCode == 0
                              ? semantic.success
                              : semantic.error,
                          fontSize: 11,
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// ============================================================
// ReadFileCardView — 语法高亮
// ============================================================

class ReadFileCardView extends StatelessWidget {
  final ToolCallData data;
  final bool isExpanded;
  final VoidCallback onToggle;

  const ReadFileCardView({
    super.key,
    required this.data,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final filePath = data.filePath ?? data.toolName;
    // read_file 输出格式 "行号: 内容"，去除行号前缀
    final content = _stripLineNumbers(data.fileContent ?? data.rawOutput ?? '');

    return ToolCardShell(
      data: data,
      header: ToolCardHeader(
        data: data,
        icon: Icons.description_rounded,
        title: filePath,
        subtitle: data.language,
        isExpanded: isExpanded,
        onToggle: onToggle,
      ),
      body: isExpanded
          ? Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: content.isEmpty
                  ? _EmptyHint(text: I18n.t('chat.tool.noContent'))
                  : CodeBlock(
                      code: content,
                      language: data.language,
                      maxHeight: 360,
                    ),
            )
          : null,
    );
  }

  /// 去除 `read_file` 输出的 `行号: ` 前缀。
  static String _stripLineNumbers(String text) {
    if (text.isEmpty) return text;
    final lines = text.split('\n');
    final regex = RegExp(r'^\s*\d+:\s?');
    final stripped = lines.map((line) {
      // 仅当行首匹配 "数字: " 时才去除（避免误伤正常代码）
      if (regex.hasMatch(line)) {
        return line.replaceFirst(regex, '');
      }
      return line;
    }).join('\n');
    return stripped;
  }
}

// ============================================================
// WriteFileCardView — 绿色新增样式
// ============================================================

class WriteFileCardView extends StatelessWidget {
  final ToolCallData data;
  final bool isExpanded;
  final VoidCallback onToggle;

  const WriteFileCardView({
    super.key,
    required this.data,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final filePath = data.filePath ?? data.toolName;
    final content = data.fileContent ?? '';
    final lineCount = content.isEmpty ? 0 : '\n'.allMatches(content).length + 1;
    final semantic = _SemanticColors.of(context);

    return ToolCardShell(
      data: data,
      header: ToolCardHeader(
        data: data,
        icon: Icons.note_add_rounded,
        iconColor: semantic.success,
        title: filePath,
        subtitle: I18n.t('chat.tool.linesAdded', {'count': lineCount.toString()}),
        subtitleColor: semantic.success,
        isExpanded: isExpanded,
        onToggle: onToggle,
      ),
      body: isExpanded
          ? Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: content.isEmpty
                  ? _EmptyHint(text: I18n.t('chat.tool.noContent'))
                  : _AddedCodeView(
                      code: content,
                      language: data.language,
                    ),
            )
          : null,
    );
  }
}

/// 绿色新增样式的代码视图：每行左侧带 `+` 标记，背景泛绿。
class _AddedCodeView extends StatelessWidget {
  final String code;
  final String? language;

  const _AddedCodeView({required this.code, this.language});

  @override
  Widget build(BuildContext context) {
    final semantic = _SemanticColors.of(context);
    final ct = CodeTheme.of(context);
    final addBg = semantic.success.withValues(alpha: 0.08);
    final addFg = semantic.success;

    final lines = code.split('\n');

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: ct.bg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: semantic.success.withValues(alpha: 0.3),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 360),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < lines.length; i++)
                Container(
                  color: addBg,
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 0),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '+',
                        style: TextStyle(
                          color: addFg,
                          fontSize: 13,
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w700,
                          height: 1.5,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          lines[i],
                          style: TextStyle(
                            color: ct.fg,
                            fontSize: 13,
                            fontFamily: 'monospace',
                            height: 1.5,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// ============================================================
// EditFileCardView — diff 展示
// ============================================================

class EditFileCardView extends StatelessWidget {
  final ToolCallData data;
  final bool isExpanded;
  final VoidCallback onToggle;

  const EditFileCardView({
    super.key,
    required this.data,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final filePath = data.filePath ?? data.toolName;
    final semantic = _SemanticColors.of(context);

    // 生成 diff
    final hunks = _buildHunks(data);

    // 统计
    int added = 0;
    int removed = 0;
    for (final hunk in hunks) {
      final s = hunk.stats;
      added += s.added;
      removed += s.removed;
    }
    final subtitle = StringBuffer()
      ..write(I18n.t('chat.tool.linesAdded', {'count': added.toString()}))
      ..write('  ')
      ..write(I18n.t('chat.tool.linesRemoved', {'count': removed.toString()}));

    return ToolCardShell(
      data: data,
      header: ToolCardHeader(
        data: data,
        icon: Icons.edit_rounded,
        iconColor: semantic.warning,
        title: filePath,
        subtitle: subtitle.toString(),
        subtitleColor: semantic.warning,
        isExpanded: isExpanded,
        onToggle: onToggle,
      ),
      body: isExpanded
          ? Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: hunks.isEmpty
                  ? _EmptyHint(text: I18n.t('chat.tool.emptyDiff'))
                  : _DiffView(hunks: hunks),
            )
          : null,
    );
  }

  List<DiffHunk> _buildHunks(ToolCallData data) {
    final oldStr = data.oldString;
    final newStr = data.newString;
    if (oldStr == null && newStr == null) {
      // 尝试把 output 当作 unified diff
      final output = data.rawOutput ?? '';
      if (output.contains('@@')) {
        return DiffParser.parse(output);
      }
      return const [];
    }
    return DiffParser.fromOldNewStrings(
      oldString: oldStr ?? '',
      newString: newStr ?? '',
    );
  }
}

/// diff 渲染视图：删除行红底，新增行绿底。
class _DiffView extends StatelessWidget {
  final List<DiffHunk> hunks;
  const _DiffView({required this.hunks});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final semantic = _SemanticColors.of(context);
    final ct = CodeTheme.of(context);

    final delBg = semantic.error.withValues(alpha: 0.10);
    final delFg = semantic.error;
    final addBg = semantic.success.withValues(alpha: 0.10);
    final addFg = semantic.success;
    final ctxBg = theme.cardColor;
    final ctxFg = theme.colorScheme.onSurface.withValues(alpha: 0.7);
    final lineNumColor = theme.colorScheme.onSurface.withValues(alpha: 0.3);

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: ct.bg,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 400),
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final hunk in hunks) ...[
                // hunk header
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 6),
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.05),
                  child: Text(
                    '@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@',
                    style: TextStyle(
                      color: lineNumColor,
                      fontSize: 11,
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
                for (final line in hunk.lines)
                  _DiffLineRow(
                    line: line,
                    delBg: delBg,
                    delFg: delFg,
                    addBg: addBg,
                    addFg: addFg,
                    ctxBg: ctxBg,
                    ctxFg: ctxFg,
                    lineNumColor: lineNumColor,
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _DiffLineRow extends StatelessWidget {
  final DiffLine line;
  final Color delBg;
  final Color delFg;
  final Color addBg;
  final Color addFg;
  final Color ctxBg;
  final Color ctxFg;
  final Color lineNumColor;

  const _DiffLineRow({
    required this.line,
    required this.delBg,
    required this.delFg,
    required this.addBg,
    required this.addFg,
    required this.ctxBg,
    required this.ctxFg,
    required this.lineNumColor,
  });

  @override
  Widget build(BuildContext context) {
    final String sign;
    final Color bg;
    final Color fg;
    switch (line.type) {
      case DiffLineType.add:
        sign = '+';
        bg = addBg;
        fg = addFg;
      case DiffLineType.del:
        sign = '-';
        bg = delBg;
        fg = delFg;
      case DiffLineType.context:
        sign = ' ';
        bg = ctxBg;
        fg = ctxFg;
    }

    final oldNum = line.oldLineNum?.toString() ?? '';
    final newNum = line.newLineNum?.toString() ?? '';

    return Container(
      color: bg,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 旧行号
          SizedBox(
            width: 28,
            child: Text(
              oldNum,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: lineNumColor,
                fontSize: 11,
                fontFamily: 'monospace',
                height: 1.5,
              ),
            ),
          ),
          const SizedBox(width: 4),
          // 新行号
          SizedBox(
            width: 28,
            child: Text(
              newNum,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: lineNumColor,
                fontSize: 11,
                fontFamily: 'monospace',
                height: 1.5,
              ),
            ),
          ),
          const SizedBox(width: 8),
          // 符号
          Text(
            sign,
            style: TextStyle(
              color: fg,
              fontSize: 13,
              fontFamily: 'monospace',
              fontWeight: FontWeight.w700,
              height: 1.5,
            ),
          ),
          const SizedBox(width: 8),
          // 内容
          Expanded(
            child: Text(
              line.content,
              style: TextStyle(
                color: fg,
                fontSize: 13,
                fontFamily: 'monospace',
                height: 1.5,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ============================================================
// ListFilesCardView — 文件列表
// ============================================================

class ListFilesCardView extends StatelessWidget {
  final ToolCallData data;
  final bool isExpanded;
  final VoidCallback onToggle;

  const ListFilesCardView({
    super.key,
    required this.data,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final path = data.filePath ?? data.searchPath ?? '.';
    final entries = _parseEntries(data.rawOutput);

    return ToolCardShell(
      data: data,
      header: ToolCardHeader(
        data: data,
        icon: Icons.folder_open_rounded,
        title: path,
        subtitle: entries.isEmpty ? null : '${entries.length} items',
        isExpanded: isExpanded,
        onToggle: onToggle,
      ),
      body: isExpanded
          ? Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: entries.isEmpty
                  ? _EmptyHint(text: I18n.t('chat.tool.noOutput'))
                  : _FileListView(entries: entries),
            )
          : null,
    );
  }

  List<_FileEntry> _parseEntries(String? output) {
    if (output == null || output.isEmpty) return const [];
    // list_files 输出每行一个条目，目录以 / 结尾
    final lines = output.split('\n').where((l) => l.trim().isNotEmpty);
    return lines.map((line) {
      final trimmed = line.trim();
      final isDir = trimmed.endsWith('/');
      return _FileEntry(
        name: isDir ? trimmed.substring(0, trimmed.length - 1) : trimmed,
        isDirectory: isDir,
      );
    }).toList();
  }
}

class _FileEntry {
  final String name;
  final bool isDirectory;
  const _FileEntry({required this.name, required this.isDirectory});
}

class _FileListView extends StatelessWidget {
  final List<_FileEntry> entries;
  const _FileListView({required this.entries});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 320),
        child: ListView.separated(
          shrinkWrap: true,
          itemCount: entries.length,
          separatorBuilder: (_, __) => Divider(
            height: 1,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.05),
          ),
          itemBuilder: (context, index) {
            final entry = entries[index];
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              child: Row(
                children: [
                  Icon(
                    entry.isDirectory
                        ? Icons.folder_rounded
                        : Icons.insert_drive_file_outlined,
                    size: 16,
                    color: entry.isDirectory
                        ? theme.colorScheme.primary
                        : theme.colorScheme.onSurface.withValues(alpha: 0.5),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      entry.name,
                      style: TextStyle(
                        color: theme.colorScheme.onSurface,
                        fontSize: 13,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

// ============================================================
// SearchCardView — grep 结果
// ============================================================

class SearchCardView extends StatelessWidget {
  final ToolCallData data;
  final bool isExpanded;
  final VoidCallback onToggle;

  const SearchCardView({
    super.key,
    required this.data,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final pattern = data.searchPattern ?? '';
    final matches = _parseMatches(data.rawOutput);

    return ToolCardShell(
      data: data,
      header: ToolCardHeader(
        data: data,
        icon: Icons.search_rounded,
        title: pattern.isEmpty ? data.toolName : '/$pattern/',
        subtitle: matches.isEmpty ? null : '${matches.length} matches',
        isExpanded: isExpanded,
        onToggle: onToggle,
      ),
      body: isExpanded
          ? Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: matches.isEmpty
                  ? _EmptyHint(text: I18n.t('chat.tool.noMatches'))
                  : _MatchListView(matches: matches, pattern: pattern),
            )
          : null,
    );
  }

  List<_GrepMatch> _parseMatches(String? output) {
    if (output == null || output.isEmpty) return const [];
    final lines = output.split('\n').where((l) => l.trim().isNotEmpty);
    final matches = <_GrepMatch>[];
    // 常见格式："path:lineNum:content" 或 "path:content"
    final regex = RegExp(r'^(.+?):(\d+):(.*)$');
    for (final line in lines) {
      final m = regex.firstMatch(line);
      if (m != null) {
        matches.add(_GrepMatch(
          path: m.group(1)!,
          lineNum: int.tryParse(m.group(2)!) ?? 0,
          content: m.group(3) ?? '',
        ));
      } else {
        // 无法解析，整行作为 content
        matches.add(_GrepMatch(path: '', lineNum: 0, content: line));
      }
    }
    return matches;
  }
}

class _GrepMatch {
  final String path;
  final int lineNum;
  final String content;
  const _GrepMatch({required this.path, required this.lineNum, required this.content});
}

class _MatchListView extends StatelessWidget {
  final List<_GrepMatch> matches;
  final String pattern;
  const _MatchListView({required this.matches, required this.pattern});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final semantic = _SemanticColors.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 360),
        child: ListView.separated(
          shrinkWrap: true,
          itemCount: matches.length,
          separatorBuilder: (_, __) => Divider(
            height: 1,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.05),
          ),
          itemBuilder: (context, index) {
            final m = matches[index];
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (m.path.isNotEmpty)
                    Row(
                      children: [
                        Icon(
                          Icons.code_rounded,
                          size: 12,
                          color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            m.lineNum > 0 ? '${m.path}:${m.lineNum}' : m.path,
                            style: TextStyle(
                              color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                              fontSize: 11,
                              fontFamily: 'monospace',
                            ),
                          ),
                        ),
                      ],
                    ),
                  if (m.path.isNotEmpty) const SizedBox(height: 4),
                  _HighlightedText(
                    text: m.content,
                    highlight: pattern,
                    baseColor: theme.colorScheme.onSurface,
                    highlightBg: semantic.warning.withValues(alpha: 0.3),
                    highlightFg: theme.colorScheme.onSurface,
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _HighlightedText extends StatelessWidget {
  final String text;
  final String highlight;
  final Color baseColor;
  final Color highlightBg;
  final Color highlightFg;

  const _HighlightedText({
    required this.text,
    required this.highlight,
    required this.baseColor,
    required this.highlightBg,
    required this.highlightFg,
  });

  @override
  Widget build(BuildContext context) {
    if (highlight.isEmpty) {
      return Text(
        text,
        style: TextStyle(
          color: baseColor,
          fontSize: 12,
          fontFamily: 'monospace',
          height: 1.4,
        ),
      );
    }
    final spans = <TextSpan>[];
    var remaining = text;
    while (remaining.isNotEmpty) {
      final idx = remaining.toLowerCase().indexOf(highlight.toLowerCase());
      if (idx < 0) {
        spans.add(TextSpan(text: remaining));
        break;
      }
      if (idx > 0) {
        spans.add(TextSpan(text: remaining.substring(0, idx)));
      }
      spans.add(TextSpan(
        text: remaining.substring(idx, idx + highlight.length),
        style: TextStyle(backgroundColor: highlightBg, color: highlightFg),
      ));
      remaining = remaining.substring(idx + highlight.length);
    }
    return RichText(
      text: TextSpan(
        style: TextStyle(
          color: baseColor,
          fontSize: 12,
          fontFamily: 'monospace',
          height: 1.4,
        ),
        children: spans,
      ),
    );
  }
}

// ============================================================
// WebSearchCardView — 搜索结果
// ============================================================

class WebSearchCardView extends StatelessWidget {
  final ToolCallData data;
  final bool isExpanded;
  final VoidCallback onToggle;

  const WebSearchCardView({
    super.key,
    required this.data,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final query = data.searchQuery ?? '';
    final results = _parseResults(data.rawOutput);

    return ToolCardShell(
      data: data,
      header: ToolCardHeader(
        data: data,
        icon: Icons.travel_explore_rounded,
        title: query.isEmpty ? data.toolName : query,
        subtitle: results.isEmpty ? null : '${results.length} results',
        isExpanded: isExpanded,
        onToggle: onToggle,
      ),
      body: isExpanded
          ? Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: results.isEmpty
                  ? _EmptyHint(text: I18n.t('chat.tool.noResults'))
                  : _SearchResultListView(results: results),
            )
          : null,
    );
  }

  List<_SearchResult> _parseResults(String? output) {
    if (output == null || output.isEmpty) return const [];
    try {
      final decoded = jsonDecode(output);
      if (decoded is Map<String, dynamic>) {
        final list = decoded['results'];
        if (list is List) {
          return list
              .whereType<Map<String, dynamic>>()
              .map((item) => _SearchResult(
                    title: item['title'] as String? ?? '',
                    url: item['url'] as String? ?? '',
                    snippet: item['snippet'] as String? ?? '',
                  ))
              .toList();
        }
      }
    } catch (_) {
      // ignore
    }
    return const [];
  }
}

class _SearchResult {
  final String title;
  final String url;
  final String snippet;
  const _SearchResult({required this.title, required this.url, required this.snippet});
}

class _SearchResultListView extends StatelessWidget {
  final List<_SearchResult> results;
  const _SearchResultListView({required this.results});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 400),
      child: ListView.separated(
        shrinkWrap: true,
        itemCount: results.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, index) {
          final r = results[index];
          return Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.colorScheme.surface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.08),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  r.title.isEmpty ? r.url : r.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: theme.colorScheme.onSurface,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 4),
                if (r.url.isNotEmpty)
                  Row(
                    children: [
                      Icon(
                        Icons.link_rounded,
                        size: 11,
                        color: theme.colorScheme.primary.withValues(alpha: 0.6),
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          r.url,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: theme.colorScheme.primary.withValues(alpha: 0.8),
                            fontSize: 11,
                            fontFamily: 'monospace',
                          ),
                        ),
                      ),
                    ],
                  ),
                if (r.snippet.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    r.snippet,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                      fontSize: 12,
                      height: 1.4,
                    ),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

// ============================================================
// WebFetchCardView — 网页抓取
// ============================================================

class WebFetchCardView extends StatelessWidget {
  final ToolCallData data;
  final bool isExpanded;
  final VoidCallback onToggle;

  const WebFetchCardView({
    super.key,
    required this.data,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final url = data.fetchUrl ?? '';
    final content = _parseContent(data.rawOutput);

    return ToolCardShell(
      data: data,
      header: ToolCardHeader(
        data: data,
        icon: Icons.language_rounded,
        title: url.isEmpty ? data.toolName : url,
        isExpanded: isExpanded,
        onToggle: onToggle,
      ),
      body: isExpanded
          ? Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: content.isEmpty
                  ? _EmptyHint(text: I18n.t('chat.tool.noContent'))
                  : _MarkdownContentView(content: content),
            )
          : null,
    );
  }

  String _parseContent(String? output) {
    if (output == null || output.isEmpty) return '';
    try {
      final decoded = jsonDecode(output);
      if (decoded is Map<String, dynamic>) {
        return decoded['content'] as String? ?? '';
      }
    } catch (_) {
      return output;
    }
    return '';
  }
}

class _MarkdownContentView extends StatelessWidget {
  final String content;
  const _MarkdownContentView({required this.content});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 400),
        child: SingleChildScrollView(
          child: SelectableText(
            content,
            style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.85),
              fontSize: 13,
              height: 1.5,
            ),
          ),
        ),
      ),
    );
  }
}

// ============================================================
// GitCardView — Git 输出
// ============================================================

class GitCardView extends StatelessWidget {
  final ToolCallData data;
  final bool isExpanded;
  final VoidCallback onToggle;

  const GitCardView({
    super.key,
    required this.data,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    // git_diff 的输出是 unified diff，用 diff 视图渲染
    final output = data.rawOutput ?? '';
    final isDiff = output.contains('@@') && output.contains('\n+++');

    return ToolCardShell(
      data: data,
      header: ToolCardHeader(
        data: data,
        icon: Icons.merge_rounded,
        title: data.toolName,
        isExpanded: isExpanded,
        onToggle: onToggle,
      ),
      body: isExpanded
          ? Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: output.isEmpty
                  ? _EmptyHint(text: I18n.t('chat.tool.noOutput'))
                  : isDiff
                      ? _DiffView(hunks: DiffParser.parse(output))
                      : _PlainOutputView(output: output),
            )
          : null,
    );
  }
}

class _PlainOutputView extends StatelessWidget {
  final String output;
  const _PlainOutputView({required this.output});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
        ),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 360),
        child: SingleChildScrollView(
          child: SelectableText(
            output,
            style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.85),
              fontSize: 12,
              fontFamily: 'monospace',
              height: 1.5,
            ),
          ),
        ),
      ),
    );
  }
}

// ============================================================
// SkillCardView — 技能加载
// ============================================================

class SkillCardView extends StatelessWidget {
  final ToolCallData data;
  final bool isExpanded;
  final VoidCallback onToggle;

  const SkillCardView({
    super.key,
    required this.data,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final skillName = data.skillName ?? data.toolName;
    final content = data.rawOutput ?? '';

    return ToolCardShell(
      data: data,
      header: ToolCardHeader(
        data: data,
        icon: Icons.auto_awesome_outlined,
        iconColor: Theme.of(context).colorScheme.tertiary,
        title: skillName,
        isExpanded: isExpanded,
        onToggle: onToggle,
      ),
      body: isExpanded
          ? Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: content.isEmpty
                  ? _EmptyHint(text: I18n.t('chat.tool.noContent'))
                  : _MarkdownContentView(content: content),
            )
          : null,
    );
  }
}

// ============================================================
// GenericCardView — 通用兜底
// ============================================================

class GenericCardView extends StatelessWidget {
  final ToolCallData data;
  final bool isExpanded;
  final VoidCallback onToggle;

  const GenericCardView({
    super.key,
    required this.data,
    required this.isExpanded,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return ToolCardShell(
      data: data,
      header: ToolCardHeader(
        data: data,
        icon: Icons.extension_outlined,
        title: data.toolName,
        isExpanded: isExpanded,
        onToggle: onToggle,
      ),
      body: isExpanded
          ? Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: _GenericBody(data: data),
            )
          : null,
    );
  }
}

class _GenericBody extends StatelessWidget {
  final ToolCallData data;
  const _GenericBody({required this.data});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (data.rawInput.isNotEmpty) ...[
          _SectionLabel(label: I18n.t('chat.tool.input')),
          _MonoBlock(text: data.rawInput),
        ],
        if (data.rawOutput != null && data.rawOutput!.isNotEmpty) ...[
          const SizedBox(height: 8),
          _SectionLabel(label: I18n.t('chat.tool.output')),
          _MonoBlock(text: data.rawOutput!),
        ],
        if (data.rawInput.isEmpty &&
            (data.rawOutput == null || data.rawOutput!.isEmpty))
          _EmptyHint(text: I18n.t('chat.tool.noOutput')),
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String label;
  const _SectionLabel({required this.label});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Text(
        label,
        style: TextStyle(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _MonoBlock extends StatelessWidget {
  final String text;
  const _MonoBlock({required this.text});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final truncated = text.length > 2000;
    final display = truncated ? '${text.substring(0, 2000)}...' : text;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(6),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 300),
        child: SingleChildScrollView(
          child: SelectableText(
            display,
            style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
              fontSize: 12,
              fontFamily: 'monospace',
              height: 1.4,
            ),
          ),
        ),
      ),
    );
  }
}

// ============================================================
// 空状态提示
// ============================================================

class _EmptyHint extends StatelessWidget {
  final String text;
  const _EmptyHint({required this.text});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
      child: Text(
        text,
        style: TextStyle(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
          fontSize: 12,
          fontStyle: FontStyle.italic,
        ),
      ),
    );
  }
}
