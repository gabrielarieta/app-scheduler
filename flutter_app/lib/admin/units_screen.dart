import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/ui.dart';

/// Unidades / campi (somente admin): separam salas, recursos, gestores e relatórios.
class UnitsScreen extends StatefulWidget {
  const UnitsScreen({super.key});

  @override
  State<UnitsScreen> createState() => _UnitsScreenState();
}

class _UnitsScreenState extends State<UnitsScreen> {
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
      final data = await ApiClient.instance.get('/units') as List;
      if (mounted) {
        setState(() => _items = data.map((e) => Map<String, dynamic>.from(e as Map)).toList());
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _edit([Map<String, dynamic>? u]) async {
    final name = TextEditingController(text: u?['name'] as String? ?? '');
    final code = TextEditingController(text: u?['code'] as String? ?? '');
    final tz = TextEditingController(text: u?['timezone'] as String? ?? '');
    final grace = TextEditingController(text: '${u?['noShowGraceMinutes'] ?? 0}');
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(u == null ? 'Nova unidade' : 'Editar unidade'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: name, decoration: const InputDecoration(labelText: 'Nome')),
            TextField(
                controller: code,
                enabled: u == null,
                decoration: const InputDecoration(labelText: 'Código (ex.: CTR)')),
            TextField(
                controller: tz,
                decoration: const InputDecoration(
                    labelText: 'Fuso (ex.: America/Manaus) — vazio = padrão')),
            TextField(
                controller: grace,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                    labelText: 'No-show: cancelar após N min sem check-in (0 = desligado)')),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Salvar')),
        ],
      ),
    );
    if (ok != true) return;
    final body = {
      'name': name.text.trim(),
      if (tz.text.trim().isNotEmpty) 'timezone': tz.text.trim(),
      'noShowGraceMinutes': int.tryParse(grace.text.trim()) ?? 0,
      if (u == null) 'code': code.text.trim(),
    };
    try {
      if (u == null) {
        await ApiClient.instance.post('/units', body);
      } else {
        await ApiClient.instance.patch('/units/${u['id']}', body);
      }
      _load();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  Future<void> _delete(Map<String, dynamic> u) async {
    if (!await confirm(context, 'Excluir unidade', 'Excluir "${u['name']}"?', action: 'Excluir')) return;
    try {
      await ApiClient.instance.delete('/units/${u['id']}');
      _load();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton:
          FloatingActionButton(onPressed: () => _edit(), child: const Icon(Icons.add)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _items.isEmpty
                      ? ListView(children: const [
                          SizedBox(height: 48),
                          Center(child: Text('Nenhuma unidade. Sem unidades, tudo é global.')),
                        ])
                      : ListView.separated(
                          itemCount: _items.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (_, i) {
                            final u = _items[i];
                            return ListTile(
                              leading: const Icon(Icons.apartment),
                              title: Text('${u['name']} (${u['code']})'),
                              subtitle: Text(
                                  '${u['timezone'] ?? 'fuso padrão'} · no-show: ${(u['noShowGraceMinutes'] ?? 0) == 0 ? 'desligado' : '${u['noShowGraceMinutes']} min'}'),
                              trailing: PopupMenuButton<String>(
                                onSelected: (v) => v == 'edit' ? _edit(u) : _delete(u),
                                itemBuilder: (_) => const [
                                  PopupMenuItem(value: 'edit', child: Text('Editar')),
                                  PopupMenuItem(value: 'delete', child: Text('Excluir')),
                                ],
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}
