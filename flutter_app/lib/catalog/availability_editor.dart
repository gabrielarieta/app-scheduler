import 'package:flutter/material.dart';

import '../core/models.dart';
import '../core/ui.dart';

/// Edita a lista de janelas semanais (dia da semana + início + fim).
class AvailabilityEditor extends StatefulWidget {
  final List<Slot> slots;
  final VoidCallback onChanged;
  const AvailabilityEditor(
      {super.key, required this.slots, required this.onChanged});

  @override
  State<AvailabilityEditor> createState() => _AvailabilityEditorState();
}

class _AvailabilityEditorState extends State<AvailabilityEditor> {
  List<Slot> get _slots => widget.slots;

  void _changed() {
    setState(() {});
    widget.onChanged();
  }

  Future<void> _pick(Slot s, bool isStart) async {
    final t = await showTimePicker(
      context: context,
      initialTime: hhmmToTimeOfDay(isStart ? s.start : s.end),
    );
    if (t == null) return;
    if (isStart) {
      s.start = timeOfDayToHHmm(t);
    } else {
      s.end = timeOfDayToHHmm(t);
    }
    _changed();
  }

  void _add() {
    _slots.add(Slot(1, '08:00', '18:00'));
    _changed();
  }

  void _weekdaysPreset() {
    _slots
      ..clear()
      ..addAll([for (var d = 1; d <= 5; d++) Slot(d, '08:00', '18:00')]);
    _changed();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Text('Horários de disponibilidade',
              style: Theme.of(context).textTheme.titleSmall),
          const Spacer(),
          TextButton(
              onPressed: _weekdaysPreset, child: const Text('Seg–Sex 8h–18h')),
        ]),
        if (_slots.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text('Nenhum horário. Adicione ao menos um.',
                style: TextStyle(color: Colors.orange)),
          ),
        for (final s in _slots)
          Row(children: [
            Expanded(
              child: DropdownButton<int>(
                value: s.weekday,
                isExpanded: true,
                items: [
                  for (var i = 0; i < 7; i++)
                    DropdownMenuItem(value: i, child: Text(weekdayNames[i])),
                ],
                onChanged: (v) {
                  s.weekday = v!;
                  _changed();
                },
              ),
            ),
            TextButton(onPressed: () => _pick(s, true), child: Text(s.start)),
            const Text('–'),
            TextButton(onPressed: () => _pick(s, false), child: Text(s.end)),
            IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: () {
                _slots.remove(s);
                _changed();
              },
            ),
          ]),
        TextButton.icon(
            onPressed: _add,
            icon: const Icon(Icons.add),
            label: const Text('Adicionar horário')),
      ],
    );
  }
}
