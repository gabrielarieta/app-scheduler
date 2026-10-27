import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/models.dart';
import '../core/session.dart';
import '../core/ui.dart';
import 'availability_editor.dart';
import 'catalog_screen.dart' show catalogPaths;

class CatalogFormScreen extends StatefulWidget {
  final String kind;
  final CatalogItem? item;
  const CatalogFormScreen({super.key, required this.kind, this.item});

  @override
  State<CatalogFormScreen> createState() => _CatalogFormScreenState();
}

class _CatalogFormScreenState extends State<CatalogFormScreen> {
  final _name = TextEditingController();
  final _type = TextEditingController();
  final _location = TextEditingController();
  final _capacity = TextEditingController();
  final _description = TextEditingController();
  final _notes = TextEditingController();
  late final List<Slot> _slots;

  List<CatalogItem> _rooms = [];
  List<CatalogItem> _resources = [];
  String? _roomId;
  String? _resourceId;
  bool _saving = false;
  bool _loadingRefs = false;
  List<Map<String, dynamic>> _units = [];
  String? _unitId;
  bool _requiresApproval = false;
  final _grace = TextEditingController();

  bool get _editing => widget.item != null;
  String get _path => catalogPaths[widget.kind]!;

  @override
  void initState() {
    super.initState();
    final raw = widget.item?.raw;
    _slots = widget.item?.availability
            .map((s) => Slot(s.weekday, s.start, s.end))
            .toList() ??
        [];
    if (raw != null) {
      _name.text = (raw['name'] ?? '') as String;
      _type.text = (raw['type'] ?? '') as String;
      _location.text = (raw['location'] ?? '') as String;
      _capacity.text = raw['capacity']?.toString() ?? '';
      _description.text = (raw['description'] ?? '') as String;
      _notes.text = (raw['notes'] ?? '') as String;
      _unitId = raw['unitId'] as String?;
      _requiresApproval = raw['requiresApproval'] == true;
      _grace.text = '${raw['noShowGraceMinutes'] ?? 0}';
    }
    if (widget.kind == 'COMBINATION' && !_editing) _loadRefs();
    _loadUnits();
  }

  @override
  void dispose() {
    for (final c in [_name, _type, _location, _capacity, _description, _notes, _grace]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _loadRefs() async {
    setState(() => _loadingRefs = true);
    try {
      final r = await ApiClient.instance.get('/rooms') as List;
      final s = await ApiClient.instance.get('/resources') as List;
      _rooms = r
          .map((e) => CatalogItem.fromJson('ROOM', Map<String, dynamic>.from(e as Map)))
          .toList();
      _resources = s
          .map((e) =>
              CatalogItem.fromJson('RESOURCE', Map<String, dynamic>.from(e as Map)))
          .toList();
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _loadingRefs = false);
    }
  }

  Future<void> _loadUnits() async {
    try {
      final data = await ApiClient.instance.get('/units') as List;
      if (!mounted) return;
      setState(() {
        _units = data.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        // gestor precisa informar a unidade: sugere a primeira
        if (!_editing && _unitId == null && !Session.user!.isAdmin && _units.isNotEmpty) {
          _unitId = _units.first['id'] as String;
        }
      });
    } on ApiException {/* sem unidades */}
  }

  String? _validate() {
    if (widget.kind != 'COMBINATION' && _name.text.trim().length < 2) {
      return 'Informe o nome.';
    }
    if (widget.kind == 'RESOURCE' && _type.text.trim().length < 2) {
      return 'Informe o tipo do recurso.';
    }
    if (widget.kind == 'COMBINATION' && !_editing &&
        (_roomId == null || _resourceId == null)) {
      return 'Escolha a sala e o recurso.';
    }
    if (_slots.isEmpty) return 'Adicione ao menos um horário de disponibilidade.';
    return null;
  }

  Map<String, dynamic> _body() {
    String? opt(TextEditingController c) =>
        c.text.trim().isEmpty ? null : c.text.trim();
    final slots = _slots.map((s) => s.toJson()).toList();
    switch (widget.kind) {
      case 'ROOM':
        return {
          'name': _name.text.trim(),
          if (opt(_location) != null) 'location': opt(_location),
          if (int.tryParse(_capacity.text.trim()) != null)
            'capacity': int.parse(_capacity.text.trim()),
          if (opt(_description) != null) 'description': opt(_description),
          'availability': slots,
          if (_unitId != null) 'unitId': _unitId,
          'requiresApproval': _requiresApproval,
          'noShowGraceMinutes': int.tryParse(_grace.text.trim()) ?? 0,
        };
      case 'RESOURCE':
        return {
          'name': _name.text.trim(),
          'type': _type.text.trim(),
          if (opt(_description) != null) 'description': opt(_description),
          'availability': slots,
          if (_unitId != null) 'unitId': _unitId,
          'requiresApproval': _requiresApproval,
          'noShowGraceMinutes': int.tryParse(_grace.text.trim()) ?? 0,
        };
      default:
        return {
          if (!_editing) 'roomId': _roomId,
          if (!_editing) 'resourceId': _resourceId,
          if (opt(_notes) != null) 'notes': opt(_notes),
          'availability': slots,
          'requiresApproval': _requiresApproval,
        };
    }
  }

  Future<void> _save() async {
    final err = _validate();
    if (err != null) {
      showSnack(context, err, error: true);
      return;
    }
    setState(() => _saving = true);
    try {
      if (_editing) {
        await ApiClient.instance.patch('$_path/${widget.item!.id}', _body());
      } else {
        await ApiClient.instance.post(_path, _body());
      }
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = '${_editing ? 'Editar' : 'Nova'} '
        '${{'ROOM': 'sala', 'RESOURCE': 'recurso', 'COMBINATION': 'combinação'}[widget.kind]}';

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: _loadingRefs
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (widget.kind == 'ROOM') ...[
                  TextField(controller: _name, decoration: const InputDecoration(labelText: 'Nome')),
                  TextField(controller: _location, decoration: const InputDecoration(labelText: 'Localização (opcional)')),
                  TextField(
                      controller: _capacity,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Capacidade (opcional)')),
                  TextField(controller: _description, maxLines: 2, decoration: const InputDecoration(labelText: 'Descrição (opcional)')),
                ],
                if (widget.kind == 'RESOURCE') ...[
                  TextField(controller: _name, decoration: const InputDecoration(labelText: 'Nome')),
                  TextField(controller: _type, decoration: const InputDecoration(labelText: 'Tipo (ex.: Projetor, Notebook)')),
                  TextField(controller: _description, maxLines: 2, decoration: const InputDecoration(labelText: 'Descrição (opcional)')),
                ],
                if (widget.kind == 'COMBINATION') ...[
                  if (_editing)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(widget.item!.name,
                          style: Theme.of(context).textTheme.titleMedium),
                    )
                  else ...[
                    DropdownButtonFormField<String>(
                      value: _roomId,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: 'Sala'),
                      items: [for (final r in _rooms) DropdownMenuItem(value: r.id, child: Text(r.name))],
                      onChanged: (v) => setState(() => _roomId = v),
                    ),
                    DropdownButtonFormField<String>(
                      value: _resourceId,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: 'Recurso'),
                      items: [for (final r in _resources) DropdownMenuItem(value: r.id, child: Text(r.name))],
                      onChanged: (v) => setState(() => _resourceId = v),
                    ),
                  ],
                  TextField(controller: _notes, maxLines: 2, decoration: const InputDecoration(labelText: 'Observações (opcional)')),
                ],
                if (widget.kind != 'COMBINATION' && _units.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String?>(
                    value: _units.any((u) => u['id'] == _unitId) ? _unitId : null,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Unidade / campus'),
                    items: [
                      if (Session.user!.isAdmin)
                        const DropdownMenuItem<String?>(value: null, child: Text('Sem unidade (global)')),
                      for (final u in _units)
                        DropdownMenuItem<String?>(value: u['id'] as String, child: Text(u['name'] as String)),
                    ],
                    onChanged: (_editing && !Session.user!.isAdmin) ? null : (v) => setState(() => _unitId = v),
                  ),
                ],
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Exige aprovação de um gestor'),
                  subtitle: const Text('Para salas/recursos sensíveis.'),
                  value: _requiresApproval,
                  onChanged: (v) => setState(() => _requiresApproval = v),
                ),
                if (widget.kind != 'COMBINATION')
                  TextField(
                    controller: _grace,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                        labelText: 'No-show: cancelar após N min sem check-in (0 = padrão da unidade)'),
                  ),
                const SizedBox(height: 16),
                AvailabilityEditor(slots: _slots, onChanged: () {}),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: _saving
                      ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Salvar'),
                ),
              ],
            ),
    );
  }
}
