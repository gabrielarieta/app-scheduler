import 'package:flutter/material.dart';
import 'package:table_calendar/table_calendar.dart';

import '../core/api_client.dart';
import '../core/models.dart';
import '../core/session.dart';
import '../core/ui.dart';
import '../reservations/booking_screen.dart';
import '../reservations/reservation_detail_screen.dart';

class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key});

  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends State<CalendarScreen> {
  DateTime _focused = DateTime.now();
  DateTime _selected = DateTime.now();
  final Map<DateTime, List<Reservation>> _events = {};
  bool _loading = true;
  String? _error;

  DateTime _key(DateTime d) => DateTime.utc(d.year, d.month, d.day);

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
      // Mês visível com uma folga de 7 dias para cada lado.
      final from = DateTime(_focused.year, _focused.month, 1)
          .subtract(const Duration(days: 7));
      final to = DateTime(_focused.year, _focused.month + 1, 1)
          .add(const Duration(days: 7));
      final data = await ApiClient.instance.get('/reservations', query: {
        'from': from.toUtc().toIso8601String(),
        'to': to.toUtc().toIso8601String(),
      });
      final map = <DateTime, List<Reservation>>{};
      for (final e in data as List) {
        final r = Reservation.fromJson(Map<String, dynamic>.from(e as Map));
        map.putIfAbsent(_key(r.start), () => []).add(r);
      }
      if (!mounted) return;
      setState(() {
        _events
          ..clear()
          ..addAll(map);
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Reservation> _eventsOf(DateTime day) => _events[_key(day)] ?? const [];

  Future<void> _openDetail(Reservation r) async {
    final changed = await Navigator.push<bool>(context,
        MaterialPageRoute(builder: (_) => ReservationDetailScreen(reservation: r)));
    if (changed == true) _load();
  }

  Future<void> _newBooking() async {
    final created = await Navigator.push<bool>(context,
        MaterialPageRoute(builder: (_) => BookingScreen(initialDate: _selected)));
    if (created == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final dayEvents = _eventsOf(_selected);
    final canBook = Session.user!.canBook;

    return Scaffold(
      floatingActionButton: canBook
          ? FloatingActionButton.extended(
              onPressed: _newBooking,
              icon: const Icon(Icons.add),
              label: const Text('Nova reserva'),
            )
          : null,
      body: Column(
        children: [
          TableCalendar<Reservation>(
            locale: 'pt_BR',
            firstDay: DateTime.utc(2020, 1, 1),
            lastDay: DateTime.utc(2035, 12, 31),
            focusedDay: _focused,
            selectedDayPredicate: (d) => isSameDay(d, _selected),
            eventLoader: _eventsOf,
            startingDayOfWeek: StartingDayOfWeek.monday,
            calendarFormat: CalendarFormat.month,
            availableCalendarFormats: const {CalendarFormat.month: 'Mês'},
            onDaySelected: (sel, foc) => setState(() {
              _selected = sel;
              _focused = foc;
            }),
            onPageChanged: (foc) {
              _focused = foc;
              _load();
            },
          ),
          if (_loading) const LinearProgressIndicator(),
          const Divider(height: 1),
          Expanded(
            child: _error != null
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!),
                        TextButton(
                            onPressed: _load, child: const Text('Tentar de novo')),
                      ],
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: _load,
                    child: dayEvents.isEmpty
                        ? ListView(children: const [
                            SizedBox(height: 48),
                            Center(child: Text('Nenhuma marcação neste dia.')),
                          ])
                        : ListView.builder(
                            padding: const EdgeInsets.only(bottom: 88),
                            itemCount: dayEvents.length,
                            itemBuilder: (_, i) {
                              final r = dayEvents[i];
                              return ListTile(
                                leading: const Icon(Icons.event),
                                title: Text(r.title),
                                subtitle: Text(
                                    '${fmtRange(r.start, r.end)} · ${r.targetLabel}'),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () => _openDetail(r),
                              );
                            },
                          ),
                  ),
          ),
        ],
      ),
    );
  }
}
