import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/github/clone_progress.dart';

void main() {
  group('CloneProgress', () {
    test('downloadPercent returns null when totalBytes is null', () {
      const progress = CloneProgress(
        phase: ClonePhase.downloading,
        receivedBytes: 100,
        totalBytes: null,
        processedFiles: 0,
      );
      expect(progress.downloadPercent, isNull);
    });

    test('downloadPercent returns null when totalBytes is zero', () {
      const progress = CloneProgress(
        phase: ClonePhase.downloading,
        receivedBytes: 100,
        totalBytes: 0,
        processedFiles: 0,
      );
      expect(progress.downloadPercent, isNull);
    });

    test('downloadPercent returns ratio when totalBytes is positive', () {
      const progress = CloneProgress(
        phase: ClonePhase.downloading,
        receivedBytes: 50,
        totalBytes: 200,
        processedFiles: 0,
      );
      expect(progress.downloadPercent, 0.25);
    });

    test('extractPercent returns null when totalFiles is null', () {
      const progress = CloneProgress(
        phase: ClonePhase.extracting,
        receivedBytes: 200,
        totalBytes: 200,
        processedFiles: 5,
        totalFiles: null,
      );
      expect(progress.extractPercent, isNull);
    });

    test('extractPercent returns ratio when totalFiles is positive', () {
      const progress = CloneProgress(
        phase: ClonePhase.extracting,
        receivedBytes: 200,
        totalBytes: 200,
        processedFiles: 3,
        totalFiles: 10,
      );
      expect(progress.extractPercent, 0.3);
    });

    test('toJson/fromJson roundtrip preserves all fields', () {
      const original = CloneProgress(
        phase: ClonePhase.done,
        receivedBytes: 1024,
        totalBytes: 1024,
        processedFiles: 7,
        totalFiles: 7,
        resultPath: '/tmp/repo',
      );
      final decoded = CloneProgress.fromJson(original.toJson());
      expect(decoded.phase, ClonePhase.done);
      expect(decoded.receivedBytes, 1024);
      expect(decoded.totalBytes, 1024);
      expect(decoded.processedFiles, 7);
      expect(decoded.totalFiles, 7);
      expect(decoded.resultPath, '/tmp/repo');
      expect(decoded.errorMessage, isNull);
    });

    test('fromJson handles missing optional fields', () {
      final decoded = CloneProgress.fromJson({
        'phase': 'downloading',
        'receivedBytes': 10,
        'processedFiles': 0,
      });
      expect(decoded.phase, ClonePhase.downloading);
      expect(decoded.receivedBytes, 10);
      expect(decoded.totalBytes, isNull);
      expect(decoded.errorMessage, isNull);
      expect(decoded.resultPath, isNull);
    });
  });
}
