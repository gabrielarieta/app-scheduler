import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongoExceptionFilter } from './common/mongo-exception.filter';

/** Configuração comum à aplicação real (main.ts) e aos testes de integração. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new MongoExceptionFilter());
}
