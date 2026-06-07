import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'connection_service.dart';

class QRScannerPage extends ConsumerStatefulWidget {
  const QRScannerPage({super.key});

  @override
  ConsumerState<QRScannerPage> createState() => _QRScannerPageState();
}

class _QRScannerPageState extends ConsumerState<QRScannerPage> {
  final MobileScannerController _scannerController = MobileScannerController();
  bool _processed = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('扫描二维码')),
      body: MobileScanner(
        controller: _scannerController,
        onDetect: (capture) {
          if (_processed) return;
          final barcode = capture.barcodes.firstOrNull;
          if (barcode != null && barcode.rawValue != null) {
            _processed = true;
            _scannerController.stop();
            final url = barcode.rawValue!;
            ref.read(connectionProvider.notifier).connect(url);
            Navigator.of(context).pop();
          }
        },
      ),
    );
  }

  @override
  void dispose() {
    _scannerController.dispose();
    super.dispose();
  }
}
