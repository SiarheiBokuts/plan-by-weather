import { Location } from '@prisma/client';
import { dayOf } from '../../../test/support/builders';
import { ForecastMeta, ForecastService } from '../forecast/forecast.service';
import { LocationsService } from '../locations/locations.service';
import { GeocodeResult } from '../../infrastructure/open-meteo/open-meteo.types';
import { ScoringService } from '../scoring/scoring.service';
import { Activity } from '../scoring/types';
import { DataSource } from '../../domain/data-source';
import { RankingService, toDayWeatherView, toLocationView } from './ranking.service';

const stored: Location = {
  id: 7,
  externalId: 2775220,
  name: 'Innsbruck',
  country: 'Austria',
  countryCode: 'AT',
  region: 'Tyrol',
  latitude: 47.26,
  longitude: 11.39,
  elevation: 574,
  timezone: 'Europe/Vienna',
  marineAvailable: false,
  lastRequestedAt: new Date(),
  createdAt: new Date(),
};

const meta: ForecastMeta = {
  source: DataSource.DATABASE,
  fetchedAt: new Date('2026-11-10T08:00:00Z'),
  nextRefreshAt: new Date('2026-11-10T14:00:00Z'),
  outdated: false,
};

describe('shaping stored data for the API', () => {
  it('toLocationView hides database internals', () => {
    expect(toLocationView(stored)).toEqual({
      name: 'Innsbruck',
      country: 'Austria',
      countryCode: 'AT',
      region: 'Tyrol',
      latitude: 47.26,
      longitude: 11.39,
      elevationM: 574,
      timezone: 'Europe/Vienna',
    });
  });

  it('toLocationView also accepts a geocoder candidate', () => {
    const candidate: GeocodeResult = {
      id: 1,
      name: 'Paris',
      country: 'France',
      countryCode: 'FR',
      region: 'Ile-de-France',
      latitude: 48.85,
      longitude: 2.35,
      elevation: 42,
      timezone: 'Europe/Paris',
      population: 2000000,
      featureCode: 'PPLC',
    };
    expect(toLocationView(candidate)).toMatchObject({ name: 'Paris', region: 'Ile-de-France' });
  });

  it('toDayWeatherView adds a plain-English condition', () => {
    const view = toDayWeatherView(dayOf({ weatherCode: 61, precipitationMm: 3 }));
    expect(view).toMatchObject({ date: '2026-11-10', condition: 'Rain', precipitationMm: 3 });
    expect(view).not.toHaveProperty('weatherCode');
  });
});

describe('RankingService', () => {
  const days = [dayOf({ date: '2026-11-10' }), dayOf({ date: '2026-11-11' })];

  function setup() {
    const locations = {
      resolve: jest.fn().mockResolvedValue(stored),
      search: jest.fn().mockResolvedValue([]),
    };
    const forecasts = { getForecast: jest.fn().mockResolvedValue({ days, meta }) };
    const service = new RankingService(
      locations as unknown as LocationsService,
      forecasts as unknown as ForecastService,
      new ScoringService(),
    );
    return { service, locations, forecasts };
  }

  it('resolves the city, gets its weather, scores it and passes the metadata through', async () => {
    const { service, locations, forecasts } = setup();
    const result = await service.rank('Innsbruck', 'AT');

    expect(locations.resolve).toHaveBeenCalledWith('Innsbruck', 'AT');
    expect(forecasts.getForecast).toHaveBeenCalledWith(stored);
    expect(result.location.name).toBe('Innsbruck');
    expect(result.meta).toBe(meta);
    expect(result.byActivity).toHaveLength(4);
    expect(result.byDay.map((d) => d.date)).toEqual(['2026-11-10', '2026-11-11']);
    expect(result.byDay[0].weather.condition).toBe('Mostly clear');
    expect(result.byDay[0].bestActivity).toBe(Activity.OUTDOOR_SIGHTSEEING);
  });

  it('does not touch the weather when the city cannot be resolved', async () => {
    const { service, locations, forecasts } = setup();
    locations.resolve.mockRejectedValue(new Error('not found'));
    await expect(service.rank('Atlantis')).rejects.toThrow('not found');
    expect(forecasts.getForecast).not.toHaveBeenCalled();
  });

  it('search returns candidates as location views', async () => {
    const { service, locations } = setup();
    locations.search.mockResolvedValue([
      {
        id: 1,
        name: 'Paris',
        country: 'France',
        countryCode: 'FR',
        region: null,
        latitude: 48.85,
        longitude: 2.35,
        elevation: null,
        timezone: 'Europe/Paris',
        population: null,
        featureCode: 'PPLC',
      },
    ]);
    const result = await service.search('Paris');
    expect(result).toEqual([expect.objectContaining({ name: 'Paris', countryCode: 'FR' })]);
  });
});
