/// Unified diff 文本解析器。
///
/// 把 `diff -u` 或 `git diff` 风格的 unified diff 文本解析成结构化的
/// [DiffHunk] 列表，用于 ToolCallCard 中 EDIT 卡片的可视化渲染。
///
/// 支持的格式：
/// ```
/// @@ -10,7 +10,8 @@ context info
///  unchanged line
/// -removed line
/// +added line
///  unchanged line
/// ```
///
/// 不识别的行（如 `diff --git`、`index abc..def`、`--- a/file`、`+++ b/file`、
/// `\ No newline at end of file`）会被忽略或归入"前导段落"。
library;

/// 单行 diff 内容。
enum DiffLineType { context, add, del }

class DiffLine {
  final DiffLineType type;
  final int? oldLineNum;
  final int? newLineNum;
  final String content;

  const DiffLine({
    required this.type,
    this.oldLineNum,
    this.newLineNum,
    required this.content,
  });
}

class DiffHunk {
  final int oldStart;
  final int oldCount;
  final int newStart;
  final int newCount;
  final String headerContext;
  final List<DiffLine> lines;

  const DiffHunk({
    required this.oldStart,
    required this.oldCount,
    required this.newStart,
    required this.newCount,
    required this.headerContext,
    required this.lines,
  });

  /// +N -M 统计（新增 N 行，删除 M 行）。
  ({int added, int removed}) get stats {
    var added = 0;
    var removed = 0;
    for (final line in lines) {
      if (line.type == DiffLineType.add) added++;
      if (line.type == DiffLineType.del) removed++;
    }
    return (added: added, removed: removed);
  }
}

class DiffParser {
  DiffParser._();

  /// 解析 [text] 为 [DiffHunk] 列表。
  ///
  /// 不会抛异常：任何解析失败都会被静默忽略，返回已成功解析的部分。
  /// 若文本不包含任何 hunk 头，返回空列表。
  static List<DiffHunk> parse(String text) {
    final lines = text.split('\n');
    final hunks = <DiffHunk>[];

    int? oldStart;
    int? oldCount;
    int? newStart;
    int? newCount;
    String headerContext = '';
    final collected = <DiffLine>[];
    int oldLineCursor = 0;
    int newLineCursor = 0;

    void flushHunk() {
      if (oldStart != null && newStart != null && collected.isNotEmpty) {
        hunks.add(DiffHunk(
          oldStart: oldStart!,
          oldCount: oldCount ?? 1,
          newStart: newStart!,
          newCount: newCount ?? 1,
          headerContext: headerContext,
          lines: List.unmodifiable(collected),
        ));
      }
      oldStart = null;
      oldCount = null;
      newStart = null;
      newCount = null;
      headerContext = '';
      collected.clear();
    }

    for (final raw in lines) {
      if (raw.startsWith('@@')) {
        flushHunk();
        final parsed = _parseHunkHeader(raw);
        if (parsed != null) {
          oldStart = parsed.oldStart;
          oldCount = parsed.oldCount;
          newStart = parsed.newStart;
          newCount = parsed.newCount;
          headerContext = parsed.context;
          oldLineCursor = oldStart!;
          newLineCursor = newStart!;
        }
        continue;
      }
      if (oldStart == null) {
        // 还没进入第一个 hunk，忽略前导行（diff/idx/---/+++）
        continue;
      }
      if (raw.isEmpty) {
        // 空行视作上下文行（部分 diff 工具会保留空行）
        collected.add(DiffLine(
          type: DiffLineType.context,
          oldLineNum: oldLineCursor,
          newLineNum: newLineCursor,
          content: '',
        ));
        oldLineCursor++;
        newLineCursor++;
        continue;
      }
      final sign = raw[0];
      final content = raw.substring(1);
      switch (sign) {
        case '+':
          collected.add(DiffLine(
            type: DiffLineType.add,
            oldLineNum: null,
            newLineNum: newLineCursor,
            content: content,
          ));
          newLineCursor++;
          break;
        case '-':
          collected.add(DiffLine(
            type: DiffLineType.del,
            oldLineNum: oldLineCursor,
            newLineNum: null,
            content: content,
          ));
          oldLineCursor++;
          break;
        case ' ':
          collected.add(DiffLine(
            type: DiffLineType.context,
            oldLineNum: oldLineCursor,
            newLineNum: newLineCursor,
            content: content,
          ));
          oldLineCursor++;
          newLineCursor++;
          break;
        case '\\':
          // `\ No newline at end of file` 等注解，忽略
          break;
        default:
          // 其他字符：当作上下文行保留（容错）
          collected.add(DiffLine(
            type: DiffLineType.context,
            oldLineNum: oldLineCursor,
            newLineNum: newLineCursor,
            content: raw,
          ));
          oldLineCursor++;
          newLineCursor++;
      }
    }
    flushHunk();
    return List.unmodifiable(hunks);
  }

  /// 解析 hunk 头 `@@ -10,7 +10,8 @@ context`。
  static _HunkHeader? _parseHunkHeader(String line) {
    final regex = RegExp(
      r'^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@\s*(.*)$',
    );
    final match = regex.firstMatch(line);
    if (match == null) return null;
    return _HunkHeader(
      oldStart: int.parse(match.group(1)!),
      oldCount: match.group(2) != null ? int.parse(match.group(2)!) : 1,
      newStart: int.parse(match.group(3)!),
      newCount: match.group(4) != null ? int.parse(match.group(4)!) : 1,
      context: match.group(5) ?? '',
    );
  }

  /// 当没有真正的 unified diff、只有 old_string/new_string 对时，
  /// 构造一个简化的"伪 diff"用于渲染。
  ///
  /// 把 [oldString] 的每行渲染为删除行，[newString] 的每行渲染为新增行，
  /// 适合 Claude `edit` 工具的 `old_string`/`new_string` 输入。
  static List<DiffHunk> fromOldNewStrings({
    required String oldString,
    required String newString,
    int startLine = 1,
  }) {
    final oldLines = oldString.split('\n');
    final newLines = newString.split('\n');
    final lines = <DiffLine>[];
    var oldCursor = startLine;
    var newCursor = startLine;
    for (final line in oldLines) {
      lines.add(DiffLine(
        type: DiffLineType.del,
        oldLineNum: oldCursor,
        newLineNum: null,
        content: line,
      ));
      oldCursor++;
    }
    for (final line in newLines) {
      lines.add(DiffLine(
        type: DiffLineType.add,
        oldLineNum: null,
        newLineNum: newCursor,
        content: line,
      ));
      newCursor++;
    }
    return [
      DiffHunk(
        oldStart: startLine,
        oldCount: oldLines.length,
        newStart: startLine,
        newCount: newLines.length,
        headerContext: 'old_string → new_string',
        lines: List.unmodifiable(lines),
      ),
    ];
  }
}

class _HunkHeader {
  final int oldStart;
  final int oldCount;
  final int newStart;
  final int newCount;
  final String context;
  const _HunkHeader({
    required this.oldStart,
    required this.oldCount,
    required this.newStart,
    required this.newCount,
    required this.context,
  });
}
