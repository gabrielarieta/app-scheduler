/// URL base da API (passando pelo Nginx).
///
/// Troque na hora de rodar, sem editar código:
///   flutter run --dart-define=API_BASE_URL=http://192.168.0.10/api
///
/// Padrões úteis:
///   - Flutter Web / Desktop / iOS simulator: http://localhost/api
///   - Emulador Android:                       http://10.0.2.2/api
const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost/api',
);
