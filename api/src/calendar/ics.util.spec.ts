import { buildCalendar, escapeText, fmtUtc, fold } from './ics.util';

describe('ics.util', () => {
  it('escapa vírgula, ponto e vírgula, barra e quebra de linha', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('formata datas em UTC (YYYYMMDDTHHMMSSZ)', () => {
    expect(fmtUtc(new Date('2026-11-03T13:00:00.000Z'))).toBe('20261103T130000Z');
  });

  it('dobra linhas longas em até 75 octetos sem partir caracteres', () => {
    const line = 'SUMMARY:' + 'ã'.repeat(100);
    const folded = fold(line);
    for (const l of folded.split('\r\n')) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('monta um VCALENDAR com CRLF e os campos do evento', () => {
    const ics = buildCalendar(
      [{
        uid: 'abc@agenda', start: new Date('2026-11-03T13:00:00Z'), end: new Date('2026-11-03T14:00:00Z'),
        summary: 'Aula, turma A', description: 'Linha1\nLinha2', location: 'Sala 1', status: 'TENTATIVE',
        sequence: 5, stamp: new Date('2026-10-01T00:00:00Z'),
      }],
      'Agenda — Maria',
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:abc@agenda');
    expect(ics).toContain('DTSTART:20261103T130000Z');
    expect(ics).toContain('STATUS:TENTATIVE');
    expect(ics).toContain('SUMMARY:Aula\\, turma A');
    expect(ics).toContain('DESCRIPTION:Linha1\\nLinha2');
    expect(ics).toContain('LOCATION:Sala 1');
  });
});
