import 'dart:async';

import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/models.dart';

/// Busca usuários ativos e devolve o escolhido (ou null).
class UserPickerDialog extends StatefulWidget {
  final Set<String> excludeIds;
  const UserPickerDialog({super.key, this.excludeIds = const {}});

  static Future<AppUser?> show(BuildContext context,
          {Set<String> excludeIds = const {}}) =>
      showDialog<AppUser>(
          context: context,
          builder: (_) => UserPickerDialog(excludeIds: excludeIds));

  @override
  State<UserPickerDialog> createState() => _UserPickerDialogState();
}

class _UserPickerDialogState extends State<UserPickerDialog> {
  List<AppUser> _results = [];
  bool _loading = true;
  String? _error;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _search('');
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _search(String q) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await ApiClient.instance.get('/users/lookup', query: {'q': q});
      final list = (data as List)
          .map((e) => AppUser.fromJson(Map<String, dynamic>.from(e as Map)))
          .where((u) => !widget.excludeIds.contains(u.id))
          .toList();
      if (mounted) setState(() => _results = list);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Quem poderá consultar?'),
      content: SizedBox(
        width: 360,
        height: 360,
        child: Column(
          children: [
            TextField(
              autofocus: true,
              decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search), hintText: 'Nome ou e-mail'),
              onChanged: (v) {
                _debounce?.cancel();
                _debounce =
                    Timer(const Duration(milliseconds: 350), () => _search(v));
              },
            ),
            const SizedBox(height: 8),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? Center(child: Text(_error!))
                      : _results.isEmpty
                          ? const Center(child: Text('Ninguém encontrado.'))
                          : ListView.builder(
                              itemCount: _results.length,
                              itemBuilder: (_, i) {
                                final u = _results[i];
                                return ListTile(
                                  title: Text(u.name),
                                  subtitle: Text(
                                      '${u.email} · ${roleLabels[u.role] ?? u.role}'),
                                  onTap: () => Navigator.pop(context, u),
                                );
                              },
                            ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context), child: const Text('Fechar')),
      ],
    );
  }
}
