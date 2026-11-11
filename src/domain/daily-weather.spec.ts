import { describeWeatherCode, isThunderstorm } from './daily-weather';

describe('describeWeatherCode', () => {
  it.each([
    [null, 'Unknown'],
    [0, 'Clear sky'],
    [1, 'Mostly clear'],
    [2, 'Partly cloudy'],
    [3, 'Overcast'],
    [45, 'Fog'],
    [48, 'Fog'],
    [53, 'Drizzle'],
    [61, 'Rain'],
    [75, 'Snow'],
    [80, 'Rain showers'],
    [85, 'Snow showers'],
    [95, 'Thunderstorm'],
    [99, 'Thunderstorm'],
    [10, 'Unknown'],
  ])('code %s is "%s"', (code, text) => {
    expect(describeWeatherCode(code)).toBe(text);
  });
});

describe('isThunderstorm', () => {
  it('is true only for thunderstorm codes', () => {
    expect(isThunderstorm(95)).toBe(true);
    expect(isThunderstorm(99)).toBe(true);
    expect(isThunderstorm(80)).toBe(false);
    expect(isThunderstorm(null)).toBe(false);
  });
});
