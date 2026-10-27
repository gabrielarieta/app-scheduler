import {
  adminToken, allDays, comboBooking, createCombination, createResource, createRoom, createUser,
  login, range, resourceBooking, roomBooking, uniq,
} from './helpers/factory';
import { createTestApp, TestApi, TestContext } from './helpers/test-app';

describe('Regras de negócio e permissões (e2e)', () => {
  let ctx: TestContext;
  let api: TestApi;
  let admin: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = ctx.api;
    admin = await adminToken(api);
  });
  afterAll(() => ctx.stop());

  describe('cadastro e login', () => {
    it('cadastro fica pendente, só entra depois de aprovado pelo admin', async () => {
      const email = `${uniq('novo')}@test.com`;
      const reg = await api.post('/auth/register', undefined, {
        name: 'Fulano', email, password: 'Senha12345', requestedRole: 'VIEWER',
      });
      expect(reg.status).toBe(201);

      const denied = await api.post('/auth/login', undefined, { email, password: 'Senha12345' });
      expect(denied.status).toBe(403);

      const pending = await api.get('/users?status=PENDING', admin);
      const user = pending.body.find((u: any) => u.email === email);
      expect(user).toBeDefined();
      expect(user.passwordHash).toBeUndefined();

      const approve = await api.patch(`/users/${user.id}`, admin, { role: 'VIEWER', status: 'ACTIVE' });
      expect(approve.status).toBe(200);
      expect(await login(api, email, 'Senha12345')).toEqual(expect.any(String));
    });

    it('senha errada e e-mail duplicado', async () => {
      const u = await createUser(api, admin, 'VIEWER');
      expect((await api.post('/auth/login', undefined, { email: u.email, password: 'errada!!!' })).status).toBe(401);
      const dup = await api.post('/auth/register', undefined, { name: 'Dup', email: u.email, password: 'Senha12345' });
      expect(dup.status).toBe(409);
    });

    it('rotas protegidas exigem token', async () => {
      expect((await api.get('/rooms')).status).toBe(401);
      expect((await api.get('/health')).status).toBe(200);
    });
  });

  describe('permissões por perfil', () => {
    it('só o admin cadastra sala/recurso/combinação e muda status', async () => {
      const reserver = await createUser(api, admin, 'RESERVER');
      const viewer = await createUser(api, admin, 'VIEWER');
      const body = { name: uniq('X'), availability: allDays() };

      expect((await api.post('/rooms', reserver.token, body)).status).toBe(403);
      expect((await api.post('/rooms', viewer.token, body)).status).toBe(403);

      const room = await createRoom(api, admin);
      expect((await api.patch(`/rooms/${room.id}/status`, reserver.token, { status: 'MAINTENANCE' })).status).toBe(403);
      // todos leem o catálogo
      expect((await api.get('/rooms', viewer.token)).status).toBe(200);
    });

    it('quem consulta não cria reserva; quem marca cria', async () => {
      const room = await createRoom(api, admin);
      const reserver = await createUser(api, admin, 'RESERVER');
      const viewer = await createUser(api, admin, 'VIEWER');
      const slot = range(2, '10:00', '11:00');

      expect((await api.post('/reservations', viewer.token, roomBooking(room.id, slot))).status).toBe(403);
      expect((await api.post('/reservations', reserver.token, roomBooking(room.id, slot))).status).toBe(201);
    });

    it('quem consulta só enxerga reservas onde foi adicionado; as demais dão 404', async () => {
      const room = await createRoom(api, admin);
      const reserver = await createUser(api, admin, 'RESERVER');
      const added = await createUser(api, admin, 'VIEWER');
      const outsider = await createUser(api, admin, 'VIEWER');

      const created = await api.post('/reservations', reserver.token,
        roomBooking(room.id, range(2, '10:00', '11:00'), { viewerIds: [added.id] }));
      expect(created.status).toBe(201);
      const id = created.body.id;

      expect((await api.get('/reservations', added.token)).body.map((r: any) => r.id)).toContain(id);
      expect((await api.get('/reservations', outsider.token)).body.map((r: any) => r.id)).not.toContain(id);
      expect((await api.get(`/reservations/${id}`, added.token)).status).toBe(200);
      expect((await api.get(`/reservations/${id}`, outsider.token)).status).toBe(404);
    });

    it('quem marca só altera/cancela a própria reserva e só ele adiciona consultores', async () => {
      const room = await createRoom(api, admin);
      const owner = await createUser(api, admin, 'RESERVER');
      const other = await createUser(api, admin, 'RESERVER');
      const viewer = await createUser(api, admin, 'VIEWER');
      const r = await api.post('/reservations', owner.token, roomBooking(room.id, range(2, '10:00', '11:00')));
      const id = r.body.id;

      expect((await api.patch(`/reservations/${id}`, other.token, { title: 'invasor' })).status).toBe(403);
      expect((await api.post(`/reservations/${id}/cancel`, other.token)).status).toBe(403);
      expect((await api.post(`/reservations/${id}/viewers`, other.token, { userIds: [viewer.id] })).status).toBe(403);

      const add = await api.post(`/reservations/${id}/viewers`, owner.token, { userIds: [viewer.id] });
      expect(add.status).toBe(201);
      expect(add.body.viewers.map((v: any) => v.userId)).toContain(viewer.id);

      // o admin pode tudo
      expect((await api.patch(`/reservations/${id}`, admin, { title: 'ajustada pelo admin' })).status).toBe(200);
    });

    it('lookup de usuários: quem marca pode, quem consulta não', async () => {
      const reserver = await createUser(api, admin, 'RESERVER');
      const viewer = await createUser(api, admin, 'VIEWER', uniq('Maria Busca'));
      const found = await api.get(`/users/lookup?q=${encodeURIComponent('Maria Busca')}`, reserver.token);
      expect(found.status).toBe(200);
      expect(found.body.some((u: any) => u.id === viewer.id)).toBe(true);
      expect((await api.get('/users/lookup', viewer.token)).status).toBe(403);
    });
  });

  describe('validação de horários', () => {
    let room: any;
    let reserver: any;
    beforeAll(async () => {
      room = await createRoom(api, admin, { availability: allDays('09:00', '17:00') });
      reserver = await createUser(api, admin, 'RESERVER');
    });
    const book = (r: { start: string; end: string }) =>
      api.post('/reservations', reserver.token, roomBooking(room.id, r));

    it('fora da disponibilidade → 400', async () => {
      expect((await book(range(2, '07:00', '08:00'))).status).toBe(400);
      expect((await book(range(2, '16:30', '17:30'))).status).toBe(400);
    });
    it('no passado → 400', async () => {
      expect((await book(range(-1, '10:00', '11:00'))).status).toBe(400);
    });
    it('minutos fora do bloco de 15 → 400', async () => {
      expect((await book(range(2, '10:05', '11:00'))).status).toBe(400);
    });
    it('fim antes do início → 400', async () => {
      expect((await book(range(2, '11:00', '10:00'))).status).toBe(400);
    });
    it('atravessando o dia → 400', async () => {
      const r = range(2, '10:00', '11:00');
      const next = new Date(r.end);
      next.setUTCDate(next.getUTCDate() + 1);
      expect((await book({ start: r.start, end: next.toISOString() })).status).toBe(400);
    });
    it('corpo inválido → 400', async () => {
      const res = await api.post('/reservations', reserver.token, { targetType: 'ROOM', roomId: 'abc' });
      expect(res.status).toBe(400);
    });
  });

  describe('status (manutenção / indisponível)', () => {
    it('não reserva em manutenção; informa reservas afetadas; volta ao normal', async () => {
      const room = await createRoom(api, admin);
      const reserver = await createUser(api, admin, 'RESERVER');
      const ok = await api.post('/reservations', reserver.token, roomBooking(room.id, range(3, '10:00', '11:00')));
      expect(ok.status).toBe(201);

      const maint = await api.patch(`/rooms/${room.id}/status`, admin, { status: 'MAINTENANCE', statusNote: 'Troca do ar-condicionado' });
      expect(maint.status).toBe(200);
      expect(maint.body.affectedReservations).toBe(1);

      const blocked = await api.post('/reservations', reserver.token, roomBooking(room.id, range(3, '14:00', '15:00')));
      expect(blocked.status).toBe(409);
      expect(blocked.body.message).toMatch(/manutenção/);

      await api.patch(`/rooms/${room.id}/status`, admin, { status: 'AVAILABLE' });
      expect((await api.post('/reservations', reserver.token, roomBooking(room.id, range(3, '14:00', '15:00')))).status).toBe(201);
    });

    it('recurso indisponível bloqueia também a combinação que o usa', async () => {
      const room = await createRoom(api, admin);
      const res = await createResource(api, admin);
      const combo = await createCombination(api, admin, room.id, res.id);
      const reserver = await createUser(api, admin, 'RESERVER');

      await api.patch(`/resources/${res.id}/status`, admin, { status: 'UNAVAILABLE' });
      const r = await api.post('/reservations', reserver.token, comboBooking(combo.id, range(3, '10:00', '11:00')));
      expect(r.status).toBe(409);
    });
  });

  describe('combinação sala + recurso', () => {
    it('respeita a agenda da combinação e bloqueia sala e recurso isolados', async () => {
      const room = await createRoom(api, admin);
      const res = await createResource(api, admin);
      const combo = await createCombination(api, admin, room.id, res.id, { availability: allDays('09:00', '12:00') });
      const reserver = await createUser(api, admin, 'RESERVER');

      // sala e recurso abertos 8–18, mas a combinação só 9–12
      expect((await api.post('/reservations', reserver.token, comboBooking(combo.id, range(4, '14:00', '15:00')))).status).toBe(400);

      const ok = await api.post('/reservations', reserver.token, comboBooking(combo.id, range(4, '10:00', '11:00')));
      expect(ok.status).toBe(201);
      expect(ok.body.snapshot.room.name).toBe(room.name);
      expect(ok.body.snapshot.resource.name).toBe(res.name);

      expect((await api.post('/reservations', reserver.token, roomBooking(room.id, range(4, '10:30', '11:30')))).status).toBe(409);
      expect((await api.post('/reservations', reserver.token, resourceBooking(res.id, range(4, '10:30', '11:30')))).status).toBe(409);
      // fora do horário da combinação a sala sozinha continua livre
      expect((await api.post('/reservations', reserver.token, roomBooking(room.id, range(4, '14:00', '15:00')))).status).toBe(201);
    });

    it('não permite combinação repetida', async () => {
      const room = await createRoom(api, admin);
      const res = await createResource(api, admin);
      await createCombination(api, admin, room.id, res.id);
      const dup = await api.post('/combinations', admin, { roomId: room.id, resourceId: res.id, availability: allDays() });
      expect(dup.status).toBe(409);
    });
  });

  describe('histórico preservado (snapshot)', () => {
    it('renomear/excluir a sala não altera reservas antigas', async () => {
      const room = await createRoom(api, admin, { name: uniq('Sala Original'), location: 'Bloco A' });
      const reserver = await createUser(api, admin, 'RESERVER');
      const r = await api.post('/reservations', reserver.token, roomBooking(room.id, range(5, '10:00', '11:00')));
      expect(r.status).toBe(201);
      expect(r.body.snapshot.room.name).toBe(room.name);

      // excluir com reserva futura ativa é bloqueado
      expect((await api.del(`/rooms/${room.id}`, admin)).status).toBe(409);

      // renomear não muda o histórico
      await api.patch(`/rooms/${room.id}`, admin, { name: uniq('Sala Renomeada'), location: 'Bloco Z' });
      const after = await api.get(`/reservations/${r.body.id}`, admin);
      expect(after.body.snapshot.room.name).toBe(room.name);
      expect(after.body.snapshot.room.location).toBe('Bloco A');

      // cancela, exclui a sala e a reserva continua consultável
      await api.post(`/reservations/${r.body.id}/cancel`, reserver.token);
      expect((await api.del(`/rooms/${room.id}`, admin)).status).toBe(204);
      const gone = await api.get(`/reservations/${r.body.id}`, admin);
      expect(gone.status).toBe(200);
      expect(gone.body.snapshot.room.name).toBe(room.name);
    });
  });
});
