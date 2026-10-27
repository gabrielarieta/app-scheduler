import { adminToken, comboBooking, createCombination, createResource, createRoom, createUser, expectNoOverlaps, range, resourceBooking, roomBooking, TestUser } from './helpers/factory';
import { createTestApp, TestApi, TestContext } from './helpers/test-app';

describe('Reservas — condição de corrida (e2e)', () => {
  let ctx: TestContext;
  let api: TestApi;
  let admin: string;
  let reservers: TestUser[];

  beforeAll(async () => {
    ctx = await createTestApp();
    api = ctx.api;
    admin = await adminToken(api);
    reservers = await Promise.all([1, 2, 3].map((i) => createUser(api, admin, 'RESERVER', `Marca ${i}`)));
  });
  afterAll(() => ctx.stop());

  const pick = (i: number) => reservers[i % reservers.length].token;

  it('10 requisições simultâneas pela MESMA sala e horário: exatamente 1 vence', async () => {
    const room = await createRoom(api, admin);
    const slot = range(2, '10:00', '11:00');

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => api.post('/reservations', pick(i), roomBooking(room.id, slot))),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);

    const list = await api.get(`/reservations?roomId=${room.id}`, admin);
    expect(list.body).toHaveLength(1);
  });

  it('simultâneas pelo mesmo RECURSO: exatamente 1 vence', async () => {
    const res = await createResource(api, admin);
    const slot = range(2, '14:00', '15:00');

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => api.post('/reservations', pick(i), resourceBooking(res.id, slot))),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
  });

  it('horários parcialmente sobrepostos em paralelo: nunca há sobreposição no banco', async () => {
    const room = await createRoom(api, admin);
    const starts = ['10:00', '10:15', '10:30', '10:45'];
    const ends = ['11:00', '11:15', '11:30', '11:45'];

    const results = await Promise.all(
      starts.flatMap((s, i) =>
        [0, 1].map((k) =>
          api.post('/reservations', pick(i + k), roomBooking(room.id, range(3, s, ends[i]))),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
    const list = await api.get(`/reservations?roomId=${room.id}`, admin);
    expectNoOverlaps(list.body);
  });

  it('horários adjacentes (10–11 e 11–12) não conflitam, mesmo em paralelo', async () => {
    const room = await createRoom(api, admin);
    const [a, b] = await Promise.all([
      api.post('/reservations', pick(0), roomBooking(room.id, range(4, '10:00', '11:00'))),
      api.post('/reservations', pick(1), roomBooking(room.id, range(4, '11:00', '12:00'))),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });

  it('combinação x sala x recurso ao mesmo tempo: combinação nunca coexiste com sala/recurso', async () => {
    const room = await createRoom(api, admin);
    const res = await createResource(api, admin);
    const combo = await createCombination(api, admin, room.id, res.id);
    const slot = range(5, '09:00', '10:00');

    const [c, r, x] = await Promise.all([
      api.post('/reservations', pick(0), comboBooking(combo.id, slot)),
      api.post('/reservations', pick(1), roomBooking(room.id, slot)),
      api.post('/reservations', pick(2), resourceBooking(res.id, slot)),
    ]);

    const okCombo = c.status === 201;
    const okRoomOrRes = r.status === 201 || x.status === 201;
    expect(okCombo && okRoomOrRes).toBe(false); // jamais os dois
    expect(okCombo || okRoomOrRes).toBe(true); // alguém precisa ganhar
    // sala e recurso, sozinhos, podem coexistir entre si (não se sobrepõem)
  });

  it('duas combinações que dividem o mesmo recurso (salas diferentes): exatamente 1 vence', async () => {
    const roomA = await createRoom(api, admin);
    const roomB = await createRoom(api, admin);
    const res = await createResource(api, admin);
    const comboA = await createCombination(api, admin, roomA.id, res.id);
    const comboB = await createCombination(api, admin, roomB.id, res.id);
    const slot = range(5, '13:00', '14:00');

    const results = await Promise.all([
      api.post('/reservations', pick(0), comboBooking(comboA.id, slot)),
      api.post('/reservations', pick(1), comboBooking(comboB.id, slot)),
    ]);

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
  });

  it('estresse: 24 tentativas aleatórias em paralelo, invariante "sem sobreposição" se mantém', async () => {
    const room = await createRoom(api, admin);
    const quarters = ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00'];
    const pairs = Array.from({ length: 24 }, (_, i) => {
      const a = i % 11;
      const len = 1 + (i % 3); // 15, 30 ou 45 min
      return range(6, quarters[a], quarters[Math.min(a + len, quarters.length - 1)]);
    }).filter((p) => p.start !== p.end);

    await Promise.all(pairs.map((p, i) => api.post('/reservations', pick(i), roomBooking(room.id, p))));

    const list = await api.get(`/reservations?roomId=${room.id}`, admin);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    expectNoOverlaps(list.body);
  });

  it('cancelar libera o horário para outra pessoa', async () => {
    const room = await createRoom(api, admin);
    const slot = range(7, '10:00', '11:00');

    const first = await api.post('/reservations', pick(0), roomBooking(room.id, slot));
    expect(first.status).toBe(201);
    expect((await api.post('/reservations', pick(1), roomBooking(room.id, slot))).status).toBe(409);

    expect((await api.post(`/reservations/${first.body.id}/cancel`, pick(0))).status).toBe(201);

    expect((await api.post('/reservations', pick(1), roomBooking(room.id, slot))).status).toBe(201);
  });

  it('remarcar para horário ocupado falha e mantém o original; remarcar para livre libera o antigo', async () => {
    const room = await createRoom(api, admin);
    const a = await api.post('/reservations', pick(0), roomBooking(room.id, range(8, '10:00', '11:00')));
    const b = await api.post('/reservations', pick(1), roomBooking(room.id, range(8, '12:00', '13:00')));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    // tenta mover A para cima de B
    const clash = await api.patch(`/reservations/${a.body.id}`, pick(0), range(8, '12:30', '13:30'));
    expect(clash.status).toBe(409);
    const still = await api.get(`/reservations/${a.body.id}`, admin);
    expect(new Date(still.body.start).toISOString()).toBe(range(8, '10:00', '11:00').start);

    // move A para um horário livre
    const moved = await api.patch(`/reservations/${a.body.id}`, pick(0), range(8, '15:00', '16:00'));
    expect(moved.status).toBe(200);

    // o horário antigo (10–11) ficou livre
    const reuse = await api.post('/reservations', pick(2), roomBooking(room.id, range(8, '10:00', '11:00')));
    expect(reuse.status).toBe(201);
    // e o novo (15–16) está ocupado
    const busy = await api.post('/reservations', pick(2), roomBooking(room.id, range(8, '15:00', '16:00')));
    expect(busy.status).toBe(409);
  });

  it('remarcações simultâneas da MESMA reserva: o estado final é consistente e nada vaza', async () => {
    const room = await createRoom(api, admin);
    const a = await api.post('/reservations', pick(0), roomBooking(room.id, range(9, '10:00', '11:00')));
    expect(a.status).toBe(201);

    const optA = range(9, '13:00', '14:00');
    const optB = range(9, '15:00', '16:00');
    const [r1, r2] = await Promise.all([
      api.patch(`/reservations/${a.body.id}`, pick(0), optA),
      api.patch(`/reservations/${a.body.id}`, pick(0), optB),
    ]);
    // Pelo menos uma remarcação vale; a outra pode ter vencido depois ou ter levado 409.
    expect([r1.status, r2.status].some((s) => s === 200)).toBe(true);
    expect([r1.status, r2.status].every((s) => s === 200 || s === 409)).toBe(true);

    // O horário efetivo é o que está gravado; o outro precisa estar livre, o efetivo ocupado,
    // e o original (10–11) liberado — ou seja, nenhuma trava vazou nem faltou.
    const current = await api.get(`/reservations/${a.body.id}`, admin);
    const effective = new Date(current.body.start).toISOString() === optA.start ? optA : optB;
    const other = effective === optA ? optB : optA;

    expect((await api.post('/reservations', pick(1), roomBooking(room.id, other))).status).toBe(201);
    expect((await api.post('/reservations', pick(2), roomBooking(room.id, effective))).status).toBe(409);
    expect((await api.post('/reservations', pick(2), roomBooking(room.id, range(9, '10:00', '11:00')))).status).toBe(201);
  });
});
