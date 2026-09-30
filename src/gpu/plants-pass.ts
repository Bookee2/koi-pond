import { PLANTS, WORLD } from "../core/config";
import { PLANT_INSTANCE_FLOATS, PlantLayer } from "../sim/plants";
import plantShader from "../shaders/plants.wgsl?raw";
import { UniformBlock } from "./device";
import type { EnvironmentTextures } from "./textures";
import type { WaveField } from "./wave-field";

/**
 * Instanced floating plants. Two pipelines share one bind group layout:
 * `shadow` draws dark offset silhouettes into the underwater target (so the
 * water refracts them like real shadows on the bed) and `surface` draws the
 * lit sprites into the composite target after the water pass.
 */
export class PlantsPass {
  readonly layer = new PlantLayer();
  private readonly instances: GPUBuffer;
  /** One uniform block per mode (0 surface, 1 shadow) so both passes can live in one command buffer. */
  private readonly params: UniformBlock[];
  private readonly bindGroups: GPUBindGroup[][];
  private readonly shadowPipeline: GPURenderPipeline;
  private readonly surfacePipeline: GPURenderPipeline;

  constructor(device: GPUDevice, wave: WaveField, env: EnvironmentTextures) {
    this.instances = device.createBuffer({
      label: "plant instances",
      size: this.layer.data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.instances, 0, this.layer.data);
    this.params = [new UniformBlock(device, 64, "plant params surface"), new UniformBlock(device, 64, "plant params shadow")];

    const layout = device.createBindGroupLayout({
      label: "plants",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });
    const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.bindGroups = this.params.map((block) => [0, 1, 2].map((i) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: block.buffer } },
          { binding: 1, resource: { buffer: wave.bufferAt(i) } },
          { binding: 2, resource: env.lotusLeaf.createView() },
          { binding: 3, resource: env.lotusFlower.createView() },
          { binding: 4, resource: sampler },
        ],
      }),
    ));

    const module = device.createShaderModule({ label: "plants", code: plantShader });
    const makePipeline = (label: string): GPURenderPipeline =>
      device.createRenderPipeline({
        label,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: {
          module,
          entryPoint: "vs_plant",
          buffers: [{
            arrayStride: PLANT_INSTANCE_FLOATS * 4,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 1, offset: 0, format: "float32x4" },
              { shaderLocation: 2, offset: 16, format: "float32x4" },
            ],
          }],
        },
        fragment: {
          module,
          entryPoint: "fs_plant",
          targets: [{
            format: "rgba8unorm",
            blend: {
              color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
            },
          }],
        },
        primitive: { topology: "triangle-list" },
      });
    this.shadowPipeline = makePipeline("plant shadows");
    this.surfacePipeline = makePipeline("plant surface");
  }

  /** Upload per-frame uniforms. Called once before either draw. */
  update(time: number, lightDirection: readonly [number, number, number]): void {
    this.params.forEach((block, mode) => {
      const f = block.floats;
      f[0] = WORLD.width; f[1] = WORLD.height;
      f[2] = WORLD.width; f[3] = WORLD.height;
      f[4] = time; f[5] = mode;
      f[6] = PLANTS.tiltStrength; f[7] = PLANTS.pushStrength;
      f.set(lightDirection, 8); f[11] = PLANTS.shadowOpacity;
      f[12] = PLANTS.shadowOffset.x; f[13] = PLANTS.shadowOffset.y;
      block.upload();
    });
  }

  private draw(pass: GPURenderPassEncoder, pipeline: GPURenderPipeline, mode: number, waveIndex: number): void {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroups[mode][waveIndex]);
    pass.setVertexBuffer(0, this.instances);
    pass.draw(6, this.layer.count);
  }

  drawShadows(pass: GPURenderPassEncoder, waveIndex: number): void {
    this.draw(pass, this.shadowPipeline, 1, waveIndex);
  }

  drawSurface(pass: GPURenderPassEncoder, waveIndex: number): void {
    this.draw(pass, this.surfacePipeline, 0, waveIndex);
  }
}
