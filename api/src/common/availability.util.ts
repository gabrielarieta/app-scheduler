import { BadRequestException } from '@nestjs/common';

export interface Slot {
  weekday: number;
  start: string;
  end: string;
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
const DAY_NAMES = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
];

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Decompõe um instante no fuso informado (dia da semana, minutos desde 00:00, data local). */
export function localParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return {
    weekday: WEEKDAYS[p.weekday],
    minutes: Number(p.hour) * 60 + Number(p.minute),
    dateKey: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Valida as janelas cadastradas: início < fim e sem sobreposição no mesmo dia. */
export function assertValidSlots(slots: Slot[]): void {
  const byDay = new Map<number, Slot[]>();
  for (const s of slots) {
    if (s.start === '24:00' || toMinutes(s.start) >= toMinutes(s.end)) {
      throw new BadRequestException(
        `Horário inválido (${DAY_NAMES[s.weekday]}): o início deve ser anterior ao fim.`,
      );
    }
    byDay.set(s.weekday, [...(byDay.get(s.weekday) ?? []), s]);
  }
  for (const [day, list] of byDay) {
    list.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let i = 1; i < list.length; i++) {
      if (toMinutes(list[i].start) < toMinutes(list[i - 1].end)) {
        throw new BadRequestException(
          `Janelas sobrepostas em ${DAY_NAMES[day]}.`,
        );
      }
    }
  }
}

/** Início e fim caem no mesmo dia local? (fim às 00:00 do dia seguinte é aceito) */
export function endMinutesOnStartDay(
  start: Date,
  end: Date,
  timeZone: string,
): number | null {
  const s = localParts(start, timeZone);
  const e = localParts(end, timeZone);
  if (e.dateKey === s.dateKey) return e.minutes;
  const justBefore = localParts(new Date(end.getTime() - 60_000), timeZone);
  if (justBefore.dateKey === s.dateKey && e.minutes === 0) return 1440;
  return null;
}

/** O intervalo cabe inteiro em uma janela (janelas contíguas são unidas)? */
export function fitsInAvailability(
  slots: Slot[],
  start: Date,
  end: Date,
  timeZone: string,
): boolean {
  const endMin = endMinutesOnStartDay(start, end, timeZone);
  if (endMin === null) return false;
  const s = localParts(start, timeZone);

  const day = slots
    .filter((x) => x.weekday === s.weekday)
    .map((x) => ({ a: toMinutes(x.start), b: toMinutes(x.end) }))
    .sort((x, y) => x.a - y.a);

  const merged: { a: number; b: number }[] = [];
  for (const w of day) {
    const last = merged[merged.length - 1];
    if (last && w.a <= last.b) last.b = Math.max(last.b, w.b);
    else merged.push({ ...w });
  }
  return merged.some((w) => w.a <= s.minutes && w.b >= endMin);
}
