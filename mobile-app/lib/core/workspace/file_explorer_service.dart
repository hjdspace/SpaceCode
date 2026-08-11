import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

import 'workspace_target.dart';

/// 文件树中的一个条目（文件或文件夹）。
class FileEntry {
  /// 显示名称（如 `main.dart`）。
  final String name;

  /// 相对于项目根目录的路径，使用 POSIX 分隔符（如 `lib/main.dart`）。
  final String relativePath;

  /// 是否为目录。
  final bool isDirectory;

  /// 文件字节数（目录为 null）。
  final int? size;

  const FileEntry({
    required this.name,
    required this.relativePath,
    required this.isDirectory,
    this.size,
  });

  factory FileEntry.fromJson(Map<String, dynamic> json) => FileEntry(
        name: json['name'] as String? ?? '',
        relativePath: json['relativePath'] as String? ?? '',
        isDirectory: json['isDirectory'] as bool? ?? false,
        size: json['size'] as int?,
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'relativePath': relativePath,
        'isDirectory': isDirectory,
        if (size != null) 'size': size,
      };
}

/// 文件预览的类型。
enum FilePreviewType { code, markdown, image, text, unsupported }

/// 文件预览内容。
class FilePreviewContent {
  final FilePreviewType type;

  /// 文本内容（code / markdown / text 使用）。
  final String? textContent;

  /// 图片字节数据（image 使用）。
  final Uint8List? imageBytes;

  /// 代码语言标识（如 `dart`、`python`），仅 code 类型有值。
  final String? language;

  /// 是否因文件过大被截断。
  final bool truncated;

  /// 截断时显示的行数提示。
  final int? truncatedLines;

  /// 文件字节大小。
  final int size;

  const FilePreviewContent({
    required this.type,
    this.textContent,
    this.imageBytes,
    this.language,
    this.truncated = false,
    this.truncatedLines,
    required this.size,
  });
}

/// 文件浏览与预览服务。
///
/// 本地项目（`WorkspaceMode.local` 或 GitHub 项目已 clone）直接读本地文件系统；
/// GitHub 项目无本地 clone 时回退到 GitHub Contents API。
class FileExplorerService {
  final String? githubToken;
  final http.Client _client;

  FileExplorerService({this.githubToken, http.Client? client})
      : _client = client ?? http.Client();

  /// 默认隐藏的目录与文件名（构建产物、版本控制、IDE 配置等噪声）。
  static const _hiddenEntries = {
    '.git',
    '.svn',
    '.hg',
    '.dart_tool',
    'build',
    '.idea',
    '.vscode',
    'node_modules',
    '.gradle',
    '.fvm',
    '.DS_Store',
    'Thumbs.db',
  };

  /// 代码文件扩展名 → highlight.js 语言标识。
  static const _codeLanguages = {
    'dart': 'dart',
    'py': 'python',
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'kt': 'kotlin',
    'swift': 'swift',
    'c': 'c',
    'h': 'c',
    'cpp': 'cpp',
    'cc': 'cpp',
    'cxx': 'cpp',
    'hpp': 'cpp',
    'cs': 'csharp',
    'rb': 'ruby',
    'php': 'php',
    'pl': 'perl',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'fish': 'bash',
    'ps1': 'powershell',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'html': 'xml',
    'htm': 'xml',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'sql': 'sql',
    'lua': 'lua',
    'r': 'r',
    'scala': 'scala',
    'clj': 'clojure',
    'ex': 'elixir',
    'exs': 'elixir',
    'erl': 'erlang',
    'hs': 'haskell',
    'ml': 'ocaml',
    'fs': 'fsharp',
    'vim': 'vim',
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
    'gradle': 'gradle',
    'toml': 'ini',
    'ini': 'ini',
    'cfg': 'ini',
    'conf': 'ini',
    'vue': 'xml',
    'svelte': 'xml',
  };

  /// 纯文本文件扩展名（无语法高亮）。
  static const _textExtensions = {
    'txt',
    'log',
    'env',
    'gitignore',
    'gitattributes',
    'editorconfig',
    'lock',
    'csv',
    'tsv',
    'properties',
    'diff',
    'patch',
  };

  /// 图片扩展名。
  static const _imageExtensions = {
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'svg',
  };

  /// 大文件阈值：超过此大小（256KB）的文本文件截断显示。
  static const int _maxTextBytes = 256 * 1024;

  /// 截断时保留的行数。
  static const int _maxTruncatedLines = 400;

  /// 列出指定目录下的条目（目录在前，按名称排序）。
  ///
  /// [relativePath] 是相对项目根的 POSIX 路径（如 `lib/features`），空串表示根目录。
  Future<List<FileEntry>> listDirectory(
    WorkspaceTarget workspace, {
    String relativePath = '',
  }) async {
    final useLocal = workspace.mode == WorkspaceMode.local ||
        (workspace.localPath != null && workspace.localPath!.isNotEmpty);
    if (useLocal) {
      return _listLocal(workspace.localPath!, relativePath);
    }
    return _listGithub(workspace, relativePath);
  }

  /// 读取文件内容用于预览。
  Future<FilePreviewContent> readFile(
    WorkspaceTarget workspace,
    String relativePath,
  ) async {
    final useLocal = workspace.mode == WorkspaceMode.local ||
        (workspace.localPath != null && workspace.localPath!.isNotEmpty);
    if (useLocal) {
      return _readLocal(workspace.localPath!, relativePath);
    }
    return _readGithub(workspace, relativePath);
  }

  // ─────────────── 本地文件系统 ───────────────

  Future<List<FileEntry>> _listLocal(
      String rootPath, String relativePath) async {
    final rootDir = Directory(rootPath);
    if (!await rootDir.exists()) {
      throw StateError('项目目录不存在：$rootPath');
    }
    final targetPath = _resolveLocal(rootPath, relativePath);
    final targetDir = Directory(targetPath);
    if (!await targetDir.exists()) {
      throw StateError('目录不存在：$relativePath');
    }

    final entries = <FileEntry>[];
    await for (final entity in targetDir.list(followLinks: false)) {
      final name = p.basename(entity.path);
      if (_hiddenEntries.contains(name)) continue;

      final isDir = entity is Directory;
      final rel = _toRelative(rootPath, entity.path);
      entries.add(FileEntry(
        name: name,
        relativePath: rel,
        isDirectory: isDir,
        size: isDir ? null : (entity is File ? await entity.length() : null),
      ));
    }

    entries.sort((a, b) {
      // 目录在前，同类按名称排序（不区分大小写）
      if (a.isDirectory != b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
    return entries;
  }

  Future<FilePreviewContent> _readLocal(
      String rootPath, String relativePath) async {
    final targetPath = _resolveLocal(rootPath, relativePath);
    final file = File(targetPath);
    if (!await file.exists()) {
      throw StateError('NOT_FOUND');
    }
    final size = await file.length();
    final type = _detectType(relativePath);

    if (type == FilePreviewType.image) {
      final bytes = await file.readAsBytes();
      return FilePreviewContent(
        type: type,
        imageBytes: bytes,
        size: size,
      );
    }

    if (type == FilePreviewType.unsupported) {
      return FilePreviewContent(type: type, size: size);
    }

    // 文本类（code / markdown / text）
    final decoded = await _decodeText(file);
    return FilePreviewContent(
      type: type,
      textContent: decoded.content,
      language: type == FilePreviewType.code
          ? _languageOf(relativePath)
          : null,
      truncated: decoded.truncated,
      truncatedLines: decoded.truncated ? _maxTruncatedLines : null,
      size: size,
    );
  }

  /// 解析本地路径并校验未越出项目根（防止 `../` 路径穿越）。
  String _resolveLocal(String rootPath, String relativePath) {
    final normalized = p.normalize(p.join(rootPath, relativePath));
    if (!p.isWithin(rootPath, normalized) && normalized != rootPath) {
      throw StateError('路径越界：$relativePath');
    }
    return normalized;
  }

  /// 将绝对路径转换为相对项目根的 POSIX 路径。
  String _toRelative(String rootPath, String absolutePath) {
    var rel = p.relative(absolutePath, from: rootPath);
    // 统一为 POSIX 分隔符
    return rel.replaceAll('\\', '/');
  }

  // ─────────────── GitHub Contents API ───────────────

  Map<String, String> get _githubHeaders => {
        'Accept': 'application/vnd.github+json',
        if (githubToken != null && githubToken!.isNotEmpty)
          'Authorization': 'Bearer $githubToken',
        'X-GitHub-Api-Version': '2022-11-28',
      };

  Future<List<FileEntry>> _listGithub(
      WorkspaceTarget workspace, String relativePath) async {
    final repo = workspace.repository;
    if (repo == null || repo.isEmpty) {
      throw StateError('未配置 GitHub 仓库');
    }
    final branch = workspace.branch ?? 'main';
    final encodedPath = relativePath.isEmpty
        ? ''
        : 'contents/${Uri.encodeComponent(relativePath)}';
    final url = Uri.parse(
        'https://api.github.com/repos/$repo/${encodedPath.isEmpty ? 'contents' : encodedPath}?ref=${Uri.encodeQueryComponent(branch)}');

    final response = await _client.get(url, headers: _githubHeaders);
    _checkGithubRateLimit(response);
    if (response.statusCode == 404) {
      throw StateError('NOT_FOUND');
    }
    if (response.statusCode != 200) {
      throw StateError(_githubErrorMessage(response));
    }
    final body = jsonDecode(response.body);
    if (body is! List) {
      throw StateError('GitHub 返回了非预期格式');
    }

    final entries = <FileEntry>[];
    for (final item in body.whereType<Map<String, dynamic>>()) {
      final name = item['name'] as String? ?? '';
      if (_hiddenEntries.contains(name)) continue;
      final type = item['type'] as String? ?? '';
      final path = item['path'] as String? ?? '';
      entries.add(FileEntry(
        name: name,
        relativePath: path,
        isDirectory: type == 'dir',
        size: item['size'] as int?,
      ));
    }

    entries.sort((a, b) {
      if (a.isDirectory != b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
    return entries;
  }

  Future<FilePreviewContent> _readGithub(
      WorkspaceTarget workspace, String relativePath) async {
    final repo = workspace.repository;
    if (repo == null || repo.isEmpty) {
      throw StateError('未配置 GitHub 仓库');
    }
    final branch = workspace.branch ?? 'main';
    final encodedPath = Uri.encodeComponent(relativePath);
    final url = Uri.parse(
        'https://api.github.com/repos/$repo/contents/$encodedPath?ref=${Uri.encodeQueryComponent(branch)}');

    final response = await _client.get(url, headers: _githubHeaders);
    _checkGithubRateLimit(response);
    if (response.statusCode == 404) {
      throw StateError('NOT_FOUND');
    }
    if (response.statusCode != 200) {
      throw StateError(_githubErrorMessage(response));
    }
    final body = jsonDecode(response.body);
    if (body is! Map<String, dynamic> || body['content'] == null) {
      throw StateError('GitHub 返回了非预期格式');
    }

    final size = (body['size'] as num?)?.toInt() ?? 0;
    final encoding = body['encoding'] as String? ?? '';
    final rawContent = body['content'] as String? ?? '';
    final type = _detectType(relativePath);

    if (encoding != 'base64') {
      return FilePreviewContent(type: FilePreviewType.unsupported, size: size);
    }

    // base64 解码（GitHub 返回的 content 含换行符，需先移除）
    final cleaned = rawContent.replaceAll(RegExp(r'\s'), '');
    final bytes = base64.decode(cleaned);

    if (type == FilePreviewType.image) {
      return FilePreviewContent(
        type: type,
        imageBytes: Uint8List.fromList(bytes),
        size: size,
      );
    }

    if (type == FilePreviewType.unsupported) {
      return FilePreviewContent(type: type, size: size);
    }

    final decoded = _decodeBytes(bytes);
    return FilePreviewContent(
      type: type,
      textContent: decoded.content,
      language: type == FilePreviewType.code
          ? _languageOf(relativePath)
          : null,
      truncated: decoded.truncated,
      truncatedLines: decoded.truncated ? _maxTruncatedLines : null,
      size: size,
    );
  }

  void _checkGithubRateLimit(http.Response response) {
    if (response.statusCode == 403) {
      final remaining = response.headers['x-ratelimit-remaining'];
      if (remaining == '0') {
        throw StateError('RATE_LIMITED');
      }
    }
  }

  String _githubErrorMessage(http.Response response) {
    try {
      final body = jsonDecode(response.body);
      if (body is Map<String, dynamic> && body['message'] != null) {
        return body['message'].toString();
      }
    } catch (_) {}
    return 'GitHub 请求失败 (HTTP ${response.statusCode})';
  }

  // ─────────────── 文本解码与截断 ───────────────

  /// 从本地文件解码文本，自动处理大文件截断。
  Future<_DecodedText> _decodeText(File file) async {
    final bytes = await file.readAsBytes();
    return _decodeBytes(bytes);
  }

  /// 从字节解码文本，超过阈值时截断到 [_maxTruncatedLines] 行。
  _DecodedText _decodeBytes(Uint8List bytes) {
    if (bytes.length > _maxTextBytes) {
      // 大文件：只解码前 N 行
      final truncatedBytes = _takeFirstLines(bytes, _maxTruncatedLines);
      final content = _utf8DecodeGraceful(truncatedBytes);
      return _DecodedText(content, true);
    }
    final content = _utf8DecodeGraceful(bytes);
    return _DecodedText(content, false);
  }

  /// 取字节数组前 [maxLines] 行（按 `\n` 切分，保留行尾）。
  Uint8List _takeFirstLines(Uint8List bytes, int maxLines) {
    var lineCount = 0;
    var end = bytes.length;
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] == 0x0a) {
        lineCount++;
        if (lineCount >= maxLines) {
          end = i + 1;
          break;
        }
      }
    }
    return bytes.sublist(0, end);
  }

  /// 宽容的 UTF-8 解码：解码失败时回退到 latin1 避免乱码崩溃。
  String _utf8DecodeGraceful(Uint8List bytes) {
    try {
      return utf8.decode(bytes, allowMalformed: true);
    } catch (_) {
      return String.fromCharCodes(bytes);
    }
  }

  // ─────────────── 类型识别 ───────────────

  FilePreviewType _detectType(String path) {
    final ext = _extensionOf(path);
    if (['md', 'markdown'].contains(ext)) return FilePreviewType.markdown;
    if (_imageExtensions.contains(ext)) return FilePreviewType.image;
    if (_codeLanguages.containsKey(ext)) return FilePreviewType.code;
    if (_textExtensions.contains(ext)) return FilePreviewType.text;
    // 无扩展名但常见文件名
    final name = p.basename(path).toLowerCase();
    if (['dockerfile', 'makefile', 'rakefile', 'gemfile']
        .contains(name)) {
      return FilePreviewType.code;
    }
    if (['license', 'readme', 'changelog', 'authors', 'contributors']
        .contains(name)) {
      return FilePreviewType.text;
    }
    return FilePreviewType.unsupported;
  }

  String? _languageOf(String path) {
    final ext = _extensionOf(path);
    if (_codeLanguages.containsKey(ext)) return _codeLanguages[ext];
    final name = p.basename(path).toLowerCase();
    if (name == 'dockerfile') return 'dockerfile';
    if (name == 'makefile') return 'makefile';
    return null;
  }

  String _extensionOf(String path) {
    final name = p.basename(path);
    final dot = name.lastIndexOf('.');
    if (dot <= 0) return ''; // 隐藏文件如 .gitignore 取整体名
    return name.substring(dot + 1).toLowerCase();
  }

  void dispose() => _client.close();
}

class _DecodedText {
  final String content;
  final bool truncated;
  const _DecodedText(this.content, this.truncated);
}
