import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** "Quem executa o job agora": evita rodar em duplicidade com várias instâncias da API. */
@Schema({ collection: 'job_leases', versionKey: false })
export class JobLease {
  @Prop({ type: String }) _id: string;
  @Prop({ type: Date, required: true }) until: Date;
}
export const JobLeaseSchema = SchemaFactory.createForClass(JobLease);
