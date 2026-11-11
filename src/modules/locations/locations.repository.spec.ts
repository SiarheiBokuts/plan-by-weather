import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LocationsRepository } from './locations.repository';

const uniqueViolation = (): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

const match = {
  id: 42,
  name: 'Testville',
  country: null,
  countryCode: null,
  region: null,
  latitude: 1,
  longitude: 2,
  elevation: null,
  timezone: 'UTC',
  population: null,
  featureCode: 'PPL',
};

function setup(transaction: jest.Mock) {
  const prisma = { $transaction: transaction };
  return new LocationsRepository(prisma as unknown as PrismaService);
}

describe('LocationsRepository.saveResolved, when two requests save the same new city at once', () => {
  const save = (repository: LocationsRepository) =>
    repository.saveResolved(match, 'testville|', new Date());

  it('retries once after a duplicate-key error (the row already exists) and succeeds', async () => {
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce({ id: 1, name: 'Testville' });
    await expect(save(setup(transaction))).resolves.toMatchObject({ name: 'Testville' });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('gives up if the duplicate-key error repeats', async () => {
    const transaction = jest.fn().mockRejectedValue(uniqueViolation());
    await expect(save(setup(transaction))).rejects.toMatchObject({ code: 'P2002' });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry other database errors', async () => {
    const transaction = jest.fn().mockRejectedValue(new Error('connection lost'));
    await expect(save(setup(transaction))).rejects.toThrow('connection lost');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
