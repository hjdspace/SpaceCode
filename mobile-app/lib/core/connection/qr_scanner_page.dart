import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../core/i18n/strings.dart';
import 'connection_service.dart';

/// 相机初始化失败的分类。插件默认的错误界面只有一个感叹号图标，
/// 用户分不清是权限没给还是相机起不来，也就不知道该点什么恢复。
enum QrScannerFailure { permissionDenied, cameraUnavailable, unknown }

/// [errorCode] 取 `MobileScannerErrorCode.name`（permissionDenied /
/// controllerUnavailable / nothingToScan）。
QrScannerFailure classifyQrScannerFailure(String? errorCode) {
  switch (errorCode) {
    case 'permissionDenied':
      return QrScannerFailure.permissionDenied;
    case 'controllerUnavailable':
      return QrScannerFailure.cameraUnavailable;
    default:
      return QrScannerFailure.unknown;
  }
}

String qrScannerFailureTitle(QrScannerFailure failure) =>
    failure == QrScannerFailure.permissionDenied
        ? I18n.t('scanner.permissionDeniedTitle')
        : I18n.t('scanner.cameraUnavailableTitle');

String qrScannerFailureMessage(QrScannerFailure failure) =>
    failure == QrScannerFailure.permissionDenied
        ? I18n.t('scanner.permissionDeniedMessage')
        : I18n.t('scanner.cameraUnavailableMessage');

/// 扫码成功后把 URL 作为返回值交给调用方（设置页 await 它回填连接地址栏）。
class QRScannerPage extends ConsumerStatefulWidget {
  const QRScannerPage({super.key});

  @override
  ConsumerState<QRScannerPage> createState() => _QRScannerPageState();
}

class _QRScannerPageState extends ConsumerState<QRScannerPage> {
  final MobileScannerController _scannerController = MobileScannerController();
  bool _processed = false;
  bool _checkingPermission = true;
  bool _cameraDenied = false;

  @override
  void initState() {
    super.initState();
    _ensureCameraPermission();
  }

  Future<void> _ensureCameraPermission() async {
    final status = await Permission.camera.request();
    if (!mounted) return;
    setState(() {
      _checkingPermission = false;
      _cameraDenied = !status.isGranted;
    });
  }

  Future<void> _retry() async {
    setState(() => _checkingPermission = true);
    await _ensureCameraPermission();
    if (_cameraDenied) return;
    try {
      await _scannerController.stop();
      await _scannerController.start();
    } catch (_) {
      // 起不来时由 MobileScanner 的 errorBuilder 继续提示重试
    }
  }

  void _onDetect(BarcodeCapture capture) {
    if (_processed || capture.barcodes.isEmpty) return;
    final url = capture.barcodes.first.rawValue;
    if (url == null || url.isEmpty) return;
    _processed = true;
    _scannerController.stop();
    ref.read(connectionProvider.notifier).connect(url);
    Navigator.of(context).pop(url);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(I18n.t('scanner.title'))),
      body: _checkingPermission
          ? const Center(child: CircularProgressIndicator())
          : _cameraDenied
              ? _QrScannerErrorView(
                  failure: QrScannerFailure.permissionDenied,
                  onRetry: _retry,
                  onOpenSettings: openAppSettings,
                )
              : MobileScanner(
                  controller: _scannerController,
                  onDetect: _onDetect,
                  errorBuilder: (context, error, child) => _QrScannerErrorView(
                    failure: classifyQrScannerFailure(error.errorCode.name),
                    onRetry: _retry,
                    onOpenSettings: openAppSettings,
                  ),
                ),
    );
  }

  @override
  void dispose() {
    _scannerController.dispose();
    super.dispose();
  }
}

class _QrScannerErrorView extends StatelessWidget {
  final QrScannerFailure failure;
  final Future<void> Function() onRetry;
  final Future<bool> Function() onOpenSettings;

  const _QrScannerErrorView({
    required this.failure,
    required this.onRetry,
    required this.onOpenSettings,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.no_photography_outlined,
            size: 40,
            color: theme.colorScheme.error,
          ),
          const SizedBox(height: 16),
          Text(
            qrScannerFailureTitle(failure),
            textAlign: TextAlign.center,
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            qrScannerFailureMessage(failure),
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
            ),
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              OutlinedButton(
                onPressed: onRetry,
                child: Text(I18n.t('scanner.retry')),
              ),
              const SizedBox(width: 12),
              FilledButton(
                onPressed: onOpenSettings,
                child: Text(I18n.t('scanner.openSettings')),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
