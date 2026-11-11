import { Module } from '@nestjs/common';
import { FETCH_FN, FetchFn, OpenMeteoClient } from './client/open-meteo.client';
import { UpstreamGate } from './upstream-gate/upstream-gate.service';

const globalFetch: FetchFn = (url, init) => fetch(url, init);

@Module({
  providers: [{ provide: FETCH_FN, useValue: globalFetch }, UpstreamGate, OpenMeteoClient],
  exports: [OpenMeteoClient, UpstreamGate],
})
export class OpenMeteoModule {}
