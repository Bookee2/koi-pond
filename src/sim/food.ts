import { FOOD, WORLD } from "../core/config";
import { len, Rng, sub, type Vec2 } from "../core/math";

export interface Crumb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  age: number;
  /** Seconds until it lands; crumbs in the air can't be eaten yet. */
  airborne: number;
  alive: boolean;
}

/** Floats per crumb instance in the GPU buffer: placement vec4 + attributes vec4 (matches the plant layout). */
export const CRUMB_INSTANCE_FLOATS = 8;

/**
 * Bread crumbs on the surface. Tossed in a spread around the tap, they drift
 * a little, get eaten by fish whose mouth reaches them, and sink after a while.
 */
export class Food {
  readonly crumbs: Crumb[] = Array.from({ length: FOOD.maxCrumbs }, () => ({
    x: 0, y: 0, vx: 0, vy: 0, size: 1, age: 0, airborne: 0, alive: false,
  }));
  readonly instanceData = new Float32Array(FOOD.maxCrumbs * CRUMB_INSTANCE_FLOATS);
  instanceCount = 0;
  onLand: ((x: number, y: number, size: number) => void) | null = null;
  onEaten: ((x: number, y: number) => void) | null = null;

  private readonly rng = new Rng(0xb0bacafe);

  get aliveCount(): number {
    let n = 0;
    for (const c of this.crumbs) if (c.alive) n += 1;
    return n;
  }

  /** Throw a handful of crumbs toward `point`. */
  toss(point: Vec2): void {
    const count = Math.round(this.rng.range(FOOD.perToss[0], FOOD.perToss[1]));
    for (let i = 0; i < count; i += 1) {
      const c = this.crumbs.find((k) => !k.alive) ?? this.oldest();
      const angle = this.rng.range(0, Math.PI * 2);
      const radius = Math.sqrt(this.rng.unit()) * FOOD.spread;
      c.x = Math.min(WORLD.width - 4, Math.max(4, point.x + Math.cos(angle) * radius));
      c.y = Math.min(WORLD.height - 4, Math.max(4, point.y + Math.sin(angle) * radius * 0.7));
      c.vx = this.rng.range(-1, 1);
      c.vy = this.rng.range(-1, 1);
      c.size = this.rng.range(0.7, 1.3);
      c.age = 0;
      c.airborne = this.rng.range(0.12, 0.42);
      c.alive = true;
    }
  }

  reset(): void {
    for (const c of this.crumbs) c.alive = false;
  }

  update(dt: number): void {
    for (const c of this.crumbs) {
      if (!c.alive) continue;
      if (c.airborne > 0) {
        c.airborne -= dt;
        if (c.airborne <= 0) this.onLand?.(c.x, c.y, c.size);
        continue;
      }
      c.age += dt;
      // Slow drift with a little random walk so a raft of crumbs spreads out.
      c.vx += this.rng.range(-1, 1) * 2.4 * dt;
      c.vy += this.rng.range(-1, 1) * 2.4 * dt;
      c.vx *= 1 - 0.8 * dt;
      c.vy *= 1 - 0.8 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.age > FOOD.lifetime) c.alive = false;
    }
  }

  /** Nearest floating crumb within `radius` of `from`, or null. */
  nearest(from: Vec2, radius: number): Crumb | null {
    let best: Crumb | null = null;
    let bestDistance = radius;
    for (const c of this.crumbs) {
      if (!c.alive || c.airborne > 0) continue;
      const d = len(sub(from, c));
      if (d < bestDistance) {
        bestDistance = d;
        best = c;
      }
    }
    return best;
  }

  /** Called by the school when a mouth touches a crumb. */
  eat(c: Crumb): number {
    if (!c.alive) return 0;
    c.alive = false;
    this.onEaten?.(c.x, c.y);
    return c.size;
  }

  /** Pack live crumbs into the instanced draw buffer (kind 3 in the plant shader). */
  packInstances(): void {
    let n = 0;
    for (const c of this.crumbs) {
      if (!c.alive) continue;
      const o = n * CRUMB_INSTANCE_FLOATS;
      // Airborne crumbs are drawn slightly larger and lifted: a cheap arc.
      const lift = c.airborne > 0 ? Math.sin(Math.min(1, c.airborne / 0.4) * Math.PI) * 6 : 0;
      const sink = c.age > FOOD.lifetime - 3 ? (c.age - (FOOD.lifetime - 3)) / 3 : 0;
      this.instanceData.set([
        c.x, c.y - lift, c.size * FOOD.radius * (1 + (c.airborne > 0 ? 0.3 : 0)) * (1 - sink * 0.6), c.age,
        c.x * 0.37 + c.y * 0.11, 3, 0, 1 - sink,
      ], o);
      n += 1;
    }
    this.instanceCount = n;
  }

  private oldest(): Crumb {
    let best = this.crumbs[0];
    for (const c of this.crumbs) if (c.age > best.age) best = c;
    return best;
  }
}
