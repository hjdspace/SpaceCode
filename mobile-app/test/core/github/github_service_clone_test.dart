import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/github/clone_progress.dart';
import 'package:spacecode_mobile/core/github/github_service.dart';

void main() {
  group('GithubService.cloneRepository Stream', () {
    test('emits downloading progress with totalBytes from Content-Length',
        () async {
      final zipBytes = _buildZip([
        _ArchiveFile('repo/file1.txt', [1, 2, 3]),
      ]);
      final client = MockClient.streaming((request, bodyStream) async {
        return http.StreamedResponse(
          Stream.fromIterable([zipBytes]),
          200,
          headers: {
            'content-length': '${zipBytes.length}',
          },
        );
      });
      final service = GithubService(token: 'test-token', client: client);

      final progresses = <CloneProgress>[];
      // 用临时目录避免污染测试机
      final targetDir = await _tempDir();
      try {
        await for (final p in service.cloneRepository(
          repository: 'spacecode/mobile',
          branch: 'main',
          targetDirectory: targetDir,
        )) {
          progresses.add(p);
        }
      } finally {
        service.dispose();
        await _cleanup(targetDir);
      }

      // 至少应包含：若干 downloading + 至少 1 个 extracting + 1 个 done
      expect(progresses, isNotEmpty);
      expect(progresses.any((p) => p.phase == ClonePhase.downloading), isTrue);
      expect(progresses.any((p) => p.phase == ClonePhase.extracting), isTrue);
      expect(progresses.last.phase, ClonePhase.done);
      // resultPath 应包含 GitHub zipball 根目录（测试 zip 第一段为 'repo'）
      expect(progresses.last.resultPath, '$targetDir${Platform.pathSeparator}repo');
      // 第一个 downloading 进度应包含 totalBytes
      final firstDownload =
          progresses.firstWhere((p) => p.phase == ClonePhase.downloading);
      expect(firstDownload.totalBytes, zipBytes.length);
    });

    test('emits error phase on non-200 response', () async {
      final client = MockClient.streaming((request, bodyStream) async {
        return http.StreamedResponse(
          Stream.fromIterable([utf8.encode('{"message":"Not Found"}')]),
          404,
        );
      });
      final service = GithubService(token: 'test-token', client: client);

      final progresses = <CloneProgress>[];
      await for (final p in service.cloneRepository(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/unused',
      )) {
        progresses.add(p);
      }
      service.dispose();

      expect(progresses.last.phase, ClonePhase.error);
      expect(progresses.last.errorMessage, contains('Not Found'));
    });

    test('respects isCancelled callback during download', () async {
      final zipBytes = _buildZip([
        _ArchiveFile('repo/file1.txt', [1, 2, 3]),
      ]);
      final client = MockClient.streaming((request, bodyStream) async {
        return http.StreamedResponse(
          Stream.fromIterable([zipBytes]),
          200,
          headers: {'content-length': '${zipBytes.length}'},
        );
      });
      final service = GithubService(token: 'test-token', client: client);

      bool cancelled = false;
      final progresses = <CloneProgress>[];
      try {
        await for (final p in service.cloneRepository(
          repository: 'spacecode/mobile',
          branch: 'main',
          targetDirectory: '/unused',
          isCancelled: () => cancelled,
        )) {
          progresses.add(p);
          // 收到第一个 downloading 后立即取消
          if (p.phase == ClonePhase.downloading) {
            cancelled = true;
          }
        }
      } catch (_) {
        // 取消可能抛异常，忽略
      } finally {
        service.dispose();
      }

      expect(progresses.any((p) => p.phase == ClonePhase.error), isTrue);
      expect(
          progresses
              .firstWhere((p) => p.phase == ClonePhase.error)
              .errorMessage,
          contains('已取消'));
    });
  });
}

/// 测试用 zip 构造工具。
List<int> _buildZip(List<_ArchiveFile> files) {
  final archive = Archive();
  for (final f in files) {
    archive.addFile(ArchiveFile(f.name, f.content.length, f.content));
  }
  return ZipEncoder().encode(archive)!;
}

class _ArchiveFile {
  final String name;
  final List<int> content;
  const _ArchiveFile(this.name, this.content);
}

Future<String> _tempDir() async {
  // 测试中不依赖 path_provider，用系统临时目录
  final dir = await Directory.systemTemp.createTemp('clone_test_');
  return dir.path;
}

Future<void> _cleanup(String path) async {
  try {
    final dir = Directory(path);
    if (await dir.exists()) {
      await dir.delete(recursive: true);
    }
  } catch (_) {
    // 忽略清理错误
  }
}
