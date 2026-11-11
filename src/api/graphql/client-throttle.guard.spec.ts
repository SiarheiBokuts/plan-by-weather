import { ExecutionContext } from '@nestjs/common';
import { testConfig } from '../../../test/support/builders';
import { FakeClock } from '../../../test/support/fake-clock';
import { ClientRateLimitedError } from '../../common/errors';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ClientThrottleGuard, clientId } from './client-throttle.guard';

type Req = Parameters<typeof clientId>[0];

/** The smallest ExecutionContext that GqlExecutionContext can read a request from. */
function graphqlContext(req: Req): ExecutionContext {
  const args = [{}, {}, { req }, {}];
  return {
    getArgs: () => args,
    getArgByIndex: (index: number) => args[index],
    getClass: () => Object,
    getHandler: () => () => undefined,
    getType: () => 'graphql',
  } as unknown as ExecutionContext;
}

describe('clientId', () => {
  it('identifies a client by API key when one is sent', () => {
    expect(clientId({ headers: { 'x-api-key': 'abc' }, ip: '1.1.1.1' })).toBe(
      clientId({ headers: { 'x-api-key': 'abc' }, ip: '2.2.2.2' }),
    );
  });

  it('uses the first value when the header is repeated', () => {
    expect(clientId({ headers: { 'x-api-key': ['abc', 'def'] } })).toBe(
      clientId({ headers: { 'x-api-key': 'abc' } }),
    );
  });

  it('otherwise identifies a client by address', () => {
    expect(clientId({ headers: {}, ip: '1.1.1.1' })).not.toBe(
      clientId({ headers: {}, ip: '2.2.2.2' }),
    );
    expect(clientId({ headers: {}, socket: { remoteAddress: '3.3.3.3' } })).toBe(
      clientId({ headers: {}, ip: '3.3.3.3' }),
    );
  });

  it('copes with a request that has no address at all', () => {
    expect(clientId({ headers: {} })).toBe(clientId({ headers: {} }));
  });

  it('never exposes the raw key or address in the identifier', () => {
    const id = clientId({ headers: { 'x-api-key': 'super-secret' } });
    expect(id).not.toContain('super-secret');
    expect(id).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('ClientThrottleGuard', () => {
  let guard: ClientThrottleGuard;
  let clock: FakeClock;

  beforeEach(() => {
    clock = new FakeClock();
    guard = new ClientThrottleGuard(
      new RedisService(clock),
      testConfig({ clientRateLimit: 3, clientRateWindowSeconds: 60 }),
    );
  });

  const call = (req: Req): Promise<boolean> => guard.canActivate(graphqlContext(req));

  it('lets a client through up to the limit', async () => {
    const req = { headers: {}, ip: '1.1.1.1' };
    await expect(call(req)).resolves.toBe(true);
    await expect(call(req)).resolves.toBe(true);
    await expect(call(req)).resolves.toBe(true);
  });

  it('rejects the request over the limit and says when to retry', async () => {
    const req = { headers: {}, ip: '1.1.1.1' };
    for (let i = 0; i < 3; i++) await call(req);
    clock.advanceSeconds(20);
    const error = await call(req).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClientRateLimitedError);
    expect(error).toMatchObject({
      retryAfterSeconds: 40,
      extensions: { code: 'CLIENT_RATE_LIMITED' },
    });
  });

  it('counts clients separately', async () => {
    const busy = { headers: {}, ip: '1.1.1.1' };
    for (let i = 0; i < 4; i++) await call(busy).catch(() => undefined);
    await expect(call({ headers: {}, ip: '2.2.2.2' })).resolves.toBe(true);
    await expect(call({ headers: { 'x-api-key': 'k' }, ip: '1.1.1.1' })).resolves.toBe(true);
  });

  it('lets the client back in when the window ends', async () => {
    const req = { headers: {}, ip: '1.1.1.1' };
    for (let i = 0; i < 4; i++) await call(req).catch(() => undefined);
    clock.advanceSeconds(61);
    await expect(call(req)).resolves.toBe(true);
  });
});
