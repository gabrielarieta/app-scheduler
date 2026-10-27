import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../checkin/scan_screen.dart';
import '../core/api_client.dart';
import '../core/models.dart';
import '../core/session.dart';
import '../core/ui.dart';
import '../widgets/user_picker_dialog.dart';

class ReservationDetailScreen extends StatefulWidget {
  final Reservation reservation;
  const ReservationDetailScreen({super.key, required this.reservation});

  @override
  State<ReservationDetailScreen> createState() =>
      _ReservationDetailScreenState();
}

class _ReservationDetailScreenState extends State<ReservationDetailScreen> {
  late Reservation _r = widget.reservation;
  bool _changed = false;
  bool _busy = false;

  bool get _canManage {
    final u = Session.user!;
    return _r.status == 'ACTIVE' && (u.canManage || u.id == _r.createdBy);
  }

  Future<void> _run(Future<dynamic> Function() action) async {
    setState(() => _busy = true);
    try {
      final res = await action();
      if (res is Map) {
        _r = Reservation.fromJson(Map<String, dynamic>.from(res));
      }
      _changed = true;
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Viewer? get _me {
    final id = Session.user!.id;
    for (final v in _r.viewers) {
      if (v.userId == id) return v;
    }
    return null;
  }

  bool get _canConfirm =>
      _me != null && _r.status == 'ACTIVE' && _r.end.isAfter(DateTime.now());

  /// Confirma (ou desfaz) a própria presença. O servidor recusa se houver
  /// outra reserva confirmada no mesmo horário e explica qual.
  Future<void> _toggleAttendance() async {
    final confirmed = _me?.confirmedAt != null;
    await _run(() => confirmed
        ? ApiClient.instance.delete('/reservations/${_r.id}/attendance')
        : ApiClient.instance.post('/reservations/${_r.id}/attendance'));
  }

  Future<void> _addViewer() async {
    final picked = await UserPickerDialog.show(context, excludeIds: {
      _r.createdBy,
      ..._r.viewers.map((v) => v.userId),
    });
    if (picked == null) return;
    await _run(() => ApiClient.instance
        .post('/reservations/${_r.id}/viewers', {'userIds': [picked.id]}));
  }

  Future<void> _removeViewer(Viewer v) async {
    await _run(() =>
        ApiClient.instance.delete('/reservations/${_r.id}/viewers/${v.userId}'));
  }

  Future<void> _startReservation() async {
    await _run(() => ApiClient.instance.post('/reservations/${_r.id}/start'));
  }

  bool get _canCheckIn {
    final now = DateTime.now();
    return _me != null &&
        _r.status == 'ACTIVE' &&
        now.isAfter(_r.start.subtract(const Duration(minutes: 15))) &&
        now.isBefore(_r.end);
  }

  /// Consultor: escaneia o QR (ou digita o código) exibido pelo organizador.
  Future<void> _checkIn() async {
    final code = await Navigator.push<String>(
        context, MaterialPageRoute(builder: (_) => const ScanScreen()));
    if (code == null) return;
    await _run(() =>
        ApiClient.instance.post('/reservations/${_r.id}/check-in', {'code': code}));
  }

  /// Organizador: mostra o QR/código para os consultores.
  Future<void> _showCode() async {
    try {
      final r = await ApiClient.instance
          .get('/reservations/${_r.id}/check-in-code') as Map;
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Check-in'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            QrImageView(data: r['qr'] as String, size: 200),
            const SizedBox(height: 8),
            Text(r['code'] as String,
                style: const TextStyle(fontSize: 32, letterSpacing: 6, fontWeight: FontWeight.bold)),
            const Text('O código muda a cada 5 minutos.', style: TextStyle(fontSize: 12)),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context), child: const Text('Fechar')),
          ],
        ),
      );
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  Future<void> _cancelSeries() async {
    final ok = await confirm(context, 'Cancelar série',
        'Todas as reservas futuras desta série serão canceladas.',
        action: 'Cancelar série');
    if (!ok) return;
    try {
      await ApiClient.instance.post('/reservations/series/${_r.seriesId}/cancel');
      _changed = true;
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  Future<void> _cancel() async {
    final ok = await confirm(context, 'Cancelar reserva',
        'A reserva "${_r.title}" será cancelada e o horário ficará livre.',
        action: 'Cancelar reserva');
    if (!ok) return;
    await _run(() => ApiClient.instance.post('/reservations/${_r.id}/cancel'));
    if (mounted && _r.status == 'CANCELLED') Navigator.pop(context, true);
  }

  @override
  Widget build(BuildContext context) {
    final room = _r.snapshot['room'] as Map?;
    final res = _r.snapshot['resource'] as Map?;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.pop(context, _changed);
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Reserva')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(_r.title, style: Theme.of(context).textTheme.headlineSmall),
            if (_r.status == 'CANCELLED')
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _r.cancelReason == 'NO_SHOW'
                      ? 'CANCELADA — no-show (ninguém fez check-in)'
                      : _r.cancelReason == 'REJECTED'
                          ? 'RECUSADA'
                          : _r.cancelReason == 'EXPIRED'
                              ? 'EXPIRADA (não foi aprovada a tempo)'
                              : 'CANCELADA',
                  style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold),
                ),
              ),
            if (_r.approvalStatus == 'PENDING')
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text('AGUARDANDO APROVAÇÃO',
                    style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold)),
              ),
            const SizedBox(height: 16),
            _row(Icons.schedule, '${fmtDate(_r.start)}  ${fmtRange(_r.start, _r.end)}'),
            _row(Icons.category, targetLabels[_r.targetType] ?? _r.targetType),
            if (room != null)
              _row(Icons.meeting_room,
                  '${room['name']}${room['location'] != null ? ' · ${room['location']}' : ''}'),
            if (res != null)
              _row(Icons.devices_other,
                  '${res['name']}${res['type'] != null ? ' (${res['type']})' : ''}'),
            _row(Icons.person, 'Marcada por ${_r.createdByName}'),
            if ((_r.notes ?? '').isNotEmpty) _row(Icons.notes, _r.notes!),
            const SizedBox(height: 8),
            const Text(
              'Os dados de sala/recurso acima ficam gravados como estavam no momento da marcação.',
              style: TextStyle(fontSize: 12, color: Colors.grey),
            ),
            if (_canConfirm) ...[
              const SizedBox(height: 16),
              Card(
                child: ListTile(
                  leading: Icon(
                    _me!.confirmedAt != null ? Icons.check_circle : Icons.how_to_reg,
                    color: _me!.confirmedAt != null ? Colors.green : null,
                  ),
                  title: Text(_me!.confirmedAt != null
                      ? 'Presença confirmada'
                      : 'Confirmar minha presença'),
                  subtitle: const Text(
                      'Não é possível confirmar duas reservas no mesmo horário.'),
                  trailing: FilledButton.tonal(
                    onPressed: _busy ? null : _toggleAttendance,
                    child: Text(_me!.confirmedAt != null ? 'Cancelar' : 'Confirmar'),
                  ),
                ),
              ),
            ],
            if (_canCheckIn)
              Card(
                child: ListTile(
                  leading: Icon(
                    _me!.checkedInAt != null ? Icons.verified : Icons.qr_code_scanner,
                    color: _me!.checkedInAt != null ? Colors.green : null,
                  ),
                  title: Text(_me!.checkedInAt != null ? 'Check-in feito' : 'Fazer check-in'),
                  subtitle: const Text('Escaneie o QR do organizador ou digite o código.'),
                  trailing: _me!.checkedInAt != null
                      ? null
                      : FilledButton.tonal(
                          onPressed: _busy ? null : _checkIn, child: const Text('Check-in')),
                ),
              ),
            if (_canManage && _r.status == 'ACTIVE')
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _showCode,
                  icon: const Icon(Icons.qr_code),
                  label: const Text('Mostrar código de check-in'),
                ),
              ),
            if (_canManage && _r.status == 'ACTIVE' && _r.approvalStatus != 'PENDING')
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _busy || _r.startedAt != null ? null : _startReservation,
                  icon: Icon(_r.startedAt != null ? Icons.check_circle : Icons.play_arrow),
                  label: Text(_r.startedAt != null ? 'Reserva iniciada' : 'Iniciar reserva'),
                ),
              ),
            const Divider(height: 32),
            Row(
              children: [
                Text('Quem pode consultar (${_r.viewers.length})',
                    style: Theme.of(context).textTheme.titleMedium),
                const Spacer(),
                if (_canManage)
                  TextButton.icon(
                    onPressed: _busy ? null : _addViewer,
                    icon: const Icon(Icons.person_add),
                    label: const Text('Adicionar'),
                  ),
              ],
            ),
            if (_r.viewers.isEmpty) const Text('Ninguém adicionado ainda.'),
            for (final v in _r.viewers)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                    child: Icon(v.confirmedAt != null ? Icons.check : Icons.person)),
                title: Text(v.name),
                subtitle: Text([
                  v.email,
                  if (v.confirmedAt != null) 'presença confirmada',
                  if (v.checkedInAt != null) 'check-in feito',
                ].join(' · ')),
                trailing: _canManage
                    ? IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: _busy ? null : () => _removeViewer(v))
                    : null,
              ),
            if (_canManage) ...[
              const SizedBox(height: 24),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                onPressed: _busy ? null : _cancel,
                icon: const Icon(Icons.event_busy),
                label: const Text('Cancelar reserva'),
              ),
              if (_r.seriesId != null)
                TextButton.icon(
                  onPressed: _busy ? null : _cancelSeries,
                  icon: const Icon(Icons.event_repeat),
                  label: const Text('Cancelar toda a série (futuras)'),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _row(IconData icon, String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 20),
          const SizedBox(width: 12),
          Expanded(child: Text(text)),
        ]),
      );
}
