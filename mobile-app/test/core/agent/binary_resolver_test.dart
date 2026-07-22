import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/agent/binary_resolver.dart';

void main() {
  late Directory tempRoot;

  setUp(() async {
    tempRoot = await Directory.systemTemp.createTemp('spacecode-binary-test-');
  });

  tearDown(() async {
    if (await tempRoot.exists()) {
      await tempRoot.delete(recursive: true);
    }
  });

  test('initialize creates home and bin directories under docs/spacecode',
      () async {
    final resolver = BinaryResolver.forTest();
    await resolver.initialize(
      docsDirectoryProvider: () async => tempRoot,
      systemEnvironment: const {'PATH': '/system/bin'},
    );

    final expectedHome = '${tempRoot.path}/spacecode/home';
    final expectedBin = '${tempRoot.path}/spacecode/bin';
    expect(await Directory(expectedHome).exists(), isTrue);
    expect(await Directory(expectedBin).exists(), isTrue);
  });

  test('environment exposes PATH containing bin dir + system paths + HOME',
      () async {
    final resolver = BinaryResolver.forTest();
    await resolver.initialize(
      docsDirectoryProvider: () async => tempRoot,
      systemEnvironment: const {'PATH': '/system/bin', 'ANDROID_DATA': '/data'},
    );

    final env = resolver.environment;
    final expectedBin = '${tempRoot.path}/spacecode/bin';
    expect(env['PATH'], contains(expectedBin));
    expect(env['PATH'], contains('/system/bin'));
    expect(env['HOME'], '${tempRoot.path}/spacecode/home');
    expect(env['TERM'], 'dumb');
    expect(env['LANG'], 'en_US.UTF-8');
    // 保留系统环境变量
    expect(env['ANDROID_DATA'], '/data');
    // Git 身份默认配置
    expect(env['GIT_AUTHOR_NAME'], 'SpaceCode Mobile');
    expect(env['GIT_COMMITTER_EMAIL'], 'mobile@spacecode.local');
    expect(env['GIT_CONFIG_NOSYSTEM'], '1');
  });

  test('gitPath and pythonReady default to null/false when no binaries bundled',
      () async {
    final resolver = BinaryResolver.forTest();
    await resolver.initialize(
      docsDirectoryProvider: () async => tempRoot,
      systemEnvironment: const {},
    );

    expect(resolver.gitPath, isNull);
    expect(resolver.pythonReady, isFalse);
  });

  test('registerGitBinary sets gitPath and appends its dir to PATH', () async {
    final resolver = BinaryResolver.forTest();
    await resolver.initialize(
      docsDirectoryProvider: () async => tempRoot,
      systemEnvironment: const {},
    );

    final fakeGitPath = '${tempRoot.path}/spacecode/bin/git';
    await File(fakeGitPath).writeAsString('#!/bin/sh\necho git');
    resolver.registerGitBinary(fakeGitPath);

    expect(resolver.gitPath, fakeGitPath);
    expect(resolver.environment['PATH'], contains(tempRoot.path));
  });

  test('markPythonReady flips pythonReady to true', () async {
    final resolver = BinaryResolver.forTest();
    await resolver.initialize(
      docsDirectoryProvider: () async => tempRoot,
      systemEnvironment: const {},
    );

    expect(resolver.pythonReady, isFalse);
    resolver.markPythonReady();
    expect(resolver.pythonReady, isTrue);
  });

  test('initialize is idempotent (safe to call twice)', () async {
    final resolver = BinaryResolver.forTest();
    await resolver.initialize(
      docsDirectoryProvider: () async => tempRoot,
      systemEnvironment: const {},
    );
    // 再次调用不应抛错
    await resolver.initialize(
      docsDirectoryProvider: () async => tempRoot,
      systemEnvironment: const {},
    );

    expect(resolver.environment['HOME'], '${tempRoot.path}/spacecode/home');
  });

  test('initialize throws when docsDirectoryProvider fails', () async {
    final resolver = BinaryResolver.forTest();
    expect(
      () => resolver.initialize(
        docsDirectoryProvider: () async =>
            throw StateError('path_provider unavailable'),
        systemEnvironment: const {},
      ),
      throwsA(isA<StateError>()),
    );
  });
}
