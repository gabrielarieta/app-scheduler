import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/ui.dart';

/// Quem fez o quê e quando (somente admin).
class AuditScreen extends StatefulWidget {
  const AuditScreen({super.key});

  @override
  State<AuditScreen> createState() => _AuditScreenState();
}

class _AuditScreenState extends State<AuditScreen> {
  static const _pageSize = 100;
  final List<Map<String, dynamic>> _items = [];
  int _page = 1;
  bool _hasMore = true;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadMore();
  }

  Future<void> _loadMore() async {
    setState(() => _loading = true);
    try {
      final data = await ApiClient.instance
          .get('/audit', query: {'page': _page, 'limit': _pageSize}) as List;
      if (!mounted) return;
      setState(() {
        _items.addAll(data.map((e) => Map<String, dynamic>.from(e as Map)));
        _hasMore = data.length == _pageSize;
        _page++;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) return Center(child: Text(_error!));
    return Scaffold(
      body: ListView.separated(
        itemCount: _items.length + 1,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (_, i) {
          if (i == _items.length) {
            if (_loading) {
              return const Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(child: CircularProgressIndicator()));
            }
            return _hasMore
                ? TextButton(onPressed: _loadMore, child: const Text('Carregar mais'))
                : const SizedBox(height: 24);
          }
          final l = _items[i];
          final at = DateTime.parse(l['at'] as String).toLocal();
          return ListTile(
            dense: true,
            title: Text('${l['method']} ${l['route']}'),
            subtitle: Text(
                '${l['actorName'] ?? 'anônimo'} (${l['actorRole'] ?? '-'}) · ${fmtDate(at)} ${fmtTime(at)} · HTTP ${l['statusCode']}'),
          );
        },
      ),
    );
  }
}
