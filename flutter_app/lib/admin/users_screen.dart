import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/models.dart';
import '../core/session.dart';
import '../core/ui.dart';

/// Aprovação de cadastros e gestão de perfis (somente admin).
class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key});

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  List<AppUser> _users = [];
  bool _onlyPending = true;
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
      final data = await ApiClient.instance
          .get('/users', query: {if (_onlyPending) 'status': 'PENDING'});
      final list = (data as List)
          .map((e) => AppUser.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList();
      if (mounted) setState(() => _users = list);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _patch(AppUser u, Map<String, dynamic> body) async {
    try {
      await ApiClient.instance.patch('/users/${u.id}', body);
      _load();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  Future<void> _editUnits(AppUser u) async {
    try {
      final units = (await ApiClient.instance.get('/units') as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      final sel = <String>{...u.unitIds};
      if (!mounted) return;
      final ok = await showDialog<bool>(
        context: context,
        builder: (_) => StatefulBuilder(
          builder: (ctx, setLocal) => AlertDialog(
            title: Text('Unidades de ${u.name}'),
            content: SizedBox(
              width: 320,
              child: ListView(shrinkWrap: true, children: [
                if (units.isEmpty) const Text('Nenhuma unidade cadastrada.'),
                for (final un in units)
                  CheckboxListTile(
                    value: sel.contains(un['id']),
                    title: Text(un['name'] as String),
                    onChanged: (v) => setLocal(() {
                      if (v == true) {
                        sel.add(un['id'] as String);
                      } else {
                        sel.remove(un['id']);
                      }
                    }),
                  ),
              ]),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Salvar')),
            ],
          ),
        ),
      );
      if (ok == true) await _patch(u, {'unitIds': sel.toList()});
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = Session.user!;
    return Column(children: [
      Padding(
        padding: const EdgeInsets.all(8),
        child: SegmentedButton<bool>(
          segments: const [
            ButtonSegment(value: true, label: Text('Pendentes')),
            ButtonSegment(value: false, label: Text('Todos')),
          ],
          selected: {_onlyPending},
          onSelectionChanged: (s) {
            setState(() => _onlyPending = s.first);
            _load();
          },
        ),
      ),
      if (_loading) const LinearProgressIndicator(),
      Expanded(
        child: _error != null
            ? Center(child: Text(_error!))
            : RefreshIndicator(
                onRefresh: _load,
                child: _users.isEmpty
                    ? ListView(children: const [
                        SizedBox(height: 48),
                        Center(child: Text('Nenhum usuário.')),
                      ])
                    : ListView.separated(
                        itemCount: _users.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (_, i) {
                          final u = _users[i];
                          final pending = u.status == 'PENDING';
                          return ListTile(
                            title: Text(u.name),
                            subtitle: Text(
                              '${u.email}\n'
                              '${userStatusLabels[u.status]} · ${roleLabels[u.role]}'
                              '${pending && u.requestedRole != null ? ' · pediu: ${roleLabels[u.requestedRole]}' : ''}',
                            ),
                            isThreeLine: true,
                            trailing: u.id == me.id
                                ? null
                                : PopupMenuButton<String>(
                                    onSelected: (v) {
                                      switch (v) {
                                        case 'viewer':
                                          _patch(u, {'role': 'VIEWER', 'status': 'ACTIVE'});
                                        case 'reserver':
                                          _patch(u, {'role': 'RESERVER', 'status': 'ACTIVE'});
                                        case 'manager':
                                          _patch(u, {'role': 'MANAGER', 'status': 'ACTIVE'});
                                        case 'units':
                                          _editUnits(u);
                                        case 'admin':
                                          _patch(u, {'role': 'ADMIN', 'status': 'ACTIVE'});
                                        case 'reject':
                                          _patch(u, {'status': 'REJECTED'});
                                        case 'disable':
                                          _patch(u, {'status': 'DISABLED'});
                                      }
                                    },
                                    itemBuilder: (_) => [
                                      const PopupMenuItem(value: 'viewer', child: Text('Ativar como quem consulta')),
                                      const PopupMenuItem(value: 'reserver', child: Text('Ativar como quem marca')),
                                      const PopupMenuItem(value: 'manager', child: Text('Ativar como gestor')),
                                      const PopupMenuItem(value: 'admin', child: Text('Ativar como administrador')),
                                      const PopupMenuItem(value: 'units', child: Text('Definir unidades')),
                                      if (pending)
                                        const PopupMenuItem(value: 'reject', child: Text('Recusar')),
                                      if (u.status == 'ACTIVE')
                                        const PopupMenuItem(value: 'disable', child: Text('Desativar')),
                                    ],
                                  ),
                          );
                        },
                      ),
              ),
      ),
    ]);
  }
}
