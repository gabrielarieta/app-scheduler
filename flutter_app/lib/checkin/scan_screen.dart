import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Lê o QR do organizador (agenda://checkin/<id>/<código>) ou aceita o código digitado.
/// Devolve o código de 6 dígitos. Android/iOS: requer permissão de câmera.
class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final _manual = TextEditingController();
  bool _done = false;

  @override
  void dispose() {
    _manual.dispose();
    super.dispose();
  }

  void _finish(String code) {
    if (_done) return;
    _done = true;
    Navigator.pop(context, code);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Check-in')),
      body: Column(children: [
        Expanded(
          child: MobileScanner(
            onDetect: (capture) {
              final raw =
                  capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
              final code = raw?.split('/').last ?? '';
              if (RegExp(r'^\d{6}$').hasMatch(code)) _finish(code);
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _manual,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(
                    labelText: 'Ou digite o código', counterText: ''),
              ),
            ),
            const SizedBox(width: 12),
            FilledButton(
              onPressed: () {
                if (_manual.text.trim().length == 6) _finish(_manual.text.trim());
              },
              child: const Text('Enviar'),
            ),
          ]),
        ),
      ]),
    );
  }
}
