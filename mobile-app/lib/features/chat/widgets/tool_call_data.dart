/// 把 [ToolCall] 解析成结构化的 [ToolCallData]，
/// 供 `ToolCallCard` 按 [ToolKind] 分发到具体子 widget 渲染。
///
/// 设计要点：
/// - 同时支持 SpaceCode 本地 agent 的工具名（`read_file`/`write_file`/`edit_file`/
///   `run_command`/`list_files`/`grep_files`/`web_search`/`fetch_url`/`git_*`/`read_skill`）
///   和 Claude Code 风格的工具名（`Read`/`Write`/`Edit`/`Bash`/`LS`/`Glob`/`Grep`/
///   `WebSearch`/`WebFetch`/`str_replace_editor`）。
/// - input 可能是 JSON 字符串（本地 agent 的 `jsonEncode(arguments)`），
///   也可能是字符串化的对象（桌面端 `data['input'].toString()`），统一用 `_parseJson` 容错。
/// - 解析失败不抛异常，回退到 [ToolKind.generic]，由通用卡片兜底渲染。
library;

import 'dart:convert';

import '../models/tool_call.dart';

/// 工具卡片视觉分类。
enum ToolKind {
  /// Shell / 终端命令（`run_command`、`Bash`、`bash`）。
  terminal,

  /// 读文件（`read_file`、`Read`）。
  readFile,

  /// 写文件 / 新建文件（`write_file`、`Write`）。
  writeFile,

  /// 编辑文件（`edit_file`、`Edit`、`str_replace_editor`）。
  editFile,

  /// 列目录（`list_files`、`LS`、`Glob`）。
  listFiles,

  /// 内容搜索（`grep_files`、`Grep`）。
  search,

  /// 网络搜索（`web_search`、`WebSearch`）。
  webSearch,

  /// 网页抓取（`fetch_url`、`WebFetch`）。
  webFetch,

  /// Git 操作（`git_status`/`git_log`/`git_diff`/...）。
  git,

  /// 技能加载（`read_skill`）。
  skill,

  /// 未识别的工具，走通用卡片。
  generic,
}

/// 从 [ToolCall] 解析出的结构化数据。
///
/// 不同 [kind] 使用不同字段，未使用的字段为 null。
class ToolCallData {
  final ToolKind kind;

  /// 原始工具名（未归一化），用于 UI 展示。
  final String toolName;

  /// 归一化后的工具标签（用于卡片头部的副标题）。
  final String label;

  /// 原始输入字符串（保留用于"展开详情"等场景）。
  final String rawInput;

  /// 原始输出字符串。
  final String? rawOutput;

  final ToolCallStatus status;

  /// 解析后的完整输入 Map（可能为空 Map）。
  final Map<String, dynamic> parsedInput;

  // ---- 通用字段 ----

  /// 涉及的文件路径（read/write/edit/list/grep 等均可能填充）。
  final String? filePath;

  // ---- terminal ----

  /// 执行的 shell 命令。
  final String? command;

  /// 工作目录（可选）。
  final String? workDir;

  // ---- readFile / writeFile ----

  /// 文件内容（read 时是输出，write 时是输入）。
  final String? fileContent;

  /// 推断的语言标签（如 'dart'、'python'、'json'），用于语法高亮。
  final String? language;

  // ---- editFile ----

  /// edit_file 的 old_string。
  final String? oldString;

  /// edit_file 的 new_string。
  final String? newString;

  // ---- search / grep ----

  /// 搜索关键词 / 正则。
  final String? searchPattern;

  /// 搜索路径（可选）。
  final String? searchPath;

  // ---- webSearch ----

  /// web_search 的查询词。
  final String? searchQuery;

  // ---- webFetch ----

  /// fetch_url 的目标 URL。
  final String? fetchUrl;

  // ---- skill ----

  /// read_skill 的技能名。
  final String? skillName;

  const ToolCallData({
    required this.kind,
    required this.toolName,
    required this.label,
    required this.rawInput,
    required this.rawOutput,
    required this.status,
    required this.parsedInput,
    this.filePath,
    this.command,
    this.workDir,
    this.fileContent,
    this.language,
    this.oldString,
    this.newString,
    this.searchPattern,
    this.searchPath,
    this.searchQuery,
    this.fetchUrl,
    this.skillName,
  });

  /// 从 [ToolCall] 解析出 [ToolCallData]。永不抛异常。
  factory ToolCallData.from(ToolCall call) {
    final kind = _classify(call.toolName);
    final input = _parseJson(call.input);
    final output = call.output;
    final label = _labelFor(kind, call.toolName);

    String? filePath = input['path'] as String? ?? input['file_path'] as String?;
    String? command = input['command'] as String? ?? input['cmd'] as String?;
    String? workDir = input['cwd'] as String? ?? input['workdir'] as String?;
    String? oldString = input['old_string'] as String? ??
        input['oldString'] as String? ??
        input['old_text'] as String?;
    String? newString = input['new_string'] as String? ??
        input['newString'] as String? ??
        input['new_text'] as String?;
    String? searchPattern = input['pattern'] as String? ??
        input['query'] as String? ??
        input['search'] as String?;
    String? searchPath = input['path'] as String? ?? input['directory'] as String?;
    String? searchQuery = input['query'] as String? ?? input['q'] as String?;
    String? fetchUrl = input['url'] as String?;
    String? skillName = input['name'] as String? ?? input['skill'] as String?;

    // readFile: 内容来自 output
    // writeFile: 内容来自 input['content']
    String? fileContent;
    switch (kind) {
      case ToolKind.readFile:
        fileContent = output;
        break;
      case ToolKind.writeFile:
        fileContent = input['content'] as String?;
        break;
      case ToolKind.editFile:
        // 编辑卡片渲染 diff，不需要单一 content
        fileContent = null;
        break;
      default:
        fileContent = null;
    }

    final language = _inferLanguage(filePath, kind, call.toolName);

    return ToolCallData(
      kind: kind,
      toolName: call.toolName,
      label: label,
      rawInput: call.input,
      rawOutput: output,
      status: call.status,
      parsedInput: input,
      filePath: filePath,
      command: command,
      workDir: workDir,
      fileContent: fileContent,
      language: language,
      oldString: oldString,
      newString: newString,
      searchPattern: searchPattern,
      searchPath: searchPath,
      searchQuery: searchQuery,
      fetchUrl: fetchUrl,
      skillName: skillName,
    );
  }

  /// 根据 [toolName] 归一化分类。
  static ToolKind _classify(String toolName) {
    final lower = toolName.toLowerCase();
    // str_replace_editor 是 Claude Code 的编辑工具别名
    if (lower == 'edit' ||
        lower == 'edit_file' ||
        lower == 'str_replace_editor' ||
        lower == 'str_replace') {
      return ToolKind.editFile;
    }
    if (lower == 'read' || lower == 'read_file') return ToolKind.readFile;
    if (lower == 'write' || lower == 'write_file') return ToolKind.writeFile;
    if (lower == 'bash' || lower == 'run_command' || lower == 'shell') {
      return ToolKind.terminal;
    }
    if (lower == 'ls' ||
        lower == 'list_files' ||
        lower == 'glob' ||
        lower == 'list_dir') {
      return ToolKind.listFiles;
    }
    if (lower == 'grep' ||
        lower == 'grep_files' ||
        lower == 'search_files' ||
        lower == 'ripgrep') {
      return ToolKind.search;
    }
    if (lower == 'websearch' || lower == 'web_search') return ToolKind.webSearch;
    if (lower == 'webfetch' || lower == 'fetch_url') return ToolKind.webFetch;
    if (lower == 'read_skill' || lower == 'skill') return ToolKind.skill;
    if (lower.startsWith('git_') || lower == 'git') return ToolKind.git;
    return ToolKind.generic;
  }

  /// 卡片头部副标题。
  static String _labelFor(ToolKind kind, String toolName) {
    switch (kind) {
      case ToolKind.terminal:
        return 'Shell';
      case ToolKind.readFile:
        return 'Read';
      case ToolKind.writeFile:
        return 'Write';
      case ToolKind.editFile:
        return 'Edit';
      case ToolKind.listFiles:
        return 'List';
      case ToolKind.search:
        return 'Grep';
      case ToolKind.webSearch:
        return 'Search';
      case ToolKind.webFetch:
        return 'Fetch';
      case ToolKind.git:
        return 'Git';
      case ToolKind.skill:
        return 'Skill';
      case ToolKind.generic:
        return toolName;
    }
  }

  /// 根据文件扩展名 / 工具类型推断语言。
  static String? _inferLanguage(String? filePath, ToolKind kind, String toolName) {
    if (filePath != null) {
      final dot = filePath.lastIndexOf('.');
      if (dot >= 0 && dot < filePath.length - 1) {
        final ext = filePath.substring(dot + 1).toLowerCase();
        const map = <String, String>{
          'dart': 'dart',
          'py': 'python',
          'pyw': 'python',
          'js': 'javascript',
          'mjs': 'javascript',
          'cjs': 'javascript',
          'ts': 'typescript',
          'tsx': 'typescript',
          'jsx': 'javascript',
          'json': 'json',
          'yaml': 'yaml',
          'yml': 'yaml',
          'md': 'markdown',
          'markdown': 'markdown',
          'html': 'html',
          'htm': 'html',
          'css': 'css',
          'scss': 'scss',
          'sass': 'sass',
          'less': 'less',
          'xml': 'xml',
          'svg': 'xml',
          'go': 'go',
          'rs': 'rust',
          'java': 'java',
          'kt': 'kotlin',
          'kts': 'kotlin',
          'swift': 'swift',
          'c': 'c',
          'h': 'c',
          'cpp': 'cpp',
          'cc': 'cpp',
          'cxx': 'cpp',
          'hpp': 'cpp',
          'hxx': 'cpp',
          'cs': 'cs',
          'rb': 'ruby',
          'php': 'php',
          'sh': 'bash',
          'bash': 'bash',
          'zsh': 'bash',
          'fish': 'bash',
          'ps1': 'powershell',
          'bat': 'bat',
          'cmd': 'bat',
          'sql': 'sql',
          'toml': 'toml',
          'ini': 'ini',
          'cfg': 'ini',
          'conf': 'ini',
          'gradle': 'gradle',
          'lua': 'lua',
          'r': 'r',
          'scala': 'scala',
          'pl': 'perl',
          'pm': 'perl',
        };
        final lang = map[ext];
        if (lang != null) return lang;
      }
    }
    // 没有扩展名时按工具类型给默认值
    switch (kind) {
      case ToolKind.terminal:
        return 'bash';
      case ToolKind.webSearch:
      case ToolKind.webFetch:
        return 'json';
      case ToolKind.git:
        return 'plaintext';
      default:
        return null;
    }
  }

  /// 把 input 字符串解析成 Map。失败时返回空 Map。
  static Map<String, dynamic> _parseJson(String input) {
    if (input.isEmpty) return const {};
    // 桌面端推送的 input 可能是 toString 形式（如 "{a: 1}"），先尝试严格 JSON
    try {
      final decoded = jsonDecode(input);
      if (decoded is Map<String, dynamic>) return decoded;
      if (decoded is Map) return decoded.cast<String, dynamic>();
    } catch (_) {
      // fall through
    }
    return const {};
  }
}
