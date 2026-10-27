import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/models.dart';
import '../core/ui.dart';

class WaitlistScreen extends StatefulWidget {
  const WaitlistScreen({super.key});

  @override
  State<WaitlistScreen> createState() => _WaitlistScreenState();
}

class _WaitlistScreenState extends State<WaitlistScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await ApiClient.instance.get('/waitlist');
      if (mounted) {
        setState(() => _items = (data as List)
            .map((e) => Map<String, dynamic>.from(e as Map))
            .toList());
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _remove(String id) async {
    try {
      await ApiClient.instance.delete('/waitlist/$id');
      _load();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _items.isEmpty
                      ? ListView(children: const [
                          SizedBox(height: 48),
                          Center(
                              child: Padding(
                            padding: EdgeInsets.all(24),
                            child: Text(
                                'Você não está em nenhuma lista de espera.\nQuando um horário estiver ocupado, use "Lista de espera" na tela de nova reserva.',
                                textAlign: TextAlign.center),
                          )),
                        ])
                      : ListView.separated(
                          itemCount: _items.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (_, i) {
                            final e = _items[i];
                            final s = DateTime.parse(e['start'] as String).toLocal();
                            final en = DateTime.parse(e['end'] as String).toLocal();
                            final notified = e['status'] == 'NOTIFIED';
                            return ListTile(
                              leading: Icon(
                                  notified ? Icons.notifications_active : Icons.hourglass_empty,
                                  color: notified ? Colors.green : null),
                              title: Text('${e['label'] ?? targetLabels[e['targetType']]}'),
                              subtitle: Text(
                                  '${fmtDate(s)} ${fmtRange(s, en)}\n${notified ? 'Horário liberou! Reserve agora.' : 'Aguardando liberar'}'),
                              isThreeLine: true,
                              trailing: IconButton(
                                  icon: const Icon(Icons.close),
                                  onPressed: () => _remove(e['id'] as String)),
                            );
                          },
                        ),
                ),
    );
  }
}
