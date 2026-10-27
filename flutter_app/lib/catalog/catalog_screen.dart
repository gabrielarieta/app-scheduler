import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/models.dart';
import '../core/session.dart';
import '../core/ui.dart';
import 'catalog_form_screen.dart';

const catalogPaths = {
  'ROOM': '/rooms',
  'RESOURCE': '/resources',
  'COMBINATION': '/combinations',
};

/// Lista salas, recursos ou combinações. Só o admin cadastra/edita.
class CatalogScreen extends StatefulWidget {
  final String kind;
  const CatalogScreen({super.key, required this.kind});

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  List<CatalogItem> _items = [];
  bool _loading = true;
  String? _error;

  String get _path => catalogPaths[widget.kind]!;
  bool get _isAdmin => Session.user!.canManage;

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
      final data = await ApiClient.instance.get(_path);
      final list = (data as List)
          .map((e) =>
              CatalogItem.fromJson(widget.kind, Map<String, dynamic>.from(e as Map)))
          .toList();
      if (mounted) setState(() => _items = list);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openForm([CatalogItem? item]) async {
    final saved = await Navigator.push<bool>(
        context,
        MaterialPageRoute(
            builder: (_) => CatalogFormScreen(kind: widget.kind, item: item)));
    if (saved == true) _load();
  }

  Future<void> _changeStatus(CatalogItem item) async {
    String status = item.status;
    bool cancelAffected = false;
    final note = TextEditingController(text: item.statusNote ?? '');
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text('Status de ${item.name}'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
              value: status,
              items: [
                for (final e in statusLabels.entries)
                  DropdownMenuItem(value: e.key, child: Text(e.value)),
              ],
              onChanged: (v) => setLocal(() => status = v!),
            ),
            if (status != 'AVAILABLE')
              TextField(
                controller: note,
                decoration: const InputDecoration(labelText: 'Motivo (opcional)'),
              ),
            if (status != 'AVAILABLE')
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Cancelar reservas futuras afetadas'),
                subtitle: const Text('As pessoas são avisadas em ambos os casos.'),
                value: cancelAffected,
                onChanged: (v) => setLocal(() => cancelAffected = v ?? false),
              ),
          ]),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancelar')),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Salvar')),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      final res = await ApiClient.instance.patch('$_path/${item.id}/status', {
        'status': status,
        if (status != 'AVAILABLE' && note.text.trim().isNotEmpty)
          'statusNote': note.text.trim(),
        if (status != 'AVAILABLE' && cancelAffected)
          'cancelAffectedReservations': true,
      }) as Map;
      final affected = (res['affectedReservations'] ?? 0) as int;
      final cancelled = (res['cancelledReservations'] ?? 0) as int;
      if (mounted) {
        showSnack(
            context,
            affected > 0
                ? (cancelled > 0
                    ? 'Status atualizado. $cancelled reserva(s) cancelada(s) e pessoas avisadas.'
                    : 'Status atualizado. $affected reserva(s) futura(s) afetada(s); as pessoas foram avisadas.')
                : 'Status atualizado.');
      }
      _load();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  Future<void> _delete(CatalogItem item) async {
    final ok = await confirm(context, 'Excluir',
        'Excluir "${item.name}"? Reservas antigas continuam guardadas com os dados da época.',
        action: 'Excluir');
    if (!ok) return;
    try {
      await ApiClient.instance.delete('$_path/${item.id}');
      _load();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: _isAdmin
          ? FloatingActionButton(
              onPressed: () => _openForm(), child: const Icon(Icons.add))
          : null,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text(_error!),
                    TextButton(onPressed: _load, child: const Text('Tentar de novo')),
                  ]),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _items.isEmpty
                      ? ListView(children: const [
                          SizedBox(height: 48),
                          Center(child: Text('Nada cadastrado ainda.')),
                        ])
                      : ListView.separated(
                          padding: const EdgeInsets.only(bottom: 88),
                          itemCount: _items.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (_, i) => _tile(_items[i]),
                        ),
                ),
    );
  }

  Widget _tile(CatalogItem item) {
    return ListTile(
      isThreeLine: true,
      title: Row(children: [
        Flexible(child: Text(item.name)),
        const SizedBox(width: 8),
        StatusChip(item.status),
      ]),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (item.subtitle.isNotEmpty) Text(item.subtitle),
        if (item.statusNote != null && !item.isAvailable)
          Text(item.statusNote!, style: const TextStyle(fontStyle: FontStyle.italic)),
        Text(
          item.availability.isEmpty
              ? 'Sem horários cadastrados'
              : item.availability.join(' · '),
          style: const TextStyle(fontSize: 12),
        ),
      ]),
      trailing: _isAdmin
          ? PopupMenuButton<String>(
              onSelected: (v) {
                if (v == 'edit') _openForm(item);
                if (v == 'status') _changeStatus(item);
                if (v == 'delete') _delete(item);
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'edit', child: Text('Editar')),
                PopupMenuItem(value: 'status', child: Text('Alterar status')),
                PopupMenuItem(value: 'delete', child: Text('Excluir')),
              ],
            )
          : null,
    );
  }
}
