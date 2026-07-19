import 'dart:convert';
import 'dart:io';
import 'package:archive/archive.dart';
import 'package:http/http.dart' as http;

class GithubRepository {
  final String fullName;
  final String name;
  final String defaultBranch;
  final bool isPrivate;

  const GithubRepository({
    required this.fullName,
    required this.name,
    required this.defaultBranch,
    required this.isPrivate,
  });

  factory GithubRepository.fromJson(Map<String, dynamic> json) =>
      GithubRepository(
        fullName: json['full_name'] as String? ?? '',
        name: json['name'] as String? ?? '',
        defaultBranch: json['default_branch'] as String? ?? 'main',
        isPrivate: json['private'] as bool? ?? false,
      );
}

class GithubService {
  final http.Client _client;
  final String token;

  GithubService({required this.token, http.Client? client})
      : _client = client ?? http.Client();

  Map<String, String> get _headers => {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer $token',
        'X-GitHub-Api-Version': '2022-11-28',
      };

  Future<String> authenticate() async {
    final response = await _client.get(Uri.parse('https://api.github.com/user'),
        headers: _headers);
    final body = _decode(response);
    if (response.statusCode != 200 || body is! Map<String, dynamic>) {
      throw StateError(_errorMessage(body, 'Github 认证失败'));
    }
    return body['login'] as String? ?? '';
  }

  Future<List<GithubRepository>> listRepositories() async {
    final response = await _client.get(
      Uri.parse('https://api.github.com/user/repos?sort=updated&per_page=100'),
      headers: _headers,
    );
    final body = _decode(response);
    if (response.statusCode != 200 || body is! List) {
      throw StateError(_errorMessage(body, '无法读取 Github 仓库'));
    }
    return body
        .whereType<Map<String, dynamic>>()
        .map(GithubRepository.fromJson)
        .toList();
  }

  Future<List<String>> listBranches(String repository) async {
    final response = await _client.get(
      Uri.parse(
          'https://api.github.com/repos/$repository/branches?per_page=100'),
      headers: _headers,
    );
    final body = _decode(response);
    if (response.statusCode != 200 || body is! List) {
      throw StateError(_errorMessage(body, '无法读取 Github 分支'));
    }
    return body
        .whereType<Map<String, dynamic>>()
        .map((item) => item['name'] as String? ?? '')
        .where((name) => name.isNotEmpty)
        .toList();
  }

  Future<void> cloneRepository({
    required String repository,
    required String branch,
    required String targetDirectory,
  }) async {
    final response = await _client.get(
      Uri.parse('https://api.github.com/repos/$repository/zipball/$branch'),
      headers: _headers,
    );
    if (response.statusCode != 200) {
      throw StateError(_errorMessage(_decode(response), '仓库下载失败'));
    }
    final archive = ZipDecoder().decodeBytes(response.bodyBytes);
    final root = Directory(targetDirectory);
    await root.create(recursive: true);
    for (final file in archive) {
      final relative = file.name.split('/').skip(1).join('/');
      if (relative.isEmpty) continue;
      final output = File(
          '${root.path}${Platform.pathSeparator}${relative.replaceAll('/', Platform.pathSeparator)}');
      if (file.isFile) {
        await output.parent.create(recursive: true);
        await output.writeAsBytes(file.content as List<int>);
      } else {
        await Directory(output.path).create(recursive: true);
      }
    }
  }

  Future<String> createPullRequest({
    required String repository,
    required String head,
    required String base,
    required String title,
    required String body,
  }) async {
    final response = await _client.post(
      Uri.parse('https://api.github.com/repos/$repository/pulls'),
      headers: {..._headers, 'Content-Type': 'application/json'},
      body: jsonEncode(
          {'title': title, 'body': body, 'head': head, 'base': base}),
    );
    final data = _decode(response);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        data is! Map<String, dynamic>) {
      throw StateError(_errorMessage(data, '创建 Pull Request 失败'));
    }
    return data['html_url'] as String? ?? '';
  }

  /// Creates a branch and commits the current mobile workspace through the
  /// Git Data API, then opens a pull request against [base].
  Future<String> commitDirectoryAndCreatePullRequest({
    required String repository,
    required String base,
    required String directory,
    required String title,
    required String body,
  }) async {
    final ref = await _getJson('/repos/$repository/git/ref/heads/$base');
    final baseCommit = (ref['object'] as Map<String, dynamic>)['sha'] as String;
    final commit = await _getJson('/repos/$repository/git/commits/$baseCommit');
    final baseTree = (commit['tree'] as Map<String, dynamic>)['sha'] as String;
    final branch = 'spacecode/mobile-${DateTime.now().millisecondsSinceEpoch}';
    await _postJson('/repos/$repository/git/refs', {
      'ref': 'refs/heads/$branch',
      'sha': baseCommit,
    });

    final entries = <Map<String, dynamic>>[];
    final root = Directory(directory);
    await for (final entity in root.list(recursive: true, followLinks: false)) {
      if (entity is! File) continue;
      final relative = entity.path
          .substring(root.path.length + 1)
          .replaceAll(Platform.pathSeparator, '/');
      final blob = await _postJson('/repos/$repository/git/blobs', {
        'content': base64Encode(await entity.readAsBytes()),
        'encoding': 'base64',
      });
      entries.add({
        'path': relative,
        'mode': '100644',
        'type': 'blob',
        'sha': blob['sha']
      });
    }
    final tree = await _postJson('/repos/$repository/git/trees', {
      'base_tree': baseTree,
      'tree': entries,
    });
    final newCommit = await _postJson('/repos/$repository/git/commits', {
      'message': title,
      'tree': tree['sha'],
      'parents': [baseCommit],
    });
    await _patchJson(
        '/repos/$repository/git/refs/heads/$branch', {'sha': newCommit['sha']});
    return createPullRequest(
      repository: repository,
      head: branch,
      base: base,
      title: title,
      body: body,
    );
  }

  Future<Map<String, dynamic>> _getJson(String path) async {
    final response = await _client.get(Uri.parse('https://api.github.com$path'),
        headers: _headers);
    final body = _decode(response);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body is! Map<String, dynamic>) {
      throw StateError(_errorMessage(body, 'Github 请求失败'));
    }
    return body;
  }

  Future<Map<String, dynamic>> _postJson(
      String path, Map<String, dynamic> payload) async {
    final response = await _client.post(
      Uri.parse('https://api.github.com$path'),
      headers: {..._headers, 'Content-Type': 'application/json'},
      body: jsonEncode(payload),
    );
    final body = _decode(response);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body is! Map<String, dynamic>) {
      throw StateError(_errorMessage(body, 'Github 写入失败'));
    }
    return body;
  }

  Future<void> _patchJson(String path, Map<String, dynamic> payload) async {
    final response = await _client.patch(
      Uri.parse('https://api.github.com$path'),
      headers: {..._headers, 'Content-Type': 'application/json'},
      body: jsonEncode(payload),
    );
    final body = _decode(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(_errorMessage(body, 'Github 更新失败'));
    }
  }

  dynamic _decode(http.Response response) {
    try {
      return jsonDecode(response.body);
    } catch (_) {
      return null;
    }
  }

  String _errorMessage(dynamic body, String fallback) =>
      body is Map<String, dynamic> && body['message'] != null
          ? body['message'].toString()
          : fallback;

  void dispose() => _client.close();
}
