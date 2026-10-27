import { TestApi, ADMIN_EMAIL, ADMIN_PASSWORD } from './test-app';

let counter = 0;
export const uniq = (prefix: string) => `${prefix}-${Date.now()}-${++counter}`;

export const allDays = (start = '08:00', end = '18:00') =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start, end }));

/** Intervalo futuro (UTC) em `daysAhead` dias, de "HH:mm" até "HH:mm". */
export function range(daysAhead: number, from: string, to: string) {
  const make = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysAhead);
    d.setUTCHours(h, m, 0, 0);
    return d.toISOString();
  };
  return { start: make(from), end: make(to) };
}

export async function login(api: TestApi, email: string, password: string): Promise<string> {
  const res = await api.post('/auth/login', undefined, { email, password });
  if (res.status !== 200) throw new Error(`login falhou (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.accessToken;
}

export const adminToken = (api: TestApi) => login(api, ADMIN_EMAIL, ADMIN_PASSWORD);

export interface TestUser {
  id: string;
  name: string;
  email: string;
  token: string;
}

export async function createUser(
  api: TestApi,
  admin: string,
  role: 'ADMIN' | 'MANAGER' | 'RESERVER' | 'VIEWER',
  name = uniq(role.toLowerCase()),
  extra: object = {},
): Promise<TestUser> {
  const email = `${uniq('u')}@test.com`;
  const password = 'Senha12345';
  const res = await api.post('/users', admin, { name, email, password, role, ...extra });
  if (res.status !== 201) throw new Error(`createUser falhou: ${JSON.stringify(res.body)}`);
  return { id: res.body.id, name, email, token: await login(api, email, password) };
}

export async function createRoom(api: TestApi, admin: string, over: object = {}) {
  const res = await api.post('/rooms', admin, {
    name: uniq('Sala'),
    capacity: 10,
    availability: allDays(),
    ...over,
  });
  if (res.status !== 201) throw new Error(`createRoom falhou: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createResource(api: TestApi, admin: string, over: object = {}) {
  const res = await api.post('/resources', admin, {
    name: uniq('Projetor'),
    type: 'Projetor',
    availability: allDays(),
    ...over,
  });
  if (res.status !== 201) throw new Error(`createResource falhou: ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createCombination(
  api: TestApi,
  admin: string,
  roomId: string,
  resourceId: string,
  over: object = {},
) {
  const res = await api.post('/combinations', admin, {
    roomId,
    resourceId,
    availability: allDays(),
    ...over,
  });
  if (res.status !== 201) throw new Error(`createCombination falhou: ${JSON.stringify(res.body)}`);
  return res.body;
}

export const roomBooking = (roomId: string, r: { start: string; end: string }, extra: object = {}) => ({
  targetType: 'ROOM',
  roomId,
  title: uniq('Reunião'),
  ...r,
  ...extra,
});
export const resourceBooking = (resourceId: string, r: { start: string; end: string }, extra: object = {}) => ({
  targetType: 'RESOURCE',
  resourceId,
  title: uniq('Uso'),
  ...r,
  ...extra,
});
export const comboBooking = (combinationId: string, r: { start: string; end: string }, extra: object = {}) => ({
  targetType: 'COMBINATION',
  combinationId,
  title: uniq('Aula'),
  ...r,
  ...extra,
});

export function overlaps(a: { start: string; end: string }, b: { start: string; end: string }) {
  return new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end);
}

export function expectNoOverlaps(list: { start: string; end: string }[]) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (overlaps(list[i], list[j])) {
        throw new Error(`Reservas sobrepostas: ${JSON.stringify(list[i])} x ${JSON.stringify(list[j])}`);
      }
    }
  }
}
