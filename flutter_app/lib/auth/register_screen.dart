import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/ui.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _pass = TextEditingController();
  String _requestedRole = 'VIEWER';
  bool _loading = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _pass.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_name.text.trim().length < 2 ||
        !_email.text.contains('@') ||
        _pass.text.length < 8) {
      showSnack(context, 'Preencha nome, e-mail e senha (mínimo 8 caracteres).',
          error: true);
      return;
    }
    setState(() => _loading = true);
    try {
      await ApiClient.instance.post('/auth/register', {
        'name': _name.text.trim(),
        'email': _email.text.trim(),
        'password': _pass.text,
        'requestedRole': _requestedRole,
      });
      if (!mounted) return;
      showSnack(context, 'Solicitação enviada! Aguarde a aprovação do administrador.');
      Navigator.pop(context);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Solicitar cadastro')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                TextField(
                    controller: _name,
                    decoration: const InputDecoration(labelText: 'Nome')),
                TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'E-mail')),
                TextField(
                    controller: _pass,
                    obscureText: true,
                    decoration:
                        const InputDecoration(labelText: 'Senha (mín. 8)')),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: _requestedRole,
                  decoration: const InputDecoration(labelText: 'Preciso de acesso para'),
                  items: const [
                    DropdownMenuItem(
                        value: 'VIEWER', child: Text('Consultar marcações')),
                    DropdownMenuItem(
                        value: 'RESERVER', child: Text('Fazer marcações')),
                  ],
                  onChanged: (v) => setState(() => _requestedRole = v!),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _loading ? null : _submit,
                    child: const Text('Enviar solicitação'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
