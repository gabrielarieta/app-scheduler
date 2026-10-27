import {
  slotIndexes,
  targetLockKeys,
  userLockKey,
  userLockKeys,
} from './slots.util';

const at = (iso: string) => new Date(iso);

describe('slots.util', () => {
  describe('slotIndexes', () => {
    it('1 hora em blocos de 15 min = 4 blocos consecutivos', () => {
      const idx = slotIndexes(at('2026-11-03T10:00:00Z'), at('2026-11-03T11:00:00Z'), 15);
      expect(idx).toHaveLength(4);
      expect(idx[3] - idx[0]).toBe(3);
    });

    it('intervalo não alinhado lança erro', () => {
      expect(() => slotIndexes(at('2026-11-03T10:05:00Z'), at('2026-11-03T11:00:00Z'), 15)).toThrow();
    });

    it('intervalos adjacentes não compartilham blocos', () => {
      const a = slotIndexes(at('2026-11-03T10:00:00Z'), at('2026-11-03T11:00:00Z'), 15);
      const b = slotIndexes(at('2026-11-03T11:00:00Z'), at('2026-11-03T12:00:00Z'), 15);
      expect(a.filter((x) => b.includes(x))).toHaveLength(0);
    });

    it('intervalos sobrepostos compartilham blocos', () => {
      const a = slotIndexes(at('2026-11-03T10:00:00Z'), at('2026-11-03T11:00:00Z'), 15);
      const b = slotIndexes(at('2026-11-03T10:30:00Z'), at('2026-11-03T11:30:00Z'), 15);
      expect(a.filter((x) => b.includes(x))).toHaveLength(2);
    });
  });

  describe('targetLockKeys', () => {
    const start = at('2026-11-03T10:00:00Z');
    const end = at('2026-11-03T11:00:00Z');

    it('só sala: 4 chaves "room:..."', () => {
      const keys = targetLockKeys({ roomId: 'R1' }, start, end, 15);
      expect(keys).toHaveLength(4);
      expect(keys.every((k) => k.startsWith('room:R1:'))).toBe(true);
    });

    it('combinação (sala + recurso): chaves dos dois, ordenadas', () => {
      const keys = targetLockKeys({ roomId: 'R1', resourceId: 'X1' }, start, end, 15);
      expect(keys).toHaveLength(8);
      expect(keys).toEqual([...keys].sort());
      expect(keys.some((k) => k.startsWith('resource:X1:'))).toBe(true);
    });

    it('sala-só e combinação com a mesma sala colidem em chaves', () => {
      const room = targetLockKeys({ roomId: 'R1' }, start, end, 15);
      const combo = targetLockKeys({ roomId: 'R1', resourceId: 'X1' }, start, end, 15);
      expect(room.every((k) => combo.includes(k))).toBe(true);
    });

    it('salas diferentes não colidem', () => {
      const a = targetLockKeys({ roomId: 'R1' }, start, end, 15);
      const b = targetLockKeys({ roomId: 'R2' }, start, end, 15);
      expect(a.filter((k) => b.includes(k))).toHaveLength(0);
    });
  });

  describe('userLockKeys', () => {
    it('formata e ordena as chaves da pessoa', () => {
      const keys = userLockKeys('U1', at('2026-11-03T10:00:00Z'), at('2026-11-03T10:30:00Z'), 15);
      expect(keys).toHaveLength(2);
      expect(keys[0]).toMatch(/^user:U1:\d+$/);
      expect(keys).toEqual([...keys].sort());
    });

    it('reservas simultâneas geram as mesmas chaves (é o que bloqueia a 2ª presença)', () => {
      const a = userLockKeys('U1', at('2026-11-03T10:00:00Z'), at('2026-11-03T11:00:00Z'), 15);
      const b = userLockKeys('U1', at('2026-11-03T10:30:00Z'), at('2026-11-03T11:30:00Z'), 15);
      expect(a.filter((k) => b.includes(k)).length).toBeGreaterThan(0);
    });

    it('pessoas diferentes não colidem', () => {
      expect(userLockKey('U1', 5)).not.toBe(userLockKey('U2', 5));
    });
  });
});
