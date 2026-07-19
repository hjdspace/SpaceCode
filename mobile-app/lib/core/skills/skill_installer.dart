import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import '../agent/agent_types.dart';
import '../github/github_service.dart';
import 'skill_loader.dart';

/// 解析后的 GitHub 仓库坐标。
class _ParsedRepo {
  final String owner;
  final String name;

  const _ParsedRepo({required this.owner, required this.name});
}

/// 从 GitHub 安装技能的安装器。
///
/// 复用 [GithubService.cloneRepository] 拉取仓库 zipball 并解包到
/// 应用文档目录下的 `spacecode/skills/github/<owner>/<name>/`。
class SkillInstaller {
  /// 已构造好的 loader（可选；调用方通常在安装后调用 loader.load() 刷新）。
  final SkillLoader? loader;

  /// 可注入的 HTTP 客户端，便于测试 mock。生产环境传入 null，由
  /// [GithubService] 自建 client。
  final http.Client? client;

  SkillInstaller({this.loader, this.client});

  /// 将任意形式的 GitHub 仓库引用解析为 owner/name。
  ///
  /// 接受的输入：
  /// - 完整 https URL：`https://github.com/user/repo`
  /// - 不带协议：`github.com/user/repo`
  /// - 简写：`user/repo`
  /// - 带 `.git` 后缀：`https://github.com/user/repo.git`
  /// - 带额外路径：`https://github.com/user/repo/tree/main`
  ///
  /// 输入无法识别时返回 null。
  // ignore: library_private_types_in_public_api
  static _ParsedRepo? parseGithubUrl(String input) {
    var trimmed = input.trim();
    if (trimmed.isEmpty) return null;
    if (trimmed.startsWith('https://')) {
      trimmed = trimmed.substring('https://'.length);
    } else if (trimmed.startsWith('http://')) {
      trimmed = trimmed.substring('http://'.length);
    }
    if (trimmed.startsWith('github.com/')) {
      trimmed = trimmed.substring('github.com/'.length);
    } else if (trimmed.contains('/') && !trimmed.contains('.')) {
      // user/repo 简写
    } else if (!trimmed.startsWith('@')) {
      return null;
    }
    final segments = trimmed.split('/').where((s) => s.isNotEmpty).toList();
    if (segments.length < 2) return null;
    final owner = segments[0];
    var name = segments[1];
    if (name.endsWith('.git')) {
      name = name.substring(0, name.length - 4);
    }
    if (owner.isEmpty || name.isEmpty) return null;
    return _ParsedRepo(owner: owner, name: name);
  }

  /// 从 GitHub 克隆仓库到本地技能目录，返回目标目录绝对路径。
  ///
  /// - [repoUrl]：任意可被 [parseGithubUrl] 识别的 GitHub 引用。
  /// - [githubToken]：调用 GitHub API 所需的 access token。
  /// - [branch]：要拉取的分支，默认 `main`。
  ///
  /// 若目标目录已存在，会先递归删除再重新克隆，保证幂等。
  Future<String> installFromGithub(
    String repoUrl, {
    required String githubToken,
    String branch = 'main',
    AgentCancellationToken? cancellation,
  }) async {
    final parsed = parseGithubUrl(repoUrl);
    if (parsed == null) {
      throw StateError('无效的 GitHub 仓库 URL: $repoUrl');
    }
    final docs = await getApplicationDocumentsDirectory();
    final targetDir = Directory(
      '${docs.path}/spacecode/skills/github/${parsed.owner}/${parsed.name}',
    );
    if (await targetDir.exists()) {
      await targetDir.delete(recursive: true);
    }
    final github = GithubService(token: githubToken, client: client);
    try {
      await github.cloneRepository(
        repository: '${parsed.owner}/${parsed.name}',
        branch: branch,
        targetDirectory: targetDir.path,
        abortTrigger: cancellation?.whenCancelled,
        isCancelled: cancellation == null ? null : () => cancellation.isCancelled,
      );
    } finally {
      github.dispose();
    }
    return targetDir.path;
  }

  /// 卸载指定目录下的技能。
  ///
  /// 目录不存在视为已卸载，直接返回。
  Future<void> uninstall(String directoryPath) async {
    final dir = Directory(directoryPath);
    if (await dir.exists()) {
      await dir.delete(recursive: true);
    }
  }
}
