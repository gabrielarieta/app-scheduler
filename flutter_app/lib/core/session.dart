import 'api_client.dart';
import 'models.dart';

class Session {
  static AppUser? user;

  /// Reaproveita a sessão salva (renovando o acesso se preciso). true se ainda vale.
  static Future<bool> restore() async {
    final api = ApiClient.instance;
    await api.loadToken();
    if (api.token == null && api.refreshToken == null) return false;
    try {
      final me = await api.get('/auth/me');
      user = AppUser.fromJson(Map<String, dynamic>.from(me as Map));
      return true;
    } on ApiException catch (e) {
      if (e.statusCode == 0) return false; // sem rede: mantém os tokens
      await api.setTokens(null, null);
      return false;
    }
  }

  static Future<void> login(String email, String password) async {
    final api = ApiClient.instance;
    final res = await api.post('/auth/login', {
      'email': email.trim(),
      'password': password,
    }) as Map;
    await api.setTokens(
        res['accessToken'] as String, res['refreshToken'] as String);
    user = AppUser.fromJson(Map<String, dynamic>.from(res['user'] as Map));
  }

  static Future<void> logout() async {
    final api = ApiClient.instance;
    final rt = api.refreshToken;
    if (rt != null) {
      try {
        await api.post('/auth/logout', {'refreshToken': rt});
      } catch (_) {/* melhor esforço */}
    }
    user = null;
    await api.setTokens(null, null);
  }
}
