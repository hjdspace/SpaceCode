/// 命令危险等级分类。
///
/// 用于 [PermissionInterceptorPlugin] 在工具调用前判断是否需要询问用户。
/// 分类规则：
/// 1. 结构化工具（git_*, run_python 等）直接查表
/// 2. `run_command` 走 shell 命令解析（首词 + 危险模式正则）
/// 3. 未知工具保守判定为 [DangerLevel.write]
enum DangerLevel { read, write, dangerous }

class CommandClassifier {
  CommandClassifier._();

  /// 按工具名 + 参数判定危险等级。
  static DangerLevel classify(String toolName, Map<String, dynamic> args) {
    // 1. 结构化工具直接查表
    if (_toolDangerTable.containsKey(toolName)) {
      return _toolDangerTable[toolName]!;
    }
    // 2. run_command 走命令解析
    if (toolName == 'run_command') {
      return _classifyShell(args['command'] as String? ?? '');
    }
    // 3. 未知工具保守判定
    return DangerLevel.write;
  }

  /// 结构化工具危险等级表。
  static const _toolDangerTable = <String, DangerLevel>{
    // 现有 WorkspacePlugin 工具
    'list_files': DangerLevel.read,
    'read_file': DangerLevel.read,
    'grep_files': DangerLevel.read,
    'read_skill': DangerLevel.read,
    'write_file': DangerLevel.write,
    'edit_file': DangerLevel.write,
    // Git 读
    'git_status': DangerLevel.read,
    'git_log': DangerLevel.read,
    'git_diff': DangerLevel.read,
    'git_branch_list': DangerLevel.read,
    'git_show': DangerLevel.read,
    // Git 写
    'git_add': DangerLevel.write,
    'git_commit': DangerLevel.write,
    'git_branch_create': DangerLevel.write,
    'git_branch_switch': DangerLevel.write,
    // Git 危险
    'git_push': DangerLevel.dangerous,
    'git_pull': DangerLevel.dangerous,
    'git_reset': DangerLevel.dangerous,
    // Python
    'run_python': DangerLevel.write,
    'run_python_file': DangerLevel.write,
  };

  /// 解析 shell 命令字符串判定危险等级。
  ///
  /// 规则：
  /// - 命中任一危险正则 → [DangerLevel.dangerous]
  /// - 首词在读命令白名单 → [DangerLevel.read]
  /// - 首词在写命令白名单 → [DangerLevel.write]
  /// - 空命令或未识别 → [DangerLevel.write]（保守判定）
  static DangerLevel _classifyShell(String command) {
    final trimmed = command.trim();
    if (trimmed.isEmpty) return DangerLevel.write;

    // 危险模式（任一命中即 dangerous）
    if (RegExp(r'rm\s+-rf\s+/').hasMatch(trimmed) ||
        RegExp(r'\bsudo\b').hasMatch(trimmed) ||
        trimmed.contains('>/dev/') ||
        trimmed.contains('\$((') ||
        trimmed.contains('`') ||
        RegExp(r'\bcurl\b|\bwget\b').hasMatch(trimmed) ||
        RegExp(r'\bdd\s+if=').hasMatch(trimmed) ||
        RegExp(r'\bmkfs\b').hasMatch(trimmed)) {
      return DangerLevel.dangerous;
    }

    final firstToken = trimmed.split(RegExp(r'\s')).first;

    // 读命令白名单
    const reads = {
      'ls',
      'cat',
      'grep',
      'find',
      'wc',
      'sort',
      'uniq',
      'head',
      'tail',
      'diff',
      'tree',
      'du',
      'stat',
      'file',
      'which',
      'echo',
      'pwd',
      'env',
    };
    if (reads.contains(firstToken)) return DangerLevel.read;

    // 写命令白名单
    const writes = {
      'rm',
      'mv',
      'cp',
      'chmod',
      'chown',
      'tar',
      'zip',
      'unzip',
      'mkdir',
      'touch',
      'ln',
      'rsync',
      'tee',
      'sed',
      'awk',
    };
    if (writes.contains(firstToken)) return DangerLevel.write;

    // 默认保守
    return DangerLevel.write;
  }
}
