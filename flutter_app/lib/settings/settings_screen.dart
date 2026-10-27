import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api_client.dart';
import '../core/push.dart';
import '../core/ui.dart';

/// Feed de calendário (.ics) e preferências de aviso (e-mail / push).
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String? _feedUrl;
  bool _email = true;
  bool _push = true;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final feed = await ApiClient.instance.get('/calendar/feed-url') as Map;
      final prefs = await ApiClient.instance.get('/users/me/preferences') as Map;
      if (!mounted) return;
      setState(() {
        _feedUrl = feed['url'] as String;
        _email = prefs['email'] as bool;
        _push = prefs['push'] as bool;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _savePrefs() async {
    try {
      await ApiClient.instance.patch('/users/me/preferences', {'email': _email, 'push': _push});
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  Future<void> _rotate() async {
    if (!await confirm(context, 'Gerar nova URL',
        'A URL atual deixará de funcionar nos calendários onde você a adicionou.',
        action: 'Gerar')) {
      return;
    }
    try {
      final r = await ApiClient.instance.post('/calendar/feed-url/rotate') as Map;
      if (mounted) setState(() => _feedUrl = r['url'] as String);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return Center(child: Text(_error!));
    return ListView(padding: const EdgeInsets.all(16), children: [
      Text('Calendário (Google, Apple, Outlook)', style: Theme.of(context).textTheme.titleMedium),
      const SizedBox(height: 8),
      const Text(
          'Assine esta URL no seu calendário e suas reservas aparecem lá, sempre atualizadas. '
          'No Google Agenda: Outras agendas → "Por URL". (O Google pode levar horas para atualizar.) '
          'Quem tiver a URL vê suas reservas — não compartilhe.'),
      const SizedBox(height: 8),
      SelectableText(_feedUrl ?? '', style: const TextStyle(fontSize: 12)),
      Row(children: [
        TextButton.icon(
          icon: const Icon(Icons.copy),
          label: const Text('Copiar'),
          onPressed: () {
            Clipboard.setData(ClipboardData(text: _feedUrl ?? ''));
            showSnack(context, 'URL copiada.');
          },
        ),
        TextButton.icon(
            icon: const Icon(Icons.refresh),
            label: const Text('Gerar nova URL'),
            onPressed: _rotate),
      ]),
      const Divider(height: 32),
      Text('Avisos', style: Theme.of(context).textTheme.titleMedium),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Receber por e-mail'),
        value: _email,
        onChanged: (v) {
          setState(() => _email = v);
          _savePrefs();
        },
      ),
      SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: const Text('Receber notificações push'),
        subtitle: PushService.enabled
            ? null
            : const Text('Push não está habilitado neste build (ENABLE_PUSH).'),
        value: _push,
        onChanged: (v) {
          setState(() => _push = v);
          _savePrefs();
          if (v) PushService.init();
        },
      ),
    ]);
  }
}
