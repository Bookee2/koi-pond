import { PLANTS, WORLD } from "../core/config";
import { Rng } from "../core/math";

export enum PlantKind {
  Leaf = 0,
  Flower = 1,
  Duckweed = 2,
}

/** Floats per instance: placement vec4 (x, y, radius, rotation) + attributes vec4 (phase, kind, drift, tint). */
export const PLANT_INSTANCE_FLOATS = 8;

/**
 * Static placement of the floating layer. Motion is computed on the GPU from
 * the wave field, so this only decides where things sit and what they are.
 */
export class PlantLayer {
  readonly data: Float32Array<ArrayBuffer>;
  count = 0;
  /** Instance ranges per kind so density can trim each independently. */
  readonly ranges: { kind: PlantKind; start: number; count: number }[] = [];

  constructor() {
    const capacity = PLANTS.leafCount + PLANTS.flowerCount + PLANTS.duckweedPatches * PLANTS.duckweedPerPatch;
    this.data = new Float32Array(capacity * PLANT_INSTANCE_FLOATS);
    this.place();
  }

  place(seed = 0x10705): void {
    const rng = new Rng(seed);
    this.count = 0;
    this.ranges.length = 0;
    const W = WORLD.width;
    const H = WORLD.height;

    // Lotus leaves hug the banks so the open water stays visible.
    let start = 0;
    for (let i = 0; i < PLANTS.leafCount; i += 1) {
      const p = edgePoint(rng, W, H, 12, 58);
      this.push(p.x, p.y, rng.range(PLANTS.leafRadius[0], PLANTS.leafRadius[1]), rng.range(0, Math.PI * 2), PlantKind.Leaf, rng.range(0.4, 0.9), rng.unit());
    }
    this.ranges.push({ kind: PlantKind.Leaf, start, count: this.count - start });
    start = this.count;
    for (let i = 0; i < PLANTS.flowerCount; i += 1) {
      const p = edgePoint(rng, W, H, 18, 50);
      this.push(p.x, p.y, rng.range(PLANTS.flowerRadius[0], PLANTS.flowerRadius[1]), rng.range(0, Math.PI * 2), PlantKind.Flower, rng.range(0.2, 0.5), rng.unit());
    }
    this.ranges.push({ kind: PlantKind.Flower, start, count: this.count - start });
    start = this.count;
    for (let patch = 0; patch < PLANTS.duckweedPatches; patch += 1) {
      const c = edgePoint(rng, W, H, 20, 70);
      for (let i = 0; i < PLANTS.duckweedPerPatch; i += 1) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.unit()) * PLANTS.duckweedSpread;
        this.push(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.6, rng.range(0.8, 1.5), rng.range(0, Math.PI * 2), PlantKind.Duckweed, rng.range(0.6, 1.4), rng.unit());
      }
    }
    this.ranges.push({ kind: PlantKind.Duckweed, start, count: this.count - start });
  }

  private push(x: number, y: number, radius: number, rotation: number, kind: PlantKind, drift: number, tint: number): void {
    const o = this.count * PLANT_INSTANCE_FLOATS;
    if (o + PLANT_INSTANCE_FLOATS > this.data.length) return;
    this.data.set([x, y, radius, rotation, rotation * 3.1 + tint * 7.3, kind, drift, tint], o);
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
