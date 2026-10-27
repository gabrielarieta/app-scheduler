import { getModelToken } from '@nestjs/mongoose';
import { JobsService } from '../src/jobs/jobs.service';
import { Reservation } from '../src/reservations/reservation.schema';
import { adminToken, allDays, createRoom, createUser, range, roomBooking, uniq } from './helpers/factory';
import { createTestApp, TestApi, TestContext } from './helpers/test-app';

const code = () => `U${Math.floor(Math.random() * 1e8)}`;

describe('Unidades, aprovação, no-show, relatórios, iCal e preferências (e2e)', () => {
  let ctx: TestContext;
  let api: TestApi;
  let admin: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = ctx.api;
    admin = await adminToken(api);
  });
  afterAll(() => ctx.stop());

  const unit = async (extra: object = {}) => (await api.post('/units', admin, { name: uniq('Campus'), code: code(), ...extra })).body;
  const notifs = async (t: string) => (await api.get('/notifications', t)).body as any[];

  it('unidades: gestor administra só a sua; itens de outra unidade ficam ocultos e inacessíveis', async () => {
    const A = await unit();
    const B = await unit();
    const mgrA = await createUser(api, admin, 'MANAGER', undefined, { unitIds: [A.id] });

    const own = await api.post('/rooms', mgrA.token, { name: uniq('SA'), availability: allDays(), unitId: A.id });
    expect(own.status).toBe(201);
    expect((await api.post('/rooms', mgrA.token, { name: uniq('SB'), availability: allDays(), unitId: B.id })).status).toBe(403);
    expect((await api.post('/rooms', mgrA.token, { name: uniq('SX'), availability: allDays() })).status).toBe(403); // sem unidade

    const roomB = await createRoom(api, admin, { unitId: B.id });
    expect((await api.get('/rooms', mgrA.token)).body.some((r: any) => r.id === roomB.id)).toBe(false);
    expect((await api.get(`/rooms/${roomB.id}`, mgrA.token)).status).toBe(404);
    expect((await api.patch(`/rooms/${roomB.id}/status`, mgrA.token, { status: 'MAINTENANCE' })).status).toBe(403);

    const reserverA = await createUser(api, admin, 'RESERVER', undefined, { unitIds: [A.id] });
    expect((await api.post('/reservations', reserverA.token, roomBooking(roomB.id, range(2, '10:00', '11:00')))).status).toBe(403);
    expect((await api.post('/reservations', reserverA.token, roomBooking(own.body.id, range(2, '10:00', '11:00')))).status).toBe(201);
  });

  it('aprovação: pendente segura o horário, consultor só vê depois de aprovada, outro gestor não decide', async () => {
    const U = await unit();
    const other = await unit();
    const mgr = await createUser(api, admin, 'MANAGER', undefined, { unitIds: [U.id] });
    const mgrOther = await createUser(api, admin, 'MANAGER', undefined, { unitIds: [other.id] });
    const reserver = await createUser(api, admin, 'RESERVER', undefined, { unitIds: [U.id] });
    const rival = await createUser(api, admin, 'RESERVER', undefined, { unitIds: [U.id] });
    const viewer = await createUser(api, admin, 'VIEWER', undefined, { unitIds: [U.id] });
    const room = await createRoom(api, admin, { unitId: U.id, requiresApproval: true });

    const r = await api.post('/reservations', reserver.token, roomBooking(room.id, range(3, '10:00', '11:00'), { viewerIds: [viewer.id] }));
    expect(r.status).toBe(201);
    expect(r.body.approvalStatus).toBe('PENDING');

    // segura o horário e esconde do consultor
    expect((await api.post('/reservations', rival.token, roomBooking(room.id, range(3, '10:00', '11:00')))).status).toBe(409);
    expect((await api.get(`/reservations/${r.body.id}`, viewer.token)).status).toBe(404);
    expect((await api.post(`/reservations/${r.body.id}/attendance`, viewer.token)).status).toBe(409);

    // quem decide
    expect((await api.get('/reservations/pending-approval', reserver.token)).status).toBe(403);
    const pending = await api.get('/reservations/pending-approval', mgr.token);
    expect(pending.body.some((x: any) => x.id === r.body.id)).toBe(true);
    expect((await api.get('/reservations/pending-approval', mgrOther.token)).body.some((x: any) => x.id === r.body.id)).toBe(false);
    expect((await api.post(`/reservations/${r.body.id}/approve`, reserver.token, {})).status).toBe(403);
    expect((await api.post(`/reservations/${r.body.id}/approve`, mgrOther.token, {})).status).toBe(403);

    const ok = await api.post(`/reservations/${r.body.id}/approve`, mgr.token, { note: 'ok' });
    expect(ok.status).toBe(200);
    expect(ok.body.approvalStatus).toBe('APPROVED');
    expect((await api.get(`/reservations/${r.body.id}`, viewer.token)).status).toBe(200);
    expect((await notifs(reserver.token)).some((n) => n.type === 'RESERVATION_APPROVED')).toBe(true);
    expect((await api.post(`/reservations/${r.body.id}/approve`, mgr.token, {})).status).toBe(409); // já decidida

    // recusar libera o horário
    const r2 = await api.post('/reservations', reserver.token, roomBooking(room.id, range(3, '13:00', '14:00')));
    const rej = await api.post(`/reservations/${r2.body.id}/reject`, mgr.token, { note: 'conflito com prova' });
    expect(rej.body.approvalStatus).toBe('REJECTED');
    expect((await api.get(`/reservations/${r2.body.id}`, admin)).body.status).toBe('CANCELLED');
    expect((await api.post('/reservations', rival.token, roomBooking(room.id, range(3, '13:00', '14:00')))).status).toBe(201);

    // gestor reservando item sensível da própria unidade: aprovada automaticamente
    const mine = await api.post('/reservations', mgr.token, roomBooking(room.id, range(3, '15:00', '16:00')));
    expect(mine.body.approvalStatus).toBe('APPROVED');
  });

  it('no-show: cancela sem check-in após a tolerância; início/check-in evita; relatório conta', async () => {
    const U = await unit({ noShowGraceMinutes: 10 });
    const reserver = await createUser(api, admin, 'RESERVER', undefined, { unitIds: [U.id] });
    const viewer = await createUser(api, admin, 'VIEWER', undefined, { unitIds: [U.id] });
    const room1 = await createRoom(api, admin, { unitId: U.id });
    const room2 = await createRoom(api, admin, { unitId: U.id });

    const r1 = await api.post('/reservations', reserver.token, roomBooking(room1.id, range(3, '10:00', '11:00'), { viewerIds: [viewer.id] }));
    const r2 = await api.post('/reservations', reserver.token, roomBooking(room2.id, range(3, '10:00', '11:00')));
    expect(r1.body.noShowGraceMinutes).toBe(10); // herdado da unidade

    // simula "agora é 20 min depois do início" (sem esperar de verdade)
    const model: any = ctx.app.get(getModelToken(Reservation.name));
    const now = Date.now();
    const past = { start: new Date(now - 20 * 60_000), end: new Date(now + 40 * 60_000) };
    await model.updateOne({ _id: r1.body.id }, { $set: past });
    await model.updateOne({ _id: r2.body.id }, { $set: past });

    expect((await api.post(`/reservations/${r2.body.id}/start`, reserver.token)).body.startedAt).toBeDefined();

    const cancelled = await ctx.app.get(JobsService).cancelNoShows();
    expect(cancelled).toBeGreaterThanOrEqual(1);
    const a = (await api.get(`/reservations/${r1.body.id}`, admin)).body;
    expect(a.status).toBe('CANCELLED');
    expect(a.cancelReason).toBe('NO_SHOW');
    expect((await api.get(`/reservations/${r2.body.id}`, admin)).body.status).toBe('ACTIVE');
    expect((await notifs(viewer.token)).some((n) => n.type === 'RESERVATION_CANCELLED')).toBe(true);

    // relatório (gestor de outra unidade não acessa; admin e gestor da unidade sim)
    const other = await unit();
    const mgrOther = await createUser(api, admin, 'MANAGER', undefined, { unitIds: [other.id] });
    const mgr = await createUser(api, admin, 'MANAGER', undefined, { unitIds: [U.id] });
    const qs = `from=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 10 * 86_400_000).toISOString())}`;

    expect((await api.get(`/reports/occupancy?${qs}&unitId=${U.id}`, mgrOther.token)).status).toBe(403);
    expect((await api.get(`/reports/occupancy?${qs}`, reserver.token)).status).toBe(403);

    const rep = await api.get(`/reports/occupancy?${qs}`, mgr.token);
    expect(rep.status).toBe(200);
    const row1 = rep.body.rooms.find((x: any) => x.id === room1.id);
    const row2 = rep.body.rooms.find((x: any) => x.id === room2.id);
    expect(row1.noShow).toBe(1);
    expect(row1.noShowRate).toBe(1);
    expect(row2.reservedMinutes).toBe(60);
    expect(row2.availableMinutes).toBeGreaterThan(0);
    expect(rep.body.totals.noShow).toBe(1);
    expect(rep.body.peak.byHour).toHaveLength(24);

    const csv = await api.get(`/reports/occupancy.csv?${qs}`, mgr.token);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\n')[0]).toContain('taxa_ocupacao');
  });

  it('pendência não aprovada até o início expira e libera o horário', async () => {
    const U = await unit();
    const reserver = await createUser(api, admin, 'RESERVER', undefined, { unitIds: [U.id] });
    const room = await createRoom(api, admin, { unitId: U.id, requiresApproval: true });
    const r = await api.post('/reservations', reserver.token, roomBooking(room.id, range(3, '10:00', '11:00')));
    await (ctx.app.get(getModelToken(Reservation.name)) as any).updateOne({ _id: r.body.id }, { $set: { start: new Date(Math.floor(Date.now() / 60_000) * 60_000 - 5 * 60_000), end: new Date(Math.floor(Date.now() / 60_000) * 60_000 + 55 * 60_000) } });

    expect(await ctx.app.get(JobsService).expirePending()).toBeGreaterThanOrEqual(1);
    const after = (await api.get(`/reservations/${r.body.id}`, admin)).body;
    expect(after.status).toBe('CANCELLED');
    expect(after.approvalStatus).toBe('EXPIRED');
  });

  it('iCal: feed por token secreto, exportação e rotação do token', async () => {
    const reserver = await createUser(api, admin, 'RESERVER');
    const room = await createRoom(api, admin);
    const title = uniq('Aula ICS');
    expect((await api.post('/reservations', reserver.token, roomBooking(room.id, range(4, '10:00', '11:00'), { title }))).status).toBe(201);

    const feed = await api.get('/calendar/feed-url', reserver.token);
    expect(feed.body.url).toContain('/api/calendar/feed/');
    const path = new URL(feed.body.url).pathname.replace(/^\/api/, '');

    const ics = await api.get(path); // público: sem Bearer
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.text).toContain('BEGIN:VEVENT');
    expect(ics.text).toContain(title);
    expect((await api.get('/calendar/feed/token-invalido.ics')).status).toBe(404);

    const exp = await api.get('/calendar/export.ics', reserver.token);
    expect(exp.status).toBe(200);
    expect(exp.headers['content-disposition']).toMatch(/attachment/);

    const rotated = await api.post('/calendar/feed-url/rotate', reserver.token);
    expect(rotated.body.url).not.toBe(feed.body.url);
    expect((await api.get(path)).status).toBe(404); // URL antiga invalidada
  });

  it('preferências de notificação (e-mail/push)', async () => {
    const u = await createUser(api, admin, 'VIEWER');
    expect((await api.get('/users/me/preferences', u.token)).body).toEqual({ email: true, push: true });
    const r = await api.patch('/users/me/preferences', u.token, { email: false });
    expect(r.body).toEqual({ email: false, push: true });
    expect((await api.get('/users/me/preferences', u.token)).body.email).toBe(false);
    expect((await api.post('/devices', u.token, { token: uniq('fcm-token'), platform: 'android' })).status).toBe(200);
  });
});
