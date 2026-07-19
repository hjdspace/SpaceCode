import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:spacecode_mobile/core/github/github_service.dart';

void main() {
  test('aborts an in-flight repository download', () async {
    final requestStarted = Completer<void>();
    final cancelled = Completer<void>();
    final client = MockClient.streaming((request, bodyStream) async {
      final abortable = request as http.AbortableRequest;
      await bodyStream.drain<void>();
      requestStarted.complete();
      await abortable.abortTrigger;
      throw http.RequestAbortedException(request.url);
    });
    final service = GithubService(token: 'test-token', client: client);

    final expectation = expectLater(
      service.cloneRepository(
        repository: 'spacecode/mobile',
        branch: 'main',
        targetDirectory: '/unused',
        abortTrigger: cancelled.future,
        isCancelled: () => cancelled.isCompleted,
      ),
      throwsA(isA<http.RequestAbortedException>()),
    );
    await requestStarted.future;
    cancelled.complete();

    await expectation;
    service.dispose();
  });
}
