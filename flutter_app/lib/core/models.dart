const weekdayNames = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];
const weekdayShort = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const statusLabels = {
  'AVAILABLE': 'Disponível',
  'MAINTENANCE': 'Em manutenção',
  'UNAVAILABLE': 'Indisponível',
};

const roleLabels = {
  'ADMIN': 'Administrador',
  'MANAGER': 'Gestor',
  'RESERVER': 'Quem marca',
  'VIEWER': 'Quem consulta',
};

const userStatusLabels = {
  'PENDING': 'Pendente',
  'ACTIVE': 'Ativo',
  'REJECTED': 'Recusado',
  'DISABLED': 'Desativado',
};

const targetLabels = {
  'ROOM': 'Sala',
  'RESOURCE': 'Recurso',
  'COMBINATION': 'Sala + Recurso',
};

class Slot {
  int weekday;
  String start;
  String end;
  Slot(this.weekday, this.start, this.end);

  factory Slot.fromJson(Map<String, dynamic> j) =>
      Slot(j['weekday'] as int, j['start'] as String, j['end'] as String);

  Map<String, dynamic> toJson() =>
      {'weekday': weekday, 'start': start, 'end': end};

  @override
  String toString() => '${weekdayShort[weekday]} $start–$end';
}

List<Slot> parseSlots(dynamic raw) => ((raw ?? []) as List)
    .map((e) => Slot.fromJson(Map<String, dynamic>.from(e as Map)))
    .toList();

class AppUser {
  final String id;
  final String name;
  final String email;
  final String role;
  final String status;
  final String? requestedRole;
  final List<String> unitIds;

  AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.status = 'ACTIVE',
    this.requestedRole,
    this.unitIds = const [],
  });

  bool get isAdmin => role == 'ADMIN';
  bool get isManager => role == 'MANAGER';
  /// Admin global ou gestor de unidade (administra catálogo, aprova, vê relatórios).
  bool get canManage => isAdmin || isManager;
  bool get canBook => role == 'ADMIN' || role == 'MANAGER' || role == 'RESERVER';

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
        id: (j['id'] ?? '') as String,
        name: (j['name'] ?? '') as String,
        email: (j['email'] ?? '') as String,
        role: (j['role'] ?? 'VIEWER') as String,
        status: (j['status'] ?? 'ACTIVE') as String,
        requestedRole: j['requestedRole'] as String?,
        unitIds: ((j['unitIds'] ?? []) as List).map((e) => e.toString()).toList(),
      );
}

/// Sala, recurso ou combinação (sala + recurso) numa única classe.
class CatalogItem {
  final String id;
  final String kind; // ROOM | RESOURCE | COMBINATION
  final String name;
  final String subtitle;
  final String status;
  final String? statusNote;
  final List<Slot> availability;
  final Map<String, dynamic> raw;

  CatalogItem({
    required this.id,
    required this.kind,
    required this.name,
    required this.subtitle,
    required this.status,
    required this.statusNote,
    required this.availability,
    required this.raw,
  });

  bool get isAvailable => status == 'AVAILABLE';

  factory CatalogItem.fromJson(String kind, Map<String, dynamic> j) {
    String name;
    String subtitle;
    switch (kind) {
      case 'ROOM':
        name = j['name'] as String;
        subtitle = [
          if (j['location'] != null) j['location'],
          if (j['capacity'] != null) '${j['capacity']} lugares',
        ].join(' · ');
        break;
      case 'RESOURCE':
        name = j['name'] as String;
        subtitle = (j['type'] ?? '') as String;
        break;
      default:
        final room = (j['room'] ?? {}) as Map;
        final res = (j['resource'] ?? {}) as Map;
        name = '${room['name'] ?? '?'} + ${res['name'] ?? '?'}';
        subtitle = (j['notes'] ?? '') as String;
    }
    return CatalogItem(
      id: j['id'] as String,
      kind: kind,
      name: name,
      subtitle: subtitle,
      status: (j['status'] ?? 'AVAILABLE') as String,
      statusNote: j['statusNote'] as String?,
      availability: parseSlots(j['availability']),
      raw: j,
    );
  }
}

class Viewer {
  final String userId;
  final String name;
  final String email;
  final DateTime? confirmedAt; // presença confirmada (antecipada)
  final DateTime? checkedInAt; // check-in feito no local
  Viewer(this.userId, this.name, this.email, [this.confirmedAt, this.checkedInAt]);

  static DateTime? _d(dynamic v) =>
      v == null ? null : DateTime.parse(v as String).toLocal();

  factory Viewer.fromJson(Map<String, dynamic> j) => Viewer(
        (j['userId'] ?? '') as String,
        (j['name'] ?? '') as String,
        (j['email'] ?? '') as String,
        _d(j['confirmedAt']),
        _d(j['checkedInAt']),
      );
}

class Reservation {
  final String id;
  final String targetType;
  final String title;
  final String? notes;
  final DateTime start;
  final DateTime end;
  final String status;
  final String createdBy;
  final String createdByName;
  final List<Viewer> viewers;
  final Map<String, dynamic> snapshot;
  final String? seriesId;
  final String approvalStatus; // NOT_REQUIRED | PENDING | APPROVED | REJECTED | EXPIRED
  final String? cancelReason; // USER | NO_SHOW | REJECTED | EXPIRED | MAINTENANCE
  final DateTime? startedAt;

  Reservation({
    required this.id,
    required this.targetType,
    required this.title,
    required this.notes,
    required this.start,
    required this.end,
    required this.status,
    required this.createdBy,
    required this.createdByName,
    required this.viewers,
    required this.snapshot,
    this.seriesId,
    this.approvalStatus = 'NOT_REQUIRED',
    this.cancelReason,
    this.startedAt,
  });

  /// Nome gravado no momento da reserva (não muda se a sala for renomeada).
  String get targetLabel {
    final room = snapshot['room'] as Map?;
    final res = snapshot['resource'] as Map?;
    switch (targetType) {
      case 'ROOM':
        return room?['name'] ?? 'Sala';
      case 'RESOURCE':
        return res?['name'] ?? 'Recurso';
      default:
        return '${room?['name'] ?? '?'} + ${res?['name'] ?? '?'}';
    }
  }

  factory Reservation.fromJson(Map<String, dynamic> j) => Reservation(
        id: j['id'] as String,
        targetType: j['targetType'] as String,
        title: (j['title'] ?? '') as String,
        notes: j['notes'] as String?,
        start: DateTime.parse(j['start'] as String).toLocal(),
        end: DateTime.parse(j['end'] as String).toLocal(),
        status: (j['status'] ?? 'ACTIVE') as String,
        createdBy: (j['createdBy'] ?? '') as String,
        createdByName:
            ((j['createdBySnapshot'] ?? {}) as Map)['name'] as String? ?? '',
        viewers: ((j['viewers'] ?? []) as List)
            .map((e) => Viewer.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList(),
        snapshot: Map<String, dynamic>.from((j['snapshot'] ?? {}) as Map),
        seriesId: j['seriesId'] as String?,
        approvalStatus: (j['approvalStatus'] ?? 'NOT_REQUIRED') as String,
        cancelReason: j['cancelReason'] as String?,
        startedAt: j['startedAt'] != null ? DateTime.parse(j['startedAt'] as String).toLocal() : null,
      );
}
