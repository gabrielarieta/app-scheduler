import {
  adminToken, allDays, createRoom, createUser, range, roomBooking, TestUser, uniq,
} from './helpers/factory';
import { createTestApp, TestApi, TestContext } from './helpers/test-app';

describe('Funcionalidades extras (e2e)', () => {
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

  const notifications = async (u: TestUser) => (await api.get('/notifications', u.token)).body as any[];

  it('Idempotency-Key: repetir a requisição devolve a mesma reserva, sem duplicar', async () => {
    const room = await createRoom(api, admin);
    const body = roomBooking(room.id, range(2, '10:00', '11:00'));
    const key = uniq('idem-key');
    const post = () => api.req().post('/api/reservations').set('Authorization', `Bearer ${reserver.token}`).set('Idempotency-Key', key).send(body);

    const a = await post();
    const b = await post();
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);

    const list = await api.get(`/reservations?roomId=${room.id}`, admin);
    expect(list.body).toHaveLength(1);
  });

  it('recorrência: cria semanais, pula conflitos (SKIP) e cancela a série', async () => {
    const room = await createRoom(api, admin);
    const other = await createUser(api, admin, 'RESERVER');
    // ocupa a 3ª semana
    const blocker = await api.post('/reservations', other.token, roomBooking(room.id, range(2 + 14, '10:00', '11:00')));
    expect(blocker.status).toBe(201);

    const r = await api.post('/reservations/series', reserver.token, {
      ...roomBooking(room.id, range(2, '10:00', '11:00')), occurrences: 4,
    });
    expect(r.status).toBe(201);
    expect(r.body.created).toHaveLength(3);
    expect(r.body.skipped).toHaveLength(1);

    const cancel = await api.post(`/reservations/series/${r.body.seriesId}/cancel`, reserver.token);
    expect(cancel.body.cancelled).toBe(3);
    const left = await api.get(`/reservations?roomId=${room.id}`, admin);
    expect(left.body).toHaveLength(1); // só a do bloqueador
  });

  it('recorrência com FAIL desfaz tudo se alguma ocorrência conflitar', async () => {
    const room = await createRoom(api, admin);
    const other = await createUser(api, admin, 'RESERVER');
    await api.post('/reservations', other.token, roomBooking(room.id, range(2 + 7, '10:00', '11:00')));
    const r = await api.post('/reservations/series', reserver.token, {
      ...roomBooking(room.id, range(2, '10:00', '11:00')), occurrences: 3, onConflict: 'FAIL',
    });
    expect(r.status).toBe(409);
    const list = await api.get(`/reservations?roomId=${room.id}`, admin);
    expect(list.body).toHaveLength(1);
  });

  it('lista de espera: só entra se o horário está ocupado e é avisado quando libera', async () => {
    const room = await createRoom(api, admin);
    const owner = await createUser(api, admin, 'RESERVER');
    const waiter = await createUser(api, admin, 'RESERVER');
    const slot = range(3, '10:00', '11:00');
    const target = { targetType: 'ROOM', roomId: room.id, ...slot };

    expect((await api.post('/waitlist', waiter.token, target)).status).toBe(409); // livre: reserve direto

    const booked = await api.post('/reservations', owner.token, roomBooking(room.id, slot));
    expect((await api.post('/waitlist', waiter.token, target)).status).toBe(201);

    await api.post(`/reservations/${booked.body.id}/cancel`, owner.token);
    const inbox = await notifications(waiter);
    expect(inbox.some((n) => n.type === 'WAITLIST_SLOT_FREE')).toBe(true);
  });

  it('manutenção: avisa as pessoas e pode cancelar as reservas afetadas', async () => {
    const room = await createRoom(api, admin);
    const viewer = await createUser(api, admin, 'VIEWER');
    const r = await api.post('/reservations', reserver.token, roomBooking(room.id, range(4, '10:00', '11:00'), { viewerIds: [viewer.id] }));
    expect(r.status).toBe(201);

    const s = await api.patch(`/rooms/${room.id}/status`, admin, { status: 'MAINTENANCE', statusNote: 'Reforma', cancelAffectedReservations: true });
    expect(s.status).toBe(200);
    expect(s.body.affectedReservations).toBe(1);
    expect(s.body.cancelledReservations).toBe(1);

    const after = await api.get(`/reservations/${r.body.id}`, admin);
    expect(after.body.status).toBe('CANCELLED');
    expect((await notifications(viewer)).some((n) => n.type === 'RESERVATION_CANCELLED')).toBe(true);
    expect((await notifications(reserver)).some((n) => n.type === 'RESERVATION_CANCELLED')).toBe(true);
  });

  it('notificações: contador, marcar como lida', async () => {
    const room = await createRoom(api, admin);
    const viewer = await createUser(api, admin, 'VIEWER');
    await api.post('/reservations', reserver.token, roomBooking(room.id, range(5, '10:00', '11:00'), { viewerIds: [viewer.id] }));

    expect((await api.get('/notifications/unread-count', viewer.token)).body.count).toBe(1);
    const [n] = await notifications(viewer);
    expect((await api.post(`/notifications/${n.id}/read`, viewer.token)).status).toBe(200);
    expect((await api.get('/notifications/unread-count', viewer.token)).body.count).toBe(0);
  });

  it('refresh token: renova, rotaciona (o antigo deixa de valer) e logout invalida', async () => {
    const email = `${uniq('r')}@test.com`;
    await api.post('/users', admin, { name: 'Refresh', email, password: 'Senha12345', role: 'VIEWER' });
    const login = await api.post('/auth/login', undefined, { email, password: 'Senha12345' });
    expect(login.body.refreshToken).toEqual(expect.any(String));

    const r1 = await api.post('/auth/refresh', undefined, { refreshToken: login.body.refreshToken });
    expect(r1.status).toBe(200);
    expect((await api.get('/auth/me', r1.body.accessToken)).status).toBe(200);

    expect((await api.post('/auth/refresh', undefined, { refreshToken: login.body.refreshToken })).status).toBe(401);

    await api.post('/auth/logout', undefined, { refreshToken: r1.body.refreshToken });
    expect((await api.post('/auth/refresh', undefined, { refreshToken: r1.body.refreshToken })).status).toBe(401);
  });

  it('paginação: X-Total-Count e limit/page', async () => {
    const room = await createRoom(api, admin);
    for (const h of ['09:00', '10:00', '11:00']) {
      await api.post('/reservations', reserver.token, roomBooking(room.id, range(6, h, `${String(Number(h.slice(0, 2)) + 1).padStart(2, '0')}:00`)));
    }
    const res = await api.get(`/reservations?roomId=${room.id}&limit=2&page=2`, admin);
    expect(res.headers['x-total-count']).toBe('3');
    expect(res.body).toHaveLength(1);
  });

  it('auditoria: admin vê quem fez a escrita; outros perfis não acessam', async () => {
    const room = await createRoom(api, admin);
    const r = await api.post('/reservations', reserver.token, roomBooking(room.id, range(7, '10:00', '11:00')));
    const logs = await api.get(`/audit?entityId=${r.body.id}`, admin);
    expect(logs.status).toBe(200);
    expect(logs.body.some((l: any) => l.method === 'POST' && l.actorName === reserver.name)).toBe(true);
    expect((await api.get('/audit', reserver.token)).status).toBe(403);
  });

  it('check-in: código do organizador valida a presença do consultor (dentro da janela)', async () => {
    // reserva começando no próximo quarto de hora, dentro da janela de 15 min antes do início
    const now = new Date();
    const start = new Date(Math.ceil((+now + 60_000) / 900_000) * 900_000);
    const end = new Date(+start + 30 * 60_000);
    if (start.getUTCDate() !== end.getUTCDate()) return; // evita virada de dia UTC no teste

    const room = await createRoom(api, admin, { availability: allDays('00:00', '24:00') });
    const viewer = await createUser(api, admin, 'VIEWER');
    const r = await api.post('/reservations', reserver.token, roomBooking(room.id, { start: start.toISOString(), end: end.toISOString() }, { viewerIds: [viewer.id] }));
    expect(r.status).toBe(201);

    const code = await api.get(`/reservations/${r.body.id}/check-in-code`, reserver.token);
    expect(code.status).toBe(200);
    expect((await api.get(`/reservations/${r.body.id}/check-in-code`, viewer.token)).status).toBe(403);

    expect((await api.post(`/reservations/${r.body.id}/check-in`, viewer.token, { code: '000000' === code.body.code ? '111111' : '000000' })).status).toBe(409);
    const ok = await api.post(`/reservations/${r.body.id}/check-in`, viewer.token, { code: code.body.code });
    expect(ok.status).toBe(200);
    expect(ok.body.viewers[0].checkedInAt).toBeDefined();
  });
});
