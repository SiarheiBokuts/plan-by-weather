import { Location } from '@prisma/client';
import { FakeClock } from '../../../test/support/fake-clock';
import { LocationNotFoundError } from '../../common/errors';
import { OpenMeteoClient } from '../../infrastructure/open-meteo/client/open-meteo.client';
import { GeocodeResult } from '../../infrastructure/open-meteo/open-meteo.types';
import { LocationsRepository } from '../../infrastructure/database/locations.repository';
import { LocationsService } from './locations.service';

const stored = (lastRequestedAt: Date): Location => ({
  id: 7,
  externalId: 1,
  name: 'Innsbruck',
  country: 'Austria',
  countryCode: 'AT',
  region: null,
  latitude: 47.26,
  longitude: 11.39,
  elevation: 574,
  timezone: 'Europe/Vienna',
  marineAvailable: null,
  lastRequestedAt,
  createdAt: new Date(),
});

const candidate = (name: string, featureCode: string | null): GeocodeResult => ({
  id: 1,
  name,
  country: 'Austria',
  countryCode: 'AT',
  region: null,
  latitude: 47.26,
  longitude: 11.39,
  elevation: 574,
  timezone: 'Europe/Vienna',
  population: null,
  featureCode,
});

/** The service alone: the repository (storage) and the client (outside data) are replaced. */
function setup() {
  const clock = new FakeClock();
  const repository = {
    findByAlias: jest.fn().mockResolvedValue(null),
    touch: jest.fn().mockImplementation(async (id: number, at: Date) => ({ ...stored(at), id })),
    saveResolved: jest.fn().mockResolvedValue(stored(clock.now())),
  };
  const client = { geocode: jest.fn().mockResolvedValue([candidate('Innsbruck', 'PPLA')]) };
  const service = new LocationsService(
    repository as unknown as LocationsRepository,
    client as unknown as OpenMeteoClient,
    clock,
  );
  return { service, repository, client, clock };
}

describe('LocationsService (business logic only)', () => {
  describe('resolve', () => {
    it('geocodes an unknown name and saves the best settlement under the cleaned-up name', async () => {
      const { service, repository, client, clock } = setup();
      await service.resolve('  Innsbruck ', 'at');

      expect(client.geocode).toHaveBeenCalledWith('Innsbruck', 'AT');
      expect(repository.saveResolved).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Innsbruck' }),
        { name: 'innsbruck', countryCode: 'AT' },
        clock.now(),
      );
    });

    it('skips the geocoder for a name it already knows', async () => {
      const { service, repository, client, clock } = setup();
      repository.findByAlias.mockResolvedValue(stored(clock.now()));
      const location = await service.resolve('Innsbruck');
      expect(location.name).toBe('Innsbruck');
      expect(client.geocode).not.toHaveBeenCalled();
      expect(repository.saveResolved).not.toHaveBeenCalled();
    });

    it('prefers a settlement to an airport that the geocoder lists first', async () => {
      const { service, repository, client } = setup();
      client.geocode.mockResolvedValue([candidate('Airport', 'AIRH'), candidate('Town', 'PPL')]);
      await service.resolve('Town');
      expect(repository.saveResolved).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Town' }),
        { name: 'town', countryCode: '' },
        expect.any(Date),
      );
    });

    it('reports an unknown city and saves nothing', async () => {
      const { service, repository, client } = setup();
      client.geocode.mockResolvedValue([candidate('Airport', 'AIRH')]);
      await expect(service.resolve('Nowhere')).rejects.toBeInstanceOf(LocationNotFoundError);
      expect(repository.saveResolved).not.toHaveBeenCalled();
    });

    it('rejects bad input before doing anything else', async () => {
      const { service, repository, client } = setup();
      await expect(service.resolve('P')).rejects.toThrow(/at least 2 characters/);
      expect(repository.findByAlias).not.toHaveBeenCalled();
      expect(client.geocode).not.toHaveBeenCalled();
    });
  });

  describe('marking a known place as requested', () => {
    it('does not write when it was requested less than an hour ago', async () => {
      const { service, repository, clock } = setup();
      repository.findByAlias.mockResolvedValue(
        stored(new Date(clock.now().getTime() - 59 * 60_000)),
      );
      await service.resolve('Innsbruck');
      expect(repository.touch).not.toHaveBeenCalled();
    });

    it('writes when the last request was an hour ago or more', async () => {
      const { service, repository, clock } = setup();
      repository.findByAlias.mockResolvedValue(
        stored(new Date(clock.now().getTime() - 61 * 60_000)),
      );
      await service.resolve('Innsbruck');
      expect(repository.touch).toHaveBeenCalledWith(7, clock.now());
    });
  });

  describe('search', () => {
    it('returns up to five settlements and stores nothing', async () => {
      const { service, repository, client } = setup();
      client.geocode.mockResolvedValue([
        candidate('Airport', 'AIRH'),
        ...Array.from({ length: 8 }, (_, i) => candidate(`Town${i}`, 'PPL')),
      ]);
      const results = await service.search('Town');
      expect(results.map((r) => r.name)).toEqual(['Town0', 'Town1', 'Town2', 'Town3', 'Town4']);
      expect(client.geocode).toHaveBeenCalledWith('Town', undefined, 10);
      expect(repository.saveResolved).not.toHaveBeenCalled();
    });
  });
});
