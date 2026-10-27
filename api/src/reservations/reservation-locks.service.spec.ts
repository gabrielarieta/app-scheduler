import { Types } from 'mongoose';
import { LockConflictError, ReservationLocksService } from './reservation-locks.service';

function makeService(slotMinutes?: string) {
  const model: any = {
    collection: { insertMany: jest.fn().mockResolvedValue({}) },
    deleteMany: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({}),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
  const config: any = { get: (k: string) => (k === 'SLOT_MINUTES' ? slotMinutes : undefined) };
  return { service: new ReservationLocksService(model, config), model };
}

const owner = () => ({ reservationId: new Types.ObjectId() });

describe('ReservationLocksService', () => {
  it('usa 15 minutos por padrão e valida SLOT_MINUTES', () => {
    expect(makeService().service.slotMinutes).toBe(15);
    expect(makeService('30').service.slotMinutes).toBe(30);
    expect(() => makeService('7')).toThrow();
    expect(() => makeService('abc')).toThrow();
  });

  describe('acquire', () => {
    it('insere em ordem crescente, com ordered:true, e devolve um token', async () => {
      const { service, model } = makeService();
      const token = await service.acquire(['room:b:2', 'room:a:1', 'room:c:3'], owner());

      expect(typeof token).toBe('string');
      const [docs, opts] = model.collection.insertMany.mock.calls[0];
      expect(docs.map((d: any) => d._id)).toEqual(['room:a:1', 'room:b:2', 'room:c:3']);
      expect(opts).toEqual({ ordered: true });
      expect(docs.every((d: any) => d.token === token && d.expireAt instanceof Date)).toBe(true);
    });

    it('inclui userId quando é trava de presença', async () => {
      const { service, model } = makeService();
      const userId = new Types.ObjectId();
      await service.acquire(['user:u:1'], { reservationId: new Types.ObjectId(), userId });
      expect(model.collection.insertMany.mock.calls[0][0][0].userId).toBe(userId);
    });

    it('lista vazia não toca no banco', async () => {
      const { service, model } = makeService();
      await service.acquire([], owner());
      expect(model.collection.insertMany).not.toHaveBeenCalled();
    });

    it('chave duplicada (11000): desfaz pelo token e lança LockConflictError', async () => {
      const { service, model } = makeService();
      model.collection.insertMany.mockRejectedValue({ code: 11000 });

      await expect(service.acquire(['room:a:1'], owner())).rejects.toBeInstanceOf(LockConflictError);

      expect(model.deleteMany).toHaveBeenCalledTimes(1);
      const filter = model.deleteMany.mock.calls[0][0];
      expect(filter).toEqual({ token: expect.any(String) });
      const insertedToken = model.collection.insertMany.mock.calls[0][0][0].token;
      expect(filter.token).toBe(insertedToken);
    });

    it('reconhece duplicidade vinda de bulk write (writeErrors)', async () => {
      const { service, model } = makeService();
      model.collection.insertMany.mockRejectedValue({ writeErrors: [{ code: 11000 }] });
      await expect(service.acquire(['room:a:1'], owner())).rejects.toBeInstanceOf(LockConflictError);
    });

    it('outro erro: desfaz e repassa o erro original', async () => {
      const { service, model } = makeService();
      const boom = new Error('rede caiu');
      model.collection.insertMany.mockRejectedValue(boom);
      await expect(service.acquire(['room:a:1'], owner())).rejects.toBe(boom);
      expect(model.deleteMany).toHaveBeenCalled();
    });
  });

  describe('ownedBy', () => {
    it('true só se TODAS as chaves são da reserva/pessoa', async () => {
      const { service, model } = makeService();
      model.countDocuments.mockResolvedValue(2);
      expect(await service.ownedBy(['a', 'b'], new Types.ObjectId(), new Types.ObjectId())).toBe(true);
      model.countDocuments.mockResolvedValue(1);
      expect(await service.ownedBy(['a', 'b'], new Types.ObjectId(), new Types.ObjectId())).toBe(false);
    });
  });

  describe('liberação e vencimento', () => {
    it('releaseReservation apaga por reservationId', async () => {
      const { service, model } = makeService();
      const id = new Types.ObjectId();
      await service.releaseReservation(id);
      expect(model.deleteMany).toHaveBeenCalledWith({ reservationId: id });
    });

    it('releaseKeys com lista vazia não faz nada', async () => {
      const { service, model } = makeService();
      await service.releaseKeys([], new Types.ObjectId());
      expect(model.deleteMany).not.toHaveBeenCalled();
    });

    it('confirm define o vencimento definitivo pelo token', async () => {
      const { service, model } = makeService();
      const end = new Date('2026-11-03T11:00:00Z');
      await service.confirm('tok', end);
      expect(model.updateMany).toHaveBeenCalledWith({ token: 'tok' }, { $set: { expireAt: end } });
    });

    it('confirm tenta de novo e nunca lança (3 tentativas)', async () => {
      const { service, model } = makeService();
      model.updateMany.mockRejectedValue(new Error('falha'));
      await expect(service.confirm('tok', new Date())).resolves.toBeUndefined();
      expect(model.updateMany).toHaveBeenCalledTimes(3);
    });
  });
});
