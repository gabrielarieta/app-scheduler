import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/models.dart';
import '../core/ui.dart';

/// Reservas de itens sensíveis aguardando decisão (gestor da unidade / admin).
class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key});

  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  List<Reservation> _items = [];
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
      final data = await ApiClient.instance.get('/reservations/pending-approval') as List;
      if (mounted) {
        setState(() => _items = data
            .map((e) => Reservation.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList());
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _decide(Reservation r, bool approve) async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(approve ? 'Aprovar reserva' : 'Recusar reserva'),
        content: TextField(
            controller: note,
            decoration: InputDecoration(
                labelText: approve ? 'Observação (opcional)' : 'Motivo (opcional)')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: Text(approve ? 'Aprovar' : 'Recusar')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ApiClient.instance.post('/reservations/${r.id}/${approve ? 'approve' : 'reject'}',
          {if (note.text.trim().isNotEmpty) 'note': note.text.trim()});
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
                          Center(child: Text('Nenhuma reserva aguardando aprovação.')),
                        ])
                      : ListView.separated(
                          itemCount: _items.length,
                          separatorBuilder: (_, __) => const Divider(height: 1),
                          itemBuilder: (_, i) {
                            final r = _items[i];
                            return ListTile(
                              isThreeLine: true,
                              title: Text(r.title),
                              subtitle: Text(
                                  '${r.targetLabel}\n${fmtDate(r.start)} ${fmtRange(r.start, r.end)} · por ${r.createdByName}'),
                              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                                IconButton(
                                    tooltip: 'Recusar',
                                    icon: const Icon(Icons.close, color: Colors.red),
                                    onPressed: () => _decide(r, false)),
                                IconButton(
                                    tooltip: 'Aprovar',
                                    icon: const Icon(Icons.check, color: Colors.green),
                                    onPressed: () => _decide(r, true)),
                              ]),
                            );
                          },
                        ),
                ),
    );
  }
}
