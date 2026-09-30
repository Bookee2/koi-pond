import { WAVE, WORLD } from "../core/config";
import { IMPULSE_STRIDE, MAX_IMPULSES, type SurfaceImpulses } from "../sim/surface";
import waveShader from "../shaders/wave.wgsl?raw";
import { UniformBlock } from "./device";

/**
 * GPU height-field wave simulation. Three storage buffers rotate each step so
 * the shader always reads prev/curr and writes next. `current` is what the
 * water pass samples.
 */
export class WaveField {
  width = WORLD.width;
  height = WORLD.height;
  private buffers: GPUBuffer[];
  private bindGroups: GPUBindGroup[];
  private readonly pipeline: GPUComputePipeline;
  private readonly params: UniformBlock;
  private readonly impulseBuffer: GPUBuffer;
  private rotation = 0;

  constructor(private readonly device: GPUDevice) {
    this.buffers = this.makeBuffers();
    this.params = new UniformBlock(device, 32, "wave params");
    this.impulseBuffer = device.createBuffer({
      label: "wave impulses",
      size: MAX_IMPULSES * IMPULSE_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const module = device.createShaderModule({ label: "wave", code: waveShader });
    this.pipeline = device.createComputePipeline({
      label: "wave step",
      layout: "auto",
      compute: { module, entryPoint: "cs_wave" },
    });

    this.bindGroups = this.makeBindGroups();
  }

  private makeBuffers(): GPUBuffer[] {
    const cells = this.width * this.height;
    return [0, 1, 2].map((i) =>
      this.device.createBuffer({
        label: `wave height ${i}`,
        size: cells * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    );
  }

  /** Rotation r reads prev=r, curr=r+1, writes next=r+2 (mod 3). */
  private makeBindGroups(): GPUBindGroup[] {
    const layout = this.pipeline.getBindGroupLayout(0);
    return [0, 1, 2].map((r) =>
      this.device.createBindGroup({
        label: `wave bind ${r}`,
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.params.buffer } },
          { binding: 1, resource: { buffer: this.buffers[r % 3] } },
          { binding: 2, resource: { buffer: this.buffers[(r + 1) % 3] } },
          { binding: 3, resource: { buffer: this.buffers[(r + 2) % 3] } },
          { binding: 4, resource: { buffer: this.impulseBuffer } },
        ],
      }),
    );
  }

  /** Change the grid to a new world size. Callers must rebuild anything bound to the old buffers. */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    for (const b of this.buffers) b.destroy();
    this.width = width;
    this.height = height;
    this.buffers = this.makeBuffers();
    this.bindGroups = this.makeBindGroups();
    this.rotation = 0;
  }

  /** The buffer holding the latest heights, for the water pass to read. */
  get current(): GPUBuffer {
    return this.buffers[(this.rotation + 1) % 3];
  }

  bufferAt(index: number): GPUBuffer {
    return this.buffers[index % 3];
  }

  /** Index of the buffer that the next `step` will write, i.e. `current` after it runs. */
  currentIndexAfterStep(): number {
    return (this.rotation + 2) % 3;
  }

  reset(): void {
    const zeros = new Float32Array(this.width * this.height);
    for (const b of this.buffers) this.device.queue.writeBuffer(b, 0, zeros);
  }

  /** Encode one simulation step, draining the impulse queue. */
  step(encoder: GPUCommandEncoder, impulses: SurfaceImpulses): void {
    const u = this.params.uints;
    const f = this.params.floats;
    u[0] = this.width;
    u[1] = this.height;
    f[2] = WAVE.speed;
    f[3] = WAVE.damping;
    u[4] = impulses.count;
    this.params.upload();
    if (impulses.count > 0) {
      this.device.queue.writeBuffer(this.impulseBuffer, 0, impulses.data, 0, impulses.count * 4);
    }

    const pass = encoder.beginComputePass({ label: "wave step" });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroups[this.rotation]);
    pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
    pass.end();

    this.rotation = (this.rotation + 1) % 3;
    impulses.clear();
  }
}
