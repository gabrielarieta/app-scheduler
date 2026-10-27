/**
 * O tempo é dividido em blocos de N minutos (SLOT_MINUTES, padrão 15).
 * Cada bloco de cada sala/recurso/pessoa vira uma chave única no banco; quem
 * inserir a chave primeiro "ganha" o bloco. É isso que impede reservas duplicadas
 * mesmo com requisições simultâneas e várias instâncias da API.
 */
export const DEFAULT_SLOT_MINUTES = 15;

/** Índices inteiros dos blocos cobertos por [start, end). Exige início/fim alinhados ao bloco. */
export function slotIndexes(start: Date, end: Date, slotMinutes: number): number[] {
  const ms = slotMinutes * 60_000;
  const first = start.getTime() / ms;
  const last = end.getTime() / ms;
  if (!Number.isInteger(first) || !Number.isInteger(last)) {
    throw new Error(`Intervalo não alinhado a blocos de ${slotMinutes} minutos`);
  }
  const out: number[] = [];
  for (let i = first; i < last; i++) out.push(i);
  return out;
}

export const roomLockKey = (roomId: string, slot: number) => `room:${roomId}:${slot}`;
export const resourceLockKey = (resourceId: string, slot: number) =>
  `resource:${resourceId}:${slot}`;
export const userLockKey = (userId: string, slot: number) => `user:${userId}:${slot}`;

/** Chaves da sala e/ou do recurso ocupados. Ordenadas (ordem global evita disputas cruzadas). */
export function targetLockKeys(
  refs: { roomId?: string; resourceId?: string },
  start: Date,
  end: Date,
  slotMinutes: number,
): string[] {
  const slots = slotIndexes(start, end, slotMinutes);
  const keys: string[] = [];
  if (refs.roomId) for (const s of slots) keys.push(roomLockKey(refs.roomId, s));
  if (refs.resourceId) for (const s of slots) keys.push(resourceLockKey(refs.resourceId, s));
  return keys.sort();
}

/** Chaves do tempo de uma pessoa (confirmação de presença). */
export function userLockKeys(
  userId: string,
  start: Date,
  end: Date,
  slotMinutes: number,
): string[] {
  return slotIndexes(start, end, slotMinutes)
    .map((s) => userLockKey(userId, s))
    .sort();
}
