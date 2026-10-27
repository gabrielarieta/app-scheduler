import 'dart:async';

import 'package:flutter/material.dart';

import '../admin/approvals_screen.dart';
import '../admin/audit_screen.dart';
import '../admin/units_screen.dart';
import '../core/push.dart';
import '../reports/reports_screen.dart';
import '../settings/settings_screen.dart';
import '../admin/users_screen.dart';
import '../auth/login_screen.dart';
import '../calendar/calendar_screen.dart';
import '../catalog/catalog_screen.dart';
import '../core/api_client.dart';
import '../core/models.dart';
import '../core/session.dart';
import '../notifications/notifications_screen.dart';
import '../waitlist/waitlist_screen.dart';

class _Page {
  final String title;
  final IconData icon;
  final Widget Function() build;
  const _Page(this.title, this.icon, this.build);
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;
  int _unread = 0;
  Timer? _timer;
  late final List<_Page> _pages;

  @override
  void initState() {
    super.initState();
    final user = Session.user!;
    _pages = [
      _Page(user.canBook ? 'Agenda' : 'Minhas marcações',
          Icons.calendar_month, () => const CalendarScreen()),
      _Page('Salas', Icons.meeting_room,
          () => const CatalogScreen(kind: 'ROOM', key: ValueKey('ROOM'))),
      _Page('Recursos', Icons.devices_other,
          () => const CatalogScreen(kind: 'RESOURCE', key: ValueKey('RESOURCE'))),
      _Page('Sala + Recurso', Icons.link,
          () => const CatalogScreen(kind: 'COMBINATION', key: ValueKey('COMBINATION'))),
      _Page('Notificações', Icons.notifications,
          () => NotificationsScreen(onChanged: _loadUnread)),
      if (user.canBook)
        _Page('Lista de espera', Icons.hourglass_empty,
            () => const WaitlistScreen()),
      if (user.canManage) ...[
        _Page('Aprovações', Icons.fact_check, () => const ApprovalsScreen()),
        _Page('Relatórios', Icons.bar_chart, () => const ReportsScreen()),
      ],
      _Page('Configurações', Icons.settings, () => const SettingsScreen()),
      if (user.isAdmin) ...[
        _Page('Usuários', Icons.people, () => const UsersScreen()),
        _Page('Unidades', Icons.apartment, () => const UnitsScreen()),
        _Page('Auditoria', Icons.history, () => const AuditScreen()),
      ],
    ];
    _loadUnread();
    PushService.init();
    _timer = Timer.periodic(const Duration(seconds: 60), (_) => _loadUnread());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _loadUnread() async {
    try {
      final r = await ApiClient.instance.get('/notifications/unread-count') as Map;
      if (mounted) setState(() => _unread = (r['count'] ?? 0) as int);
    } catch (_) {/* ignora: é só o contador */}
  }

  Future<void> _logout() async {
    await Session.logout();
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = Session.user!;
    final page = _pages[_index];

    return Scaffold(
      appBar: AppBar(title: Text(page.title)),
      drawer: Drawer(
        child: SafeArea(
          child: Column(
            children: [
              UserAccountsDrawerHeader(
                accountName: Text(user.name),
                accountEmail: Text('${user.email} · ${roleLabels[user.role]}'),
                currentAccountPicture: CircleAvatar(
                    child: Text(user.name.isEmpty ? '?' : user.name[0].toUpperCase())),
              ),
              for (var i = 0; i < _pages.length; i++)
                ListTile(
                  leading: Icon(_pages[i].icon),
                  title: Row(children: [
                    Text(_pages[i].title),
                    if (_pages[i].title == 'Notificações' && _unread > 0)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: Badge(label: Text('$_unread')),
                      ),
                  ]),
                  selected: i == _index,
                  onTap: () {
                    setState(() => _index = i);
                    Navigator.pop(context);
                  },
                ),
              const Spacer(),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('Sair'),
                onTap: _logout,
              ),
            ],
          ),
        ),
      ),
      body: page.build(),
    );
  }
}
