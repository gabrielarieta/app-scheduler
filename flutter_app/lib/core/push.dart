import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'api_client.dart';

/// Push (FCM). Só ativa com `--dart-define=ENABLE_PUSH=true` E o projeto Firebase configurado
/// (google-services.json / GoogleService-Info.plist). Sem isso, não faz nada.
class PushService {
  static const enabled = bool.fromEnvironment('ENABLE_PUSH');

  static Future<void> init() async {
    if (!enabled) return;
    try {
      await Firebase.initializeApp();
      final fcm = FirebaseMessaging.instance;
      await fcm.requestPermission();
      final token = await fcm.getToken();
      if (token != null) await _register(token);
      fcm.onTokenRefresh.listen(_register);
    } catch (_) {
      // push é opcional: falhas aqui não podem derrubar o app
    }
  }

  static Future<void> _register(String token) async {
    try {
      await ApiClient.instance.post('/devices', {
        'token': token,
        'platform': defaultTargetPlatform.name,
      });
    } catch (_) {}
  }
}
