import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import 'config.dart';

class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const _storage = FlutterSecureStorage();
  String? _token;
  String? _refresh;
  Future<bool>? _refreshing;

  String? get token => _token;
  String? get refreshToken => _refresh;

  /// Chamado quando a sessão não pôde ser renovada (refresh token expirado/revogado).
  void Function()? onUnauthorized;

  Future<void> loadToken() async {
    _token = await _storage.read(key: 'access_token');
    _refresh = await _storage.read(key: 'refresh_token');
  }

  Future<void> setTokens(String? access, String? refresh) async {
    _token = access;
    _refresh = refresh;
    if (access == null) {
      await _storage.delete(key: 'access_token');
    } else {
      await _storage.write(key: 'access_token', value: access);
    }
    if (refresh == null) {
      await _storage.delete(key: 'refresh_token');
    } else {
      await _storage.write(key: 'refresh_token', value: refresh);
    }
  }

  Map<String, String> _headers([Map<String, String>? extra]) => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
        ...?extra,
      };

  Uri _uri(String path, [Map<String, dynamic>? query]) {
    final q = <String, String>{};
    query?.forEach((k, v) {
      if (v != null) q[k] = v.toString();
    });
    final uri = Uri.parse('$apiBaseUrl$path');
    return q.isEmpty ? uri : uri.replace(queryParameters: q);
  }

  /// Renova o par de tokens (uma só renovação por vez, mesmo com várias chamadas falhando juntas).
  Future<bool> _tryRefresh() =>
      _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<bool> _doRefresh() async {
    try {
      final res = await http
          .post(_uri('/auth/refresh'),
              headers: {'Content-Type': 'application/json'},
              body: jsonEncode({'refreshToken': _refresh}))
          .timeout(const Duration(seconds: 15));
      if (res.statusCode != 200) {
        if (res.statusCode == 401) await setTokens(null, null);
        return false;
      }
      final b = jsonDecode(utf8.decode(res.bodyBytes)) as Map;
      await setTokens(b['accessToken'] as String, b['refreshToken'] as String);
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<dynamic> _send(Future<http.Response> Function() call,
      {bool retried = false}) async {
    final hadSession = _token != null || _refresh != null;
    http.Response res;
    try {
      res = await call().timeout(const Duration(seconds: 15));
    } on TimeoutException {
      throw ApiException(0, 'O servidor demorou para responder.');
    } catch (_) {
      throw ApiException(0, 'Não foi possível conectar ao servidor.');
    }

    // Access token expirado: renova e repete a chamada uma vez.
    if (res.statusCode == 401 && !retried && _refresh != null) {
      if (await _tryRefresh()) return _send(call, retried: true);
    }

    dynamic body;
    if (res.bodyBytes.isNotEmpty) {
      try {
        body = jsonDecode(utf8.decode(res.bodyBytes));
      } catch (_) {
        body = null;
      }
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return body;

    var msg = 'Erro ${res.statusCode}';
    if (body is Map && body['message'] != null) {
      final m = body['message'];
      msg = m is List ? m.join('\n') : m.toString();
    }
    if (res.statusCode == 401 && hadSession) onUnauthorized?.call();
    throw ApiException(res.statusCode, msg);
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) =>
      _send(() => http.get(_uri(path, query), headers: _headers()));

  /// [headers] extras (ex.: Idempotency-Key).
  Future<dynamic> post(String path,
          [Object? body, Map<String, String>? headers]) =>
      _send(() => http.post(_uri(path),
          headers: _headers(headers), body: jsonEncode(body ?? {})));

  Future<dynamic> patch(String path, Object body) => _send(() =>
      http.patch(_uri(path), headers: _headers(), body: jsonEncode(body)));

  Future<dynamic> delete(String path) =>
      _send(() => http.delete(_uri(path), headers: _headers()));
}
