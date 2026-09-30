import { PLANTS, WORLD } from "../core/config";
import type { Foliage } from "../core/environments";
import { Rng } from "../core/math";

export enum PlantKind {
  /** Anchored sprite (lotus leaf, lily pad): sways and tilts, stays put. */
  Leaf = 0,
  Flower = 1,
  /** Procedural duckweed disc, slides down the wave slope. */
  Duckweed = 2,
  /** Bread crumb (owned by the food system, same buffer layout). */
  Crumb = 3,
  /** Loose sprite (fallen leaf, pennywort): free-drifting and tumbling. */
  Litter = 4,
}

/**
 * Floats per instance:
 *   placement vec4 (x, y, radius, rotation)
 *   attributes vec4 (phase, kind, drift, tint)
 *   extra vec4 (sprite layer, tumble, 0, 0)
 */
export const PLANT_INSTANCE_FLOATS = 12;
export const MAX_PLANT_INSTANCES = 1024;

/**
 * Placement of the floating layer for one environment. Motion is computed on
 * the GPU from the wave field, so this only decides where things sit, what
 * sprite they use and how loosely they float.
 */
export class PlantLayer {
  readonly data = new Float32Array(MAX_PLANT_INSTANCES * PLANT_INSTANCE_FLOATS);
  count = 0;
  /** Instance ranges per kind so density can trim each independently. */
  readonly ranges: { kind: PlantKind; start: number; count: number }[] = [];

  place(foliage: Foliage, layerOf: (sprite: string) => number, seed = 0x10705): void {
    const rng = new Rng(seed);
    this.count = 0;
    this.ranges.length = 0;
    const W = WORLD.width;
    const H = WORLD.height;
    let start = 0;

    // Anchored leaves hug the banks so the open water stays visible.
    if (foliage.leaf) {
      const layer = layerOf(foliage.leaf.sprite);
      for (let i = 0; i < foliage.leaf.count; i += 1) {
        const p = edgePoint(rng, W, H, 12, 58);
        this.push(p.x, p.y, rng.range(...foliage.leaf.radius), rng.range(0, Math.PI * 2), PlantKind.Leaf, rng.range(0.4, 0.9), rng.unit(), layer, 0);
      }
    }
    this.ranges.push({ kind: PlantKind.Leaf, start, count: this.count - start });
    start = this.count;

    if (foliage.flower) {
      const layer = layerOf(foliage.flower.sprite);
      for (let i = 0; i < foliage.flower.count; i += 1) {
        const p = edgePoint(rng, W, H, 18, 50);
        this.push(p.x, p.y, rng.range(...foliage.flower.radius), rng.range(0, Math.PI * 2), PlantKind.Flower, rng.range(0.2, 0.5), rng.unit(), layer, 0);
      }
    }
    this.ranges.push({ kind: PlantKind.Flower, start, count: this.count - start });
    start = this.count;

    // Litter scatters over the whole pond, thicker toward the banks.
    if (foliage.litter) {
      const layer = layerOf(foliage.litter.sprite);
      for (let i = 0; i < foliage.litter.count; i += 1) {
        const bank = rng.unit() < 0.6;
        const p = bank ? edgePoint(rng, W, H, 6, 90) : { x: rng.range(10, W - 10), y: rng.range(10, H - 10) };
        this.push(p.x, p.y, rng.range(...foliage.litter.radius), rng.range(0, Math.PI * 2), PlantKind.Litter, rng.range(1.2, 3.2), rng.unit(), layer, foliage.litter.tumble * rng.range(0.5, 1.5));
      }
    }
    this.ranges.push({ kind: PlantKind.Litter, start, count: this.count - start });
    start = this.count;

    for (let patch = 0; patch < foliage.duckweed.patches; patch += 1) {
      const c = edgePoint(rng, W, H, 20, 70);
      for (let i = 0; i < foliage.duckweed.perPatch; i += 1) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.unit()) * PLANTS.duckweedSpread;
        this.push(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.6, rng.range(0.8, 1.5), rng.range(0, Math.PI * 2), PlantKind.Duckweed, rng.range(0.6, 1.4), rng.unit(), 0, 0);
      }
    }
    this.ranges.push({ kind: PlantKind.Duckweed, start, count: this.count - start });
  }

  private push(x: number, y: number, radius: number, rotation: number, kind: PlantKind, drift: number, tint: number, layer: number, tumble: number): void {
    const o = this.count * PLANT_INSTANCE_FLOATS;
    if (o + PLANT_INSTANCE_FLOATS > this.data.length) return;
    this.data.set([x, y, radius, rotation, rotation * 3.1 + tint * 7.3, kind, drift, tint, layer, tumble, 0, 0], o);
    this.count += 1;
  }
}

function edgePoint(rng: Rng, w: number, h: number, inner: number, outer: number): { x: number; y: number } {
  const side = Math.floor(rng.unit() * 4);
  const depth = rng.range(inner, outer);
  switch (side) {
    case 0: return { x: rng.range(0, w), y: depth };
    case 1: return { x: w - depth, y: rng.range(0, h) };
    case 2: return { x: rng.range(0, w), y: h - depth };
    default: return { x: depth, y: rng.range(0, h) };
  }
}
