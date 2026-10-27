import {
  adminToken, createRoom, createUser, range, roomBooking, TestUser,
} from './helpers/factory';
import { createTestApp, TestApi, TestContext } from './helpers/test-app';

describe('Confirmação de presença (e2e)', () => {
  let ctx: TestContext;
  let api: TestApi;
  let admin: string;
  let reserver: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = ctx.api;
    admin = await adminToken(api);
    reserver = await createUser(api, admin, 'RESERVER');
  });
  afterAll(() => ctx.stop());

  /** Cria uma reserva (em sala própria) com os alunos informados como consultores. */
  async function reservation(day: number, from: string, to: string, viewers: TestUser[], token = reserver.token) {
    const room = await createRoom(api, admin);
    const res = await api.post('/reservations', token, roomBooking(room.id, range(day, from, to), { viewerIds: viewers.map((v) => v.id) }));
    expect(res.status).toBe(201);
    return res.body as any;
  }
  const confirm = (id: string, u: TestUser) => api.post(`/reservations/${id}/attendance`, u.token);
  const unconfirm = (id: string, u: TestUser) => api.del(`/reservations/${id}/attendance`, u.token);
  const myConfirmed = (r: any, u: TestUser) => r.viewers.find((v: any) => v.userId === u.id)?.confirmedAt;

  it('confirmar presença marca o aluno e é idempotente', async () => {
    const s = await createUser(api, admin, 'VIEWER');
    const x = await reservation(2, '10:00', '11:00', [s]);

    const first = await confirm(x.id, s);
    expect(first.status).toBe(200);
    expect(myConfirmed(first.body, s)).toBeDefined();

    const again = await confirm(x.id, s);
    expect(again.status).toBe(200);
    expect(myConfirmed(again.body, s)).toBe(myConfirmed(first.body, s));
  });

  it('só quem foi adicionado pode confirmar (os demais recebem 404)', async () => {
    const s = await createUser(api, admin, 'VIEWER');
    const intruder = await createUser(api, admin, 'VIEWER');
    const x = await reservation(2, '10:00', '11:00', [s]);
    expect((await confirm(x.id, intruder)).status).toBe(404);
  });

  it('bloqueia confirmar duas reservas que se sobrepõem (mesmo em salas diferentes)', async () => {
    const s = await createUser(api, admin, 'VIEWER');
    const x = await reservation(3, '10:00', '11:00', [s]); // sala A
    const y = await reservation(3, '10:30', '11:30', [s]); // sala B, sobrepõe X

    expect((await confirm(x.id, s)).status).toBe(200);
    const clash = await confirm(y.id, s);
    expect(clash.status).toBe(409);
    expect(clash.body.message).toMatch(/mesmo horário/);
  });

  it('bloqueia também contra N reservas já confirmadas e libera quando as desfaz', async () => {
    const s = await createUser(api, admin, 'VIEWER');
    const x = await reservation(3, '10:00', '11:00', [s]);
    const z = await reservation(3, '11:00', '12:00', [s]); // adjacente a X: não conflita
    const y = await reservation(3, '10:30', '11:30', [s]); // sobrepõe X e Z

    expect((await confirm(x.id, s)).status).toBe(200);
    expect((await confirm(z.id, s)).status).toBe(200); // adjacentes: ok
    expect((await confirm(y.id, s)).status).toBe(409);

    expect((await unconfirm(x.id, s)).status).toBe(200);
    expect((await confirm(y.id, s)).status).toBe(409); // ainda conflita com Z

    expect((await unconfirm(z.id, s)).status).toBe(200);
    expect((await confirm(y.id, s)).status).toBe(200); // agora livre
  });

  it('horários que não se sobrepõem podem ser todos confirmados', async () => {
    const s = await createUser(api, admin, 'VIEWER');
    const a = await reservation(4, '09:00', '10:00', [s]);
    const b = await reservation(4, '13:00', '14:00', [s]);
    expect((await confirm(a.id, s)).status).toBe(200);
    expect((await confirm(b.id, s)).status).toBe(200);
  });

  it('o bloqueio é por pessoa: outro aluno confirma o mesmo horário sem problemas', async () => {
    const s1 = await createUser(api, admin, 'VIEWER');
    const s2 = await createUser(api, admin, 'VIEWER');
    const x = await reservation(4, '10:00', '11:00', [s1, s2]);
    const y = await reservation(4, '10:00', '11:00', [s1, s2]);

    expect((await confirm(x.id, s1)).status).toBe(200);
    expect((await confirm(y.id, s2)).status).toBe(200);
    expect((await confirm(y.id, s1)).status).toBe(409);
  });

  it('CORRIDA: confirmações simultâneas em reservas concorrentes — só uma prevalece', async () => {
    const s = await createUser(api, admin, 'VIEWER');
    const p = await reservation(5, '10:00', '11:00', [s]);
    const q = await reservation(5, '10:15', '11:15', [s]);

    // várias requisições ao mesmo tempo (inclui duplicadas, como duplo clique / 2 aparelhos)
    const results = await Promise.all([confirm(p.id, s), confirm(q.id, s), confirm(p.id, s), confirm(q.id, s)]);
    const okP = [results[0], results[2]].filter((r) => r.status === 200).length;
    const okQ = [results[1], results[3]].filter((r) => r.status === 200).length;

    expect(okP > 0 && okQ > 0).toBe(false); // nunca as duas
    expect(okP + okQ).toBeGreaterThan(0); // alguma vence

    // estado final no banco: exatamente uma confirmada
    const list = await api.get('/reservations', s.token);
    const confirmed = list.body.filter((r: any) => myConfirmed(r, s));
    expect(confirmed).toHaveLength(1);
  });

  it('cancelar a reserva libera o tempo do aluno', async () => {
    const s = await createUser(api, admin, 'VIEWER');
    const x = await reservation(6, '10:00', '11:00', [s]);
    const y = await reservation(6, '10:30', '11:30', [s]);

    expect((await confirm(x.id, s)).status).toBe(200);
    expect((await confirm(y.id, s)).status).toBe(409);

    await api.post(`/reservations/${x.id}/cancel`, reserver.token);
    expect((await confirm(y.id, s)).status).toBe(200);
  });

  it('não confirma reserva cancelada', async () => {
    const s = await createUser(api, admin, 'VIEWER');
    const x = await reservation(6, '14:00', '15:00', [s]);
    await api.post(`/reservations/${x.id}/cancel`, reserver.token);
    expect((await confirm(x.id, s)).status).toBe(409);
  });

  it('remarcar a reserva zera as confirmações; o aluno pode confirmar de novo', async () => {
    const s = await createUser(api, admin, 'VIEWER');
    const x = await reservation(7, '10:00', '11:00', [s]);
    const other = await reservation(7, '12:00', '13:00', [s]);

    expect((await confirm(x.id, s)).status).toBe(200);
    // X confirmado ocupa 10–11; ao remarcar para 15–16 a confirmação é zerada...
    const moved = await api.patch(`/reservations/${x.id}`, reserver.token, range(7, '15:00', '16:00'));
    expect(moved.status).toBe(200);
    expect(myConfirmed(moved.body, s)).toBeUndefined();

    // ...e o tempo antigo (10–11) deixou de estar ocupado para o aluno
    const probe = await reservation(7, '10:00', '11:00', [s]);
    expect((await confirm(probe.id, s)).status).toBe(200);
    // enquanto 'other' (12–13) segue livre para confirmar
    expect((await confirm(other.id, s)).status).toBe(200);
  });

  it('remover o aluno da reserva libera o tempo dele e impede nova confirmação', async () => {
    const s = await createUser(api, admin, 'VIEWER');
    const x = await reservation(8, '10:00', '11:00', [s]);
    const y = await reservation(8, '10:30', '11:30', [s]);

    expect((await confirm(x.id, s)).status).toBe(200);
    const removed = await api.del(`/reservations/${x.id}/viewers/${s.id}`, reserver.token);
    expect(removed.status).toBe(200);

    expect((await confirm(x.id, s)).status).toBe(404); // saiu da lista
    expect((await confirm(y.id, s)).status).toBe(200); // tempo liberado
  });

  it('quem marca (RESERVER) também pode ser consultor e confirmar presença em reserva de outro', async () => {
    const other = await createUser(api, admin, 'RESERVER');
    const x = await reservation(9, '10:00', '11:00', [other]);
    expect((await confirm(x.id, other)).status).toBe(200);
  });
});
