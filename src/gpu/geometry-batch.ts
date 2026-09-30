import type { Vec2 } from "../core/math";

export type Rgba = readonly [number, number, number, number];

/**
 * Vertex layout (floats): position 2 · uv 2 · across 2 · color 4 · params 4
 *   params = (layer, visualDepth, roundness, unused)
 *   layer < 0 draws flat vertex colour; layer >= 0 samples the atlas.
 */
export const FLOATS_PER_VERTEX = 14;
export const VERTEX_STRIDE = FLOATS_PER_VERTEX * 4;

export interface Surface {
  layer: number;
  depth: number;
  roundness: number;
}

export const FLAT: Surface = { layer: -1, depth: 0, roundness: 0 };
const ZERO: Vec2 = { x: 0, y: 0 };
const WHITE: Rgba = [1, 1, 1, 1];

/**
 * Triangle soup uploaded to one vertex buffer every frame. No allocation
 * during the frame; capacity is fixed at construction.
 */
export class GeometryBatch {
  readonly buffer: GPUBuffer;
  private readonly data: Float32Array<ArrayBuffer>;
  private cursor = 0;

  constructor(private readonly device: GPUDevice, maxVertices: number, label: string) {
    this.data = new Float32Array(maxVertices * FLOATS_PER_VERTEX);
    this.buffer = device.createBuffer({
      label,
      size: this.data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  get vertexCount(): number {
    return this.cursor / FLOATS_PER_VERTEX;
  }

  reset(): void {
    this.cursor = 0;
  }

  vertex(p: Vec2, uv: Vec2, across: Vec2, c: Rgba, s: Surface): void {
    if (this.cursor + FLOATS_PER_VERTEX > this.data.length) return;
    const d = this.data;
    const o = this.cursor;
    d[o] = p.x; d[o + 1] = p.y;
    d[o + 2] = uv.x; d[o + 3] = uv.y;
    d[o + 4] = across.x; d[o + 5] = across.y;
    d[o + 6] = c[0]; d[o + 7] = c[1]; d[o + 8] = c[2]; d[o + 9] = c[3];
    d[o + 10] = s.layer; d[o + 11] = s.depth; d[o + 12] = s.roundness; d[o + 13] = 0;
    this.cursor += FLOATS_PER_VERTEX;
  }

  /** Flat-coloured triangle (fins, eyes, shadows, debug). */
  triangle(a: Vec2, b: Vec2, c: Vec2, color: Rgba, s: Surface = FLAT): void {
    this.vertex(a, ZERO, ZERO, color, s);
    this.vertex(b, ZERO, ZERO, color, s);
    this.vertex(c, ZERO, ZERO, color, s);
  }

  /** Textured triangle: each corner carries its own uv; `across` is the body's sideways axis. */
  texturedTriangle(a: Vec2, ua: Vec2, b: Vec2, ub: Vec2, c: Vec2, uc: Vec2, across: Vec2, s: Surface): void {
    this.vertex(a, ua, across, WHITE, s);
    this.vertex(b, ub, across, WHITE, s);
    this.vertex(c, uc, across, WHITE, s);
  }

  circle(center: Vec2, radius: number, color: Rgba, segments = 12, s: Surface = FLAT): void {
    for (let i = 0; i < segments; i += 1) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      this.triangle(
        center,
        { x: center.x + Math.cos(a0) * radius, y: center.y + Math.sin(a0) * radius },
        { x: center.x + Math.cos(a1) * radius, y: center.y + Math.sin(a1) * radius },
        color,
        s,
      );
    }
  }

  upload(): void {
    if (this.cursor === 0) return;
    this.device.queue.writeBuffer(this.buffer, 0, this.data, 0, this.cursor);
  }
}
