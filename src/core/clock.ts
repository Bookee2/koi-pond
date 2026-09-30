/**
 * Fixed-step accumulator. The simulation always advances in equal steps so
 * behaviour is identical at any display refresh rate; rendering interpolates
 * nothing and simply draws the latest state.
 */
export class FixedClock {
  readonly step: number;
  private accumulator = 0;
  private previous: number | null = null;
  /** Total simulated seconds. */
  time = 0;

  constructor(updatesPerSecond: number, private readonly maxFrameSeconds = 0.1) {
    this.step = 1 / updatesPerSecond;
  }

  /** Feed a wall-clock timestamp (ms) and get the number of sim steps to run. */
  advance(nowMs: number): number {
    if (this.previous === null) {
      this.previous = nowMs;
      return 0;
    }
    this.accumulator += Math.min((nowMs - this.previous) / 1000, this.maxFrameSeconds);
    this.previous = nowMs;
    let steps = 0;
    while (this.accumulator >= this.step) {
      this.accumulator -= this.step;
      this.time += this.step;
      steps += 1;
    }
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
    this.previous = null;
    this.time = 0;
  }
}
