export enum Role {
  ADMIN = 'ADMIN', // global
  MANAGER = 'MANAGER', // gestor: administra e aprova nas suas unidades
  RESERVER = 'RESERVER', // quem marca
  VIEWER = 'VIEWER', // quem consulta
}

export enum UserStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  DISABLED = 'DISABLED',
}

export enum AvailabilityStatus {
  AVAILABLE = 'AVAILABLE',
  MAINTENANCE = 'MAINTENANCE',
  UNAVAILABLE = 'UNAVAILABLE',
}

export const STATUS_LABEL: Record<AvailabilityStatus, string> = {
  [AvailabilityStatus.AVAILABLE]: 'disponível',
  [AvailabilityStatus.MAINTENANCE]: 'em manutenção',
  [AvailabilityStatus.UNAVAILABLE]: 'indisponível',
};

export enum TargetType {
  ROOM = 'ROOM',
  RESOURCE = 'RESOURCE',
  COMBINATION = 'COMBINATION',
}

export enum ReservationStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
}

export enum ApprovalStatus {
  NOT_REQUIRED = 'NOT_REQUIRED',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum CancelReason {
  USER = 'USER',
  NO_SHOW = 'NO_SHOW',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  MAINTENANCE = 'MAINTENANCE',
}
