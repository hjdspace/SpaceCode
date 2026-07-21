import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/features/terminal/terminal_session.dart';

/// Fake Process 用于测试 TerminalSession 的事件流处理。
class _FakeProcess implements Process {
  final StreamController<List<int>> _stdoutCtrl =
      StreamController<List<int>>();
  final StreamController<List<int>> _stderrCtrl =
      StreamController<List<int>>();
  final Completer<int> _exitCompleter = Completer<int>();

  @override
  Stream<List<int>> get stdout => _stdoutCtrl.stream;

  @override
  Stream<List<int>> get stderr => _stderrCtrl.stream;

  @override
  Future<int> get exitCode => _exitCompleter.future;

  @override
  bool kill([ProcessSignal signal = ProcessSignal.sigterm]) {
    if (!_exitCompleter.isCompleted) {
      _exitCompleter.complete(130); // SIGINT 默认退出码
    }
    return true;
  }

  @override
  int get pid => 12345;

  @override
  IOSink get stdin => throw UnimplementedError();

  void emitStdout(String text) {
    _stdoutCtrl.add(utf8.encode(text));
  }

  void emitStderr(String text) {
    _stderrCtrl.add(utf8.encode(text));
  }

  Future<void> complete(int exitCode) async {
    if (!_exitCompleter.isCompleted) {
      await _stdoutCtrl.close();
      await _stderrCtrl.close();
      _exitCompleter.complete(exitCode);
    }
  }
}

void main() {
  test('execute emits stdout/stderr/exit events in order', () async {
    final fakeProcess = _FakeProcess();
    final session = TerminalSession(
      workingDirectory: '/tmp/ws',
      environment: const {},
      processStarter: ({required command, required workingDirectory, required environment}) async {
        expect(command, 'echo hello && echo err >&2');
        return fakeProcess;
      },
    );

    final events = <TerminalOutput>[];
    final subscription = session.output.listen(events.add);

    // 触发执行（不 await，因为我们要在执行过程中 emit 输出）
    final done = session.execute('echo hello && echo err >&2');

    // 等待 process.start 完成（让 subscription 注册）
    await Future.delayed(Duration.zero);

    fakeProcess.emitStdout('hello\n');
    fakeProcess.emitStderr('err\n');
    await fakeProcess.complete(0);

    await done;
    await subscription.cancel();

    final types = events.map((e) => e.type).toList();
    expect(types, contains(TerminalOutputType.stdout));
    expect(types, contains(TerminalOutputType.stderr));
    expect(types.last, TerminalOutputType.exit);

    final stdoutEvent = events.firstWhere((e) => e.type == TerminalOutputType.stdout);
    expect(stdoutEvent.text, 'hello\n');
    final stderrEvent = events.firstWhere((e) => e.type == TerminalOutputType.stderr);
    expect(stderrEvent.text, 'err\n');
    final exitEvent = events.last;
    expect(exitEvent.exitCode, 0);
    expect(exitEvent.durationMs, greaterThanOrEqualTo(0));
  });

  test('execute reports running state and exitCode future', () async {
    final fakeProcess = _FakeProcess();
    final session = TerminalSession(
      workingDirectory: '/tmp/ws',
      environment: const {},
      processStarter: ({required command, required workingDirectory, required environment}) async => fakeProcess,
    );

    expect(session.isRunning, isFalse);
    final done = session.execute('sleep 0');
    await Future.delayed(Duration.zero);
    expect(session.isRunning, isTrue);

    await fakeProcess.complete(0);
    await done;
    expect(session.isRunning, isFalse);
    expect(await session.exitCode, 0);
  });

  test('interrupt kills process and reports exit code 130', () async {
    final fakeProcess = _FakeProcess();
    final session = TerminalSession(
      workingDirectory: '/tmp/ws',
      environment: const {},
      processStarter: ({required command, required workingDirectory, required environment}) async => fakeProcess,
    );

    final done = session.execute('sleep 999');
    await Future.delayed(Duration.zero);

    await session.interrupt();
    await done;

    expect(await session.exitCode, 130);
  });

  test('dispose closes output stream and kills process', () async {
    final fakeProcess = _FakeProcess();
    final session = TerminalSession(
      workingDirectory: '/tmp/ws',
      environment: const {},
      processStarter: ({required command, required workingDirectory, required environment}) async => fakeProcess,
    );

    final events = <TerminalOutput>[];
    final subscription = session.output.listen(events.add);

    session.execute('long running');
    await Future.delayed(Duration.zero);

    await session.dispose();
    await subscription.cancel();

    // output 流应已关闭
    expect(session.outputController.isClosed, isTrue);

    // 进程应被 kill
    expect(await session.exitCode, 130);
    // 不 await done，因为 dispose 可能已经完成 completer
  });

  test('execute without prior dispose throws when called concurrently',
      () async {
    final fakeProcess = _FakeProcess();
    final session = TerminalSession(
      workingDirectory: '/tmp/ws',
      environment: const {},
      processStarter: ({required command, required workingDirectory, required environment}) async => fakeProcess,
    );

    session.execute('first');
    await Future.delayed(Duration.zero);

    expect(
      () => session.execute('second'),
      throwsA(isA<StateError>()),
    );

    await session.dispose();
  });

  test('execute fails gracefully when processStarter throws', () async {
    final session = TerminalSession(
      workingDirectory: '/tmp/ws',
      environment: const {},
      processStarter: ({required command, required workingDirectory, required environment}) async {
        throw StateError('sh not available');
      },
    );

    final events = <TerminalOutput>[];
    final sub = session.output.listen(events.add);

    await session.execute('echo hi');
    await sub.cancel();

    expect(session.isRunning, isFalse);
    expect(events.any((e) =>
        e.type == TerminalOutputType.stderr &&
        e.text.contains('sh not available')), isTrue);
    expect(events.last.type, TerminalOutputType.exit);
    expect(events.last.exitCode, -1);
  });
}
