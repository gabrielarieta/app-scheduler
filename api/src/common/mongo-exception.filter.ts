import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Logger,
} from '@nestjs/common';
import { mongo } from 'mongoose';

@Catch(mongo.MongoServerError)
export class MongoExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Mongo');

  catch(error: InstanceType<typeof mongo.MongoServerError>, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (error.code === 11000) {
      return res.status(409).json({
        statusCode: 409,
        message: 'Já existe um registro com estes dados.',
        error: 'Conflict',
      });
    }
    this.logger.error(error.message, error.stack);
    return res.status(500).json({
      statusCode: 500,
      message: 'Erro interno no banco de dados.',
      error: 'Internal Server Error',
    });
  }
}
