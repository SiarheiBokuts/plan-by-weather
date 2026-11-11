import { Clock } from '../../src/common/clock';

/** A clock the test controls. Defaults to the date of the recorded fixtures. */
export class FakeClock extends Clock {
  constructor(private current = new Date('2026-11-11T10:00:00Z')) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: Date | string): void {
    this.current = new Date(instant);
  }

  advanceHours(hours: number): void {
    this.current = new Date(this.current.getTime() + hours * 3_600_000);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}
