import { WAVE, WORLD } from "../core/config";
import { Rng } from "../core/math";

export const MAX_IMPULSES = 256;
/** Bytes per impulse in the GPU buffer: vec2f position, f32 radius, f32 strength. */
export const IMPULSE_STRIDE = 16;

/**
 * CPU-side queue of surface impulses gathered during a frame (taps, rain,
 * fish wakes). The wave compute pass drains it every render.
 */
export class SurfaceImpulses {
  readonly data = new Float32Array(MAX_IMPULSES * 4);
  count = 0;
  rainPerSecond: number = WAVE.rainPerSecond;
  private rainCountdown = 0;
  private readonly rng = new Rng(0x7a11fa11);

  push(x: number, y: number, radius: number, strength: number): void {
    if (this.count >= MAX_IMPULSES) return;
    const o = this.count * 4;
    this.data[o] = x;
    this.data[o + 1] = y;
    this.data[o + 2] = radius;
    this.data[o + 3] = strength;
    this.count += 1;
  }

  setRain(perSecond: number): void {
    this.rainPerSecond = perSecond;
  }

  tap(x: number, y: number): void {
    this.push(x, y, WAVE.tap.radius, -WAVE.tap.strength);
  }

  updateRain(dt: number): void {
    if (this.rainPerSecond <= 0) return;
    this.rainCountdown -= dt;
    let emitted = 0;
    while (this.rainCountdown <= 0 && emitted < 40) {
      this.push(this.rng.range(4, WORLD.width - 4), this.rng.range(4, WORLD.height - 4), 1.2, -0.55);
      this.rainCountdown += (1 / this.rainPerSecond) * this.rng.range(0.6, 1.4);
      emitted += 1;
    }
  }

  clear(): void {
    this.count = 0;
  }
}
