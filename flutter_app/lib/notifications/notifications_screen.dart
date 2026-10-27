import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/ui.dart';

class NotificationsScreen extends StatefulWidget {
  final VoidCallback? onChanged;
  const NotificationsScreen({super.key, this.onChanged});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
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
      final data = await ApiClient.instance.get('/notifications', query: {'limit': 100});
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

  Future<void> _read(Map<String, dynamic> n) async {
    if (n['readAt'] != null) return;
    try {
      await ApiClient.instance.post('/notifications/${n['id']}/read');
      widget.onChanged?.call();
      _load();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  Future<void> _readAll() async {
    try {
      await ApiClient.instance.post('/notifications/read-all');
      widget.onChanged?.call();
      _load();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  IconData _icon(String type) {
    switch (type) {
      case 'WAITLIST_SLOT_FREE':
        return Icons.hourglass_bottom;
      case 'RESERVATION_CANCELLED':
      case 'SERIES_CANCELLED':
        return Icons.event_busy;
      case 'RESERVATION_RESCHEDULED':
        return Icons.update;
      case 'RESERVATION_AFFECTED':
        return Icons.build;
      default:
        return Icons.event_available;
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
                  child: ListView(children: [
                    if (_items.any((n) => n['readAt'] == null))
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                            onPressed: _readAll,
                            child: const Text('Marcar todas como lidas')),
                      ),
                    if (_items.isEmpty)
                      const Padding(
                          padding: EdgeInsets.all(48),
                          child: Center(child: Text('Nenhuma notificação.'))),
                    for (final n in _items)
                      ListTile(
                        leading: Icon(_icon(n['type'] as String),
                            color: n['readAt'] == null ? Colors.blue : Colors.grey),
                        title: Text(n['title'] as String,
                            style: TextStyle(
                                fontWeight: n['readAt'] == null
                                    ? FontWeight.bold
                                    : FontWeight.normal)),
                        subtitle: Text(
                            '${n['body'] ?? ''}\n${fmtDate(DateTime.parse(n['createdAt'] as String).toLocal())} ${fmtTime(DateTime.parse(n['createdAt'] as String).toLocal())}'),
                        isThreeLine: true,
                        onTap: () => _read(n),
                      ),
                  ]),
                ),
    );
  }
}
