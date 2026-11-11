describe('the test environment', () => {
  it('cannot reach the real internet, so no test can call the real Open-Meteo', async () => {
    await expect(fetch('https://api.open-meteo.com/v1/forecast')).rejects.toThrow(/real network/);
  });
});
