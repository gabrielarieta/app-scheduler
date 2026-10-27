import 'package:flutter/material.dart';
import 'package:flutter_calendar_app_rest/core/models.dart';
import 'package:intl/intl.dart';

final _dateFmt = DateFormat('dd/MM/yyyy', 'pt_BR');
final _timeFmt = DateFormat('HH:mm', 'pt_BR');

String fmtDate(DateTime d) => _dateFmt.format(d);
String fmtTime(DateTime d) => _timeFmt.format(d);
String fmtRange(DateTime a, DateTime b) => '${fmtTime(a)} – ${fmtTime(b)}';

String timeOfDayToHHmm(TimeOfDay t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

TimeOfDay hhmmToTimeOfDay(String s) {
  final p = s.split(':').map(int.parse).toList();
  // "24:00" não é um TimeOfDay válido: mostramos 23:59 só na edição.
  if (p[0] >= 24) return const TimeOfDay(hour: 23, minute: 59);
  return TimeOfDay(hour: p[0], minute: p[1]);
}

Color statusColor(String status) {
  switch (status) {
    case 'AVAILABLE':
      return Colors.green;
    case 'MAINTENANCE':
      return Colors.orange;
    default:
      return Colors.red;
  }
}

void showSnack(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? Colors.red.shade700 : null,
    ));
}

Future<bool> confirm(BuildContext context, String title, String message,
    {String action = 'Confirmar'}) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (_) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar')),
        FilledButton(
            onPressed: () => Navigator.pop(context, true), child: Text(action)),
      ],
    ),
  );
  return r ?? false;
}

class StatusChip extends StatelessWidget {
  final String status;
  const StatusChip(this.status, {super.key});

  @override
  Widget build(BuildContext context) {
    final c = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: c.withOpacity(0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: c),
      ),
      child: Text(statusLabels[status] ?? status,
          style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}
