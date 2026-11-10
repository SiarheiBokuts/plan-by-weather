import { Prisma } from '@prisma/client';
import { FakeClock } from '../../test/support/fake-clock';
import { testConfig } from '../../test/support/builders';
import { OpenMeteoClient } from '../open-meteo/open-meteo.client';
import { PrismaService } from '../prisma/prisma.service';
import { LocationsService } from './locations.service';

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
  const prisma = {
    locationAlias: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: transaction,
  };
  const client = { geocode: jest.fn().mockResolvedValue([match]) };
  const service = new LocationsService(
    prisma as unknown as PrismaService,
    client as unknown as OpenMeteoClient,
    new FakeClock(),
    testConfig(),
  );
  return { service, transaction };
}

describe('LocationsService.store, when two requests race on a new city', () => {
  it('retries once after a unique-constraint violation and succeeds', async () => {
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce({ id: 1, name: 'Testville' });
    const { service } = setup(transaction);
    await expect(service.resolve('Testville')).resolves.toMatchObject({ name: 'Testville' });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('gives up if the violation repeats', async () => {
    const transaction = jest.fn().mockRejectedValue(uniqueViolation());
    const { service } = setup(transaction);
    await expect(service.resolve('Testville')).rejects.toMatchObject({ code: 'P2002' });
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry other database errors', async () => {
    const transaction = jest.fn().mockRejectedValue(new Error('connection lost'));
    const { service } = setup(transaction);
    await expect(service.resolve('Testville')).rejects.toThrow('connection lost');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
