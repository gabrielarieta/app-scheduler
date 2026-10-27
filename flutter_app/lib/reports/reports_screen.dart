import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/models.dart';
import '../core/ui.dart';

/// Taxa de uso por sala/recurso, no-show e horários de pico (admin/gestor).
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  int _days = 30;
  String? _unitId;
  List<Map<String, dynamic>> _units = [];
  Map<String, dynamic>? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final u = await ApiClient.instance.get('/units') as List;
      _units = u.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {}
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final now = DateTime.now();
      final from = DateTime(now.year, now.month, now.day).subtract(Duration(days: _days));
      final data = await ApiClient.instance.get('/reports/occupancy', query: {
        'from': from.toUtc().toIso8601String(),
        'to': now.toUtc().toIso8601String(),
        if (_unitId != null) 'unitId': _unitId,
      });
      if (mounted) setState(() => _data = Map<String, dynamic>.from(data as Map));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _pct(dynamic v) => v == null ? '—' : '${((v as num) * 100).round()}%';

  Widget _rows(String title, List rows) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
          padding: const EdgeInsets.only(top: 16, bottom: 4),
          child: Text(title, style: Theme.of(context).textTheme.titleMedium)),
      for (final r in rows)
        ListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          title: Text(r['name'] as String),
          subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            LinearProgressIndicator(value: ((r['occupancyRate'] ?? 0) as num).toDouble().clamp(0.0, 1.0)),
            const SizedBox(height: 4),
            Text('${r['reservations']} reservas · no-show ${r['noShow']} (${_pct(r['noShowRate'])})'),
          ]),
          trailing: Text(_pct(r['occupancyRate']),
              style: const TextStyle(fontWeight: FontWeight.bold)),
        ),
    ]);
  }

  Widget _peak(Map<String, dynamic> peak) {
    final byHour = (peak['byHour'] as List).map((e) => (e as num).toDouble()).toList();
    final max = byHour.fold<double>(0, (m, v) => v > m ? v : m);
    final top = (peak['top'] as List);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
          padding: const EdgeInsets.only(top: 16, bottom: 8),
          child: Text('Horários de pico', style: Theme.of(context).textTheme.titleMedium)),
      SizedBox(
        height: 100,
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          for (var h = 0; h < 24; h++)
            Expanded(
              child: Tooltip(
                message: '${h}h: ${(byHour[h] / 60).toStringAsFixed(1)} h reservadas',
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 1),
                  height: max == 0 ? 2 : 2 + 96 * byHour[h] / max,
                  color: Theme.of(context).colorScheme.primary,
                ),
              ),
            ),
        ]),
      ),
      const Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text('0h', style: TextStyle(fontSize: 11)),
        Text('6h', style: TextStyle(fontSize: 11)),
        Text('12h', style: TextStyle(fontSize: 11)),
        Text('18h', style: TextStyle(fontSize: 11)),
        Text('23h', style: TextStyle(fontSize: 11)),
      ]),
      if (top.isNotEmpty) ...[
        const SizedBox(height: 8),
        for (final t in top)
          Text('${weekdayNames[t['weekday'] as int]} ${t['hour']}h — ${((t['minutes'] as num) / 60).toStringAsFixed(1)} h reservadas',
              style: const TextStyle(fontSize: 13)),
      ],
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          SegmentedButton<int>(
            segments: const [
              ButtonSegment(value: 7, label: Text('7 dias')),
              ButtonSegment(value: 30, label: Text('30 dias')),
              ButtonSegment(value: 90, label: Text('90 dias')),
            ],
            selected: {_days},
            onSelectionChanged: (s) {
              setState(() => _days = s.first);
              _load();
            },
          ),
          if (_units.length > 1)
            DropdownButtonFormField<String?>(
              value: _unitId,
              decoration: const InputDecoration(labelText: 'Unidade'),
              items: [
                const DropdownMenuItem(value: null, child: Text('Todas')),
                for (final u in _units) DropdownMenuItem(value: u['id'] as String, child: Text(u['name'] as String)),
              ],
              onChanged: (v) {
                setState(() => _unitId = v);
                _load();
              },
            ),
          if (_loading) const Padding(padding: EdgeInsets.all(24), child: LinearProgressIndicator()),
          if (_error != null) Padding(padding: const EdgeInsets.all(24), child: Text(_error!)),
          if (d != null && !_loading) ...[
            const SizedBox(height: 16),
            Wrap(spacing: 8, runSpacing: 8, children: [
              Chip(label: Text('${d['totals']['reservations']} reservas')),
              Chip(label: Text('${((d['totals']['reservedMinutes'] as num) / 60).toStringAsFixed(1)} h reservadas')),
              Chip(label: Text('no-show ${d['totals']['noShow']} (${_pct(d['totals']['noShowRate'])})')),
              Chip(label: Text('presenças ${d['totals']['attended']}')),
            ]),
            _rows('Salas', d['rooms'] as List),
            _rows('Recursos', d['resources'] as List),
            _peak(Map<String, dynamic>.from(d['peak'] as Map)),
          ],
        ]),
      ),
    );
  }
}
