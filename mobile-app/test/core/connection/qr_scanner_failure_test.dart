import 'package:flutter_test/flutter_test.dart';
import 'package:spacecode_mobile/core/connection/qr_scanner_page.dart';
import 'package:spacecode_mobile/core/i18n/strings.dart';

/// 相机起不来时不能只给一个感叹号：权限被拒和组件初始化失败的恢复动作不同，
/// 两者的文案也要能分开（issue #40 问题 5）。
void main() {
  setUp(() {
    I18n.initForTest(locale: AppLocale.zh, strings: const {
      'scanner.permissionDeniedTitle': '需要相机权限',
      'scanner.permissionDeniedMessage': '请在系统设置中开启相机权限',
      'scanner.cameraUnavailableTitle': '相机初始化失败',
      'scanner.cameraUnavailableMessage': '请重试或手动填写地址',
    });
  });

  group('classifyQrScannerFailure', () {
    test('权限被拒单独成类', () {
      expect(
        classifyQrScannerFailure('permissionDenied'),
        QrScannerFailure.permissionDenied,
      );
    });

    test('组件起不来归为相机不可用', () {
      expect(
        classifyQrScannerFailure('controllerUnavailable'),
        QrScannerFailure.cameraUnavailable,
      );
      expect(
        classifyQrScannerFailure('nothingToScan'),
        QrScannerFailure.unknown,
      );
      expect(classifyQrScannerFailure(null), QrScannerFailure.unknown);
    });
  });

  group('qrScannerFailureCopy', () {
    test('权限被拒给权限文案', () {
      final failure = QrScannerFailure.permissionDenied;
      expect(qrScannerFailureTitle(failure), '需要相机权限');
      expect(qrScannerFailureMessage(failure), contains('系统设置'));
    });

    test('相机不可用给恢复路径文案', () {
      final failure = QrScannerFailure.cameraUnavailable;
      expect(qrScannerFailureTitle(failure), '相机初始化失败');
      expect(qrScannerFailureMessage(failure), contains('手动填写'));
    });
  });
}
