import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

export const ADMIN_EMAIL = 'admin@test.com';
export const ADMIN_PASSWORD = 'Admin12345';

export class TestApi {
  constructor(public readonly app: INestApplication) {}

  req() {
    return request(this.app.getHttpServer());
  }
  private auth(r: request.Test, token?: string) {
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  }
  get(path: string, token?: string) {
    return this.auth(this.req().get(`/api${path}`), token);
  }
  post(path: string, token?: string, body: object = {}) {
    return this.auth(this.req().post(`/api${path}`), token).send(body);
  }
  patch(path: string, token: string | undefined, body: object) {
    return this.auth(this.req().patch(`/api${path}`), token).send(body);
  }
  del(path: string, token?: string) {
    return this.auth(this.req().delete(`/api${path}`), token);
  }
}

export interface TestContext {
  app: INestApplication;
  api: TestApi;
  stop: () => Promise<void>;
}

/**
 * Sobe a aplicação inteira contra um MongoDB de verdade.
 *  - Padrão: mongodb-memory-server (baixa o binário do mongod na 1ª execução).
 *  - Alternativa: defina TEST_MONGO_URI (ex.: mongodb://localhost:27017) e um banco
 *    exclusivo é criado e apagado ao final.
 */
export async function createTestApp(): Promise<TestContext> {
  let mongod: MongoMemoryServer | undefined;
  let uri: string;
  const external = process.env.TEST_MONGO_URI;

  if (external) {
    const u = new URL(external);
    u.pathname = `/agenda_e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    uri = u.toString();
  } else {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri('agenda_e2e');
  }

  Object.assign(process.env, {
    MONGO_URI: uri,
    JWT_SECRET: 'segredo-de-teste',
    APP_TIMEZONE: 'UTC', // simplifica as contas de horário nos testes
    SLOT_MINUTES: '15',
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    ENABLE_SWAGGER: 'false',
    JOBS_ENABLED: 'false', // os testes chamam JobsService diretamente
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  // Garante que índices únicos/TTL já foram criados antes do primeiro teste.
  const conn = app.get<any>(getConnectionToken());
  await Promise.all(conn.modelNames().map((n: string) => conn.model(n).init()));

  return {
    app,
    api: new TestApi(app),
    stop: async () => {
      if (external) {
        try {
          await app.get<any>(getConnectionToken()).dropDatabase();
        } catch {
          /* ignora */
        }
      }
      await app.close();
      await mongod?.stop();
    },
  };
}
