import 'dart:math';

import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/models.dart';
import '../core/ui.dart';
import '../widgets/user_picker_dialog.dart';

class BookingScreen extends StatefulWidget {
  final DateTime initialDate;
  const BookingScreen({super.key, required this.initialDate});

  @override
  State<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends State<BookingScreen> {
  String _type = 'ROOM';
  final Map<String, List<CatalogItem>> _items = {};
  CatalogItem? _target;
  late DateTime _date = widget.initialDate;
  TimeOfDay _start = const TimeOfDay(hour: 9, minute: 0);
  TimeOfDay _end = const TimeOfDay(hour: 10, minute: 0);
  final _title = TextEditingController();
  final _notes = TextEditingController();
  final List<AppUser> _viewers = [];
  List<Map<String, DateTime>> _busy = [];
  bool _loadingCatalog = true;
  bool _saving = false;
  bool _repeat = false;
  int _occurrences = 4;
  // Chave de idempotência: se a rede falhar e o app repetir o envio, não duplica a reserva.
  String _idemKey = _newKey();
  static String _newKey() =>
      '${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(0x7fffffff)}';

  static const _paths = {
    'ROOM': '/rooms',
    'RESOURCE': '/resources',
    'COMBINATION': '/combinations',
  };

  @override
  void initState() {
    super.initState();
    _loadCatalog();
  }

  @override
  void dispose() {
    _title.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _loadCatalog() async {
    try {
      for (final t in _paths.keys) {
        final data = await ApiClient.instance.get(_paths[t]!);
        _items[t] = (data as List)
            .map((e) => CatalogItem.fromJson(t, Map<String, dynamic>.from(e as Map)))
            .toList();
      }
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _loadingCatalog = false);
    }
  }

  DateTime _at(TimeOfDay t) =>
      DateTime(_date.year, _date.month, _date.day, t.hour, t.minute);

  Future<void> _loadBusy() async {
    if (_target == null) return;
    try {
      final from = DateTime(_date.year, _date.month, _date.day);
      final data = await ApiClient.instance.get('/reservations/busy', query: {
        'targetType': _type,
        'targetId': _target!.id,
        'from': from.toUtc().toIso8601String(),
        'to': from.add(const Duration(days: 1)).toUtc().toIso8601String(),
      }) as Map;
      final list = (data['busy'] as List).map((b) {
        final m = b as Map;
        return {
          'start': DateTime.parse(m['start'] as String).toLocal(),
          'end': DateTime.parse(m['end'] as String).toLocal(),
        };
      }).toList();
      if (mounted) setState(() => _busy = list);
    } on ApiException {
      if (mounted) setState(() => _busy = []);
    }
  }

  Future<void> _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (d != null) {
      setState(() => _date = d);
      _loadBusy();
    }
  }

  Future<void> _pickTime(bool isStart) async {
    final t = await showTimePicker(
        context: context, initialTime: isStart ? _start : _end);
    if (t == null) return;
    setState(() {
      if (isStart) {
        _start = t;
      } else {
        _end = t;
      }
    });
  }

  Future<void> _addViewer() async {
    final picked = await UserPickerDialog.show(context,
        excludeIds: _viewers.map((v) => v.id).toSet());
    if (picked != null) setState(() => _viewers.add(picked));
  }

  Future<void> _showSkipped(List skipped) => showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Algumas datas foram puladas'),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final s in skipped)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                        '${fmtDate(DateTime.parse(s['start'] as String).toLocal())}: ${s['reason']}'),
                  ),
              ],
            ),
          ),
          actions: [
            FilledButton(
                onPressed: () => Navigator.pop(context), child: const Text('OK')),
          ],
        ),
      );

  void _showError(ApiException e) {
    final canWait = e.statusCode == 409 &&
        e.message.contains('reserva neste horário') &&
        !_repeat;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(e.message),
        backgroundColor: Colors.red.shade700,
        action: canWait
            ? SnackBarAction(
                label: 'Lista de espera',
                textColor: Colors.white,
                onPressed: _joinWaitlist)
            : null,
      ));
  }

  Future<void> _joinWaitlist() async {
    try {
      await ApiClient.instance.post('/waitlist', {
        'targetType': _type,
        if (_type == 'ROOM') 'roomId': _target!.id,
        if (_type == 'RESOURCE') 'resourceId': _target!.id,
        if (_type == 'COMBINATION') 'combinationId': _target!.id,
        'start': _at(_start).toUtc().toIso8601String(),
        'end': _at(_end).toUtc().toIso8601String(),
      });
      if (mounted) showSnack(context, 'Você será avisado se o horário ficar livre.');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  Future<void> _save() async {
    if (_target == null) {
      showSnack(context, 'Escolha o que deseja reservar.', error: true);
      return;
    }
    if (_title.text.trim().length < 2) {
      showSnack(context, 'Informe um título para a reserva.', error: true);
      return;
    }
    final start = _at(_start);
    final end = _at(_end);
    if (!end.isAfter(start)) {
      showSnack(context, 'O fim deve ser depois do início.', error: true);
      return;
    }
    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'targetType': _type,
        if (_type == 'ROOM') 'roomId': _target!.id,
        if (_type == 'RESOURCE') 'resourceId': _target!.id,
        if (_type == 'COMBINATION') 'combinationId': _target!.id,
        'start': start.toUtc().toIso8601String(),
        'end': end.toUtc().toIso8601String(),
        'title': _title.text.trim(),
        if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
        'viewerIds': _viewers.map((v) => v.id).toList(),
      };
      final headers = {'Idempotency-Key': _idemKey};
      if (_repeat) {
        final res = await ApiClient.instance.post('/reservations/series',
            {...body, 'occurrences': _occurrences}, headers) as Map;
        final skipped = (res['skipped'] as List?) ?? [];
        if (mounted && skipped.isNotEmpty) await _showSkipped(skipped);
      } else {
        await ApiClient.instance.post('/reservations', body, headers);
      }
      if (!mounted) return;
      Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (e.statusCode != 0) _idemKey = _newKey(); // falha definitiva: próxima tentativa é nova
      if (mounted) _showError(e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final options =
        (_items[_type] ?? []).where((i) => i.isAvailable).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Nova reserva')),
      body: _loadingCatalog
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'ROOM', label: Text('Sala')),
                    ButtonSegment(value: 'RESOURCE', label: Text('Recurso')),
                    ButtonSegment(value: 'COMBINATION', label: Text('Sala + Rec.')),
                  ],
                  selected: {_type},
                  onSelectionChanged: (s) => setState(() {
                    _type = s.first;
                    _target = null;
                    _busy = [];
                  }),
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<CatalogItem>(
                  value: _target,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: targetLabels[_type],
                    helperText: options.isEmpty
                        ? 'Nada disponível para reserva neste tipo.'
                        : null,
                  ),
                  items: [
                    for (final i in options)
                      DropdownMenuItem(value: i, child: Text(i.name)),
                  ],
                  onChanged: (v) {
                    setState(() => _target = v);
                    _loadBusy();
                  },
                ),
                if (_target != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Disponível: ${_target!.availability.isEmpty ? "—" : _target!.availability.join(" · ")}',
                    style: const TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                  if (_type == 'COMBINATION')
                    const Text(
                      'A combinação também precisa respeitar a agenda da sala e do recurso.',
                      style: TextStyle(fontSize: 12, color: Colors.grey),
                    ),
                ],
                const SizedBox(height: 16),
                Row(children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _pickDate,
                      icon: const Icon(Icons.calendar_today),
                      label: Text(fmtDate(_date)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton(
                      onPressed: () => _pickTime(true),
                      child: Text(timeOfDayToHHmm(_start))),
                  const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 6),
                      child: Text('–')),
                  OutlinedButton(
                      onPressed: () => _pickTime(false),
                      child: Text(timeOfDayToHHmm(_end))),
                ]),
                if (_busy.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Já ocupado neste dia: ${_busy.map((b) => fmtRange(b['start']!, b['end']!)).join(", ")}',
                    style: const TextStyle(color: Colors.orange),
                  ),
                ],
                const SizedBox(height: 16),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Repetir semanalmente'),
                  value: _repeat,
                  onChanged: (v) => setState(() => _repeat = v),
                ),
                if (_repeat)
                  DropdownButtonFormField<int>(
                    value: _occurrences,
                    decoration: const InputDecoration(labelText: 'Quantidade de semanas'),
                    items: [
                      for (final n in [2, 3, 4, 6, 8, 10, 12, 24, 52])
                        DropdownMenuItem(value: n, child: Text('$n semanas')),
                    ],
                    onChanged: (v) => setState(() => _occurrences = v!),
                  ),
                TextField(
                    controller: _title,
                    decoration: const InputDecoration(labelText: 'Título')),
                TextField(
                    controller: _notes,
                    maxLines: 2,
                    decoration:
                        const InputDecoration(labelText: 'Observações (opcional)')),
                const SizedBox(height: 16),
                Row(children: [
                  Text('Quem poderá consultar',
                      style: Theme.of(context).textTheme.titleSmall),
                  const Spacer(),
                  TextButton.icon(
                      onPressed: _addViewer,
                      icon: const Icon(Icons.person_add),
                      label: const Text('Adicionar')),
                ]),
                Wrap(spacing: 8, children: [
                  for (final v in _viewers)
                    InputChip(
                      label: Text(v.name),
                      onDeleted: () => setState(() => _viewers.remove(v)),
                    ),
                ]),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: _saving
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Reservar'),
                ),
              ],
            ),
    );
  }
}
