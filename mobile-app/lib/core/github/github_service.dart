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

class GithubDeviceFlow {
  final String deviceCode;
  final String userCode;
  final Uri verificationUri;
  final int intervalSeconds;
  final int expiresInSeconds;

  const GithubDeviceFlow({
    required this.deviceCode,
    required this.userCode,
    required this.verificationUri,
    required this.intervalSeconds,
    required this.expiresInSeconds,
  });
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

  Future<GithubDeviceFlow> startDeviceFlow({required String clientId}) async {
    if (clientId.trim().isEmpty) {
      throw StateError('未配置 Github OAuth Client ID');
    }
    final response = await _client.post(
      Uri.parse('https://github.com/login/device/code'),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body:
          Uri(queryParameters: {'client_id': clientId.trim(), 'scope': 'repo'})
              .query,
    );
    final body = _decode(response);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body is! Map<String, dynamic>) {
      throw StateError(_errorMessage(body, '无法启动 Github 网页认证'));
    }
    final verification = body['verification_uri'] as String?;
    final deviceCode = body['device_code'] as String?;
    final userCode = body['user_code'] as String?;
    if (verification == null || deviceCode == null || userCode == null) {
      throw StateError('Github 返回了无效的认证信息');
    }
    return GithubDeviceFlow(
      deviceCode: deviceCode,
      userCode: userCode,
      verificationUri: Uri.parse(verification),
      intervalSeconds: body['interval'] as int? ?? 5,
      expiresInSeconds: body['expires_in'] as int? ?? 900,
    );
  }

  Future<String> pollDeviceFlow(
      {required String clientId, required GithubDeviceFlow flow}) async {
    var interval = flow.intervalSeconds;
    final deadline =
        DateTime.now().add(Duration(seconds: flow.expiresInSeconds));
    while (DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(Duration(seconds: interval));
      final response = await _client.post(
        Uri.parse('https://github.com/login/oauth/access_token'),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: Uri(queryParameters: {
          'client_id': clientId.trim(),
          'device_code': flow.deviceCode,
          'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
        }).query,
      );
      final body = _decode(response);
      if (body is! Map<String, dynamic>) throw StateError('Github 返回了无效的认证响应');
      final token = body['access_token'] as String?;
      if (token != null && token.isNotEmpty) return token;
      final error = body['error'] as String?;
      if (error == 'authorization_pending') continue;
      if (error == 'slow_down') {
        interval += 5;
        continue;
      }
      if (error == 'expired_token') throw StateError('Github 网页认证已过期，请重试');
      if (error == 'access_denied') throw StateError('用户拒绝了 Github 授权');
      throw StateError(body['error_description'] as String? ?? 'Github 网页认证失败');
    }
    throw StateError('Github 网页认证超时，请重试');
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
    Future<void>? abortTrigger,
    bool Function()? isCancelled,
  }) async {
    _throwIfCancelled(isCancelled);
    final response = await _send(
      'GET',
      Uri.parse('https://api.github.com/repos/$repository/zipball/$branch'),
      headers: _headers,
      abortTrigger: abortTrigger,
    );
    _throwIfCancelled(isCancelled);
    if (response.statusCode != 200) {
      throw StateError(_errorMessage(_decode(response), '仓库下载失败'));
    }
    final archive = ZipDecoder().decodeBytes(response.bodyBytes);
    final root = Directory(targetDirectory);
    await root.create(recursive: true);
    for (final file in archive) {
      _throwIfCancelled(isCancelled);
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
    Future<void>? abortTrigger,
    bool Function()? isCancelled,
  }) async {
    _throwIfCancelled(isCancelled);
    final response = await _send(
      'POST',
      Uri.parse('https://api.github.com/repos/$repository/pulls'),
      headers: {..._headers, 'Content-Type': 'application/json'},
      body: jsonEncode(
          {'title': title, 'body': body, 'head': head, 'base': base}),
      abortTrigger: abortTrigger,
    );
    _throwIfCancelled(isCancelled);
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
    Future<void>? abortTrigger,
    bool Function()? isCancelled,
  }) async {
    _throwIfCancelled(isCancelled);
    final ref = await _getJson(
      '/repos/$repository/git/ref/heads/$base',
      abortTrigger: abortTrigger,
      isCancelled: isCancelled,
    );
    final baseCommit = (ref['object'] as Map<String, dynamic>)['sha'] as String;
    final commit = await _getJson(
      '/repos/$repository/git/commits/$baseCommit',
      abortTrigger: abortTrigger,
      isCancelled: isCancelled,
    );
    final baseTree = (commit['tree'] as Map<String, dynamic>)['sha'] as String;
    final branch = 'spacecode/mobile-${DateTime.now().millisecondsSinceEpoch}';
    await _postJson(
      '/repos/$repository/git/refs',
      {
        'ref': 'refs/heads/$branch',
        'sha': baseCommit,
      },
      abortTrigger: abortTrigger,
      isCancelled: isCancelled,
    );

    final entries = <Map<String, dynamic>>[];
    final root = Directory(directory);
    await for (final entity in root.list(recursive: true, followLinks: false)) {
      _throwIfCancelled(isCancelled);
      if (entity is! File) continue;
      final relative = entity.path
          .substring(root.path.length + 1)
          .replaceAll(Platform.pathSeparator, '/');
      final blob = await _postJson(
        '/repos/$repository/git/blobs',
        {
          'content': base64Encode(await entity.readAsBytes()),
          'encoding': 'base64',
        },
        abortTrigger: abortTrigger,
        isCancelled: isCancelled,
      );
      entries.add({
        'path': relative,
        'mode': '100644',
        'type': 'blob',
        'sha': blob['sha']
      });
    }
    final tree = await _postJson(
      '/repos/$repository/git/trees',
      {
        'base_tree': baseTree,
        'tree': entries,
      },
      abortTrigger: abortTrigger,
      isCancelled: isCancelled,
    );
    final newCommit = await _postJson(
      '/repos/$repository/git/commits',
      {
        'message': title,
        'tree': tree['sha'],
        'parents': [baseCommit],
      },
      abortTrigger: abortTrigger,
      isCancelled: isCancelled,
    );
    await _patchJson(
      '/repos/$repository/git/refs/heads/$branch',
      {'sha': newCommit['sha']},
      abortTrigger: abortTrigger,
      isCancelled: isCancelled,
    );
    return createPullRequest(
      repository: repository,
      head: branch,
      base: base,
      title: title,
      body: body,
      abortTrigger: abortTrigger,
      isCancelled: isCancelled,
    );
  }

  Future<Map<String, dynamic>> _getJson(
    String path, {
    Future<void>? abortTrigger,
    bool Function()? isCancelled,
  }) async {
    _throwIfCancelled(isCancelled);
    final response = await _send(
      'GET',
      Uri.parse('https://api.github.com$path'),
      headers: _headers,
      abortTrigger: abortTrigger,
    );
    _throwIfCancelled(isCancelled);
    final body = _decode(response);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body is! Map<String, dynamic>) {
      throw StateError(_errorMessage(body, 'Github 请求失败'));
    }
    return body;
  }

  Future<Map<String, dynamic>> _postJson(
    String path,
    Map<String, dynamic> payload, {
    Future<void>? abortTrigger,
    bool Function()? isCancelled,
  }) async {
    _throwIfCancelled(isCancelled);
    final response = await _send(
      'POST',
      Uri.parse('https://api.github.com$path'),
      headers: {..._headers, 'Content-Type': 'application/json'},
      body: jsonEncode(payload),
      abortTrigger: abortTrigger,
    );
    _throwIfCancelled(isCancelled);
    final body = _decode(response);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body is! Map<String, dynamic>) {
      throw StateError(_errorMessage(body, 'Github 写入失败'));
    }
    return body;
  }

  Future<void> _patchJson(
    String path,
    Map<String, dynamic> payload, {
    Future<void>? abortTrigger,
    bool Function()? isCancelled,
  }) async {
    _throwIfCancelled(isCancelled);
    final response = await _send(
      'PATCH',
      Uri.parse('https://api.github.com$path'),
      headers: {..._headers, 'Content-Type': 'application/json'},
      body: jsonEncode(payload),
      abortTrigger: abortTrigger,
    );
    _throwIfCancelled(isCancelled);
    final body = _decode(response);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(_errorMessage(body, 'Github 更新失败'));
    }
  }

  Future<http.Response> _send(
    String method,
    Uri uri, {
    required Map<String, String> headers,
    String? body,
    Future<void>? abortTrigger,
  }) async {
    final request = http.AbortableRequest(
      method,
      uri,
      abortTrigger: abortTrigger,
    )
      ..headers.addAll(headers)
      ..body = body ?? '';
    return http.Response.fromStream(await _client.send(request));
  }

  void _throwIfCancelled(bool Function()? isCancelled) {
    if (isCancelled?.call() ?? false) {
      throw StateError('Operation cancelled');
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
