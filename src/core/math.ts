export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v: Vec2, s: number): Vec2 => ({ x: v.x * s, y: v.y * s });
export const len = (v: Vec2): number => Math.hypot(v.x, v.y);
export const perp = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });
export const fromAngle = (a: number): Vec2 => ({ x: Math.cos(a), y: Math.sin(a) });
export const lerpVec = (a: Vec2, b: Vec2, t: number): Vec2 => add(a, scale(sub(b, a), t));
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const normalize = (v: Vec2, fallback: Vec2 = vec(1, 0)): Vec2 => {
  const m = len(v);
  return m > 1e-5 ? scale(v, 1 / m) : { ...fallback };
};

/** Frame-rate independent exponential approach: moves `current` toward `target`. */
export const approach = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

/** Deterministic xorshift32 so the pond is reproducible from a seed. */
export class Rng {
  constructor(public state = 0x00c0ffee) {}

  next(): number {
    let v = this.state;
    v ^= v << 13;
    v ^= v >>> 17;
    v ^= v << 5;
    this.state = v >>> 0;
    return this.state;
  }

  unit(): number {
    return (this.next() & 0x00ffffff) / 0x01000000;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.unit();
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.unit() * items.length)];
  }
}
