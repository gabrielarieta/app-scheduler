import { BadRequestException } from '@nestjs/common';
import {
  assertValidSlots,
  endMinutesOnStartDay,
  fitsInAvailability,
  localParts,
  toMinutes,
} from './availability.util';

const TZ = 'America/Sao_Paulo';
const weekdays = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '08:00', end: '18:00' }));
const fits = (a: string, b: string, slots = weekdays) =>
  fitsInAvailability(slots, new Date(a), new Date(b), TZ);

describe('availability.util', () => {
  it('toMinutes converte HH:mm', () => {
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('08:30')).toBe(510);
    expect(toMinutes('24:00')).toBe(1440);
  });

  it('localParts respeita o fuso (2026-11-03 13:00Z = terça 10:00 em São Paulo)', () => {
    const p = localParts(new Date('2026-11-03T13:00:00Z'), TZ);
    expect(p).toEqual({ weekday: 2, minutes: 600, dateKey: '2026-11-03' });
  });

  describe('fitsInAvailability', () => {
    it('aceita horário dentro da janela', () => {
      expect(fits('2026-11-03T13:00:00Z', '2026-11-03T14:00:00Z')).toBe(true);
    });
    it('rejeita antes do início, depois do fim e fim de semana', () => {
      expect(fits('2026-11-03T10:00:00Z', '2026-11-03T12:00:00Z')).toBe(false); // 07–09
      expect(fits('2026-11-03T20:00:00Z', '2026-11-03T22:00:00Z')).toBe(false); // 17–19
      expect(fits('2026-11-07T13:00:00Z', '2026-11-07T14:00:00Z')).toBe(false); // sábado
    });
    it('rejeita intervalo que atravessa o dia', () => {
      expect(fits('2026-11-03T20:00:00Z', '2026-11-04T13:00:00Z')).toBe(false);
    });
    it('aceita fim "24:00" (meia-noite)', () => {
      const slots = [{ weekday: 2, start: '20:00', end: '24:00' }];
      expect(fits('2026-11-03T23:00:00Z', '2026-11-04T03:00:00Z', slots)).toBe(true);
    });
    it('une janelas contíguas e rejeita quando há buraco', () => {
      const contiguous = [
        { weekday: 2, start: '08:00', end: '12:00' },
        { weekday: 2, start: '12:00', end: '18:00' },
      ];
      const gap = [
        { weekday: 2, start: '08:00', end: '12:00' },
        { weekday: 2, start: '13:00', end: '18:00' },
      ];
      expect(fits('2026-11-03T14:00:00Z', '2026-11-03T17:00:00Z', contiguous)).toBe(true); // 11–14
      expect(fits('2026-11-03T14:00:00Z', '2026-11-03T17:00:00Z', gap)).toBe(false);
    });
  });

  it('endMinutesOnStartDay retorna null quando termina em outro dia', () => {
    expect(
      endMinutesOnStartDay(new Date('2026-11-03T20:00:00Z'), new Date('2026-11-04T13:00:00Z'), TZ),
    ).toBeNull();
    expect(
      endMinutesOnStartDay(new Date('2026-11-03T13:00:00Z'), new Date('2026-11-03T14:00:00Z'), TZ),
    ).toBe(660);
  });

  describe('assertValidSlots', () => {
    it('aceita janelas válidas e adjacentes', () => {
      expect(() =>
        assertValidSlots([
          { weekday: 1, start: '08:00', end: '12:00' },
          { weekday: 1, start: '12:00', end: '18:00' },
        ]),
      ).not.toThrow();
    });
    it('rejeita início >= fim', () => {
      expect(() => assertValidSlots([{ weekday: 1, start: '12:00', end: '08:00' }])).toThrow(
        BadRequestException,
      );
    });
    it('rejeita "24:00" como início', () => {
      expect(() => assertValidSlots([{ weekday: 1, start: '24:00', end: '24:00' }])).toThrow(
        BadRequestException,
      );
    });
    it('rejeita janelas sobrepostas no mesmo dia', () => {
      expect(() =>
        assertValidSlots([
          { weekday: 1, start: '08:00', end: '12:00' },
          { weekday: 1, start: '11:00', end: '13:00' },
        ]),
      ).toThrow(/sobrepostas/);
    });
    it('permite o mesmo horário em dias diferentes', () => {
      expect(() =>
        assertValidSlots([
          { weekday: 1, start: '08:00', end: '12:00' },
          { weekday: 2, start: '08:00', end: '12:00' },
        ]),
      ).not.toThrow();
    });
  });
});
