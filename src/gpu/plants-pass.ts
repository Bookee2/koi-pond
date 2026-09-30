import { PLANTS, WORLD } from "../core/config";
import { shadowOffsetFor, type LightState } from "../core/lighting";
import { CRUMB_INSTANCE_FLOATS, type Food } from "../sim/food";
import { MAX_PLANT_INSTANCES, PLANT_INSTANCE_FLOATS, PlantLayer } from "../sim/plants";
import type { Foliage } from "../core/environments";
import { FOOD } from "../core/config";
import plantShader from "../shaders/plants.wgsl?raw";
import { UniformBlock } from "./device";
import type { EnvironmentTextures, SpriteAtlas } from "./textures";
import type { WaveField } from "./wave-field";

/**
 * Instanced floating plants. Two pipelines share one bind group layout:
 * `shadow` draws dark offset silhouettes into the underwater target (so the
 * water refracts them like real shadows on the bed) and `surface` draws the
 * lit sprites into the composite target after the water pass.
 */
export class PlantsPass {
  readonly layer = new PlantLayer();
  private readonly sprites: SpriteAtlas;
  private readonly instances: GPUBuffer;
  private readonly crumbInstances: GPUBuffer;
  private crumbCount = 0;
  /** One uniform block per mode (0 surface, 1 shadow) so both passes can live in one command buffer. */
  private readonly params: UniformBlock[];
  private readonly bindGroups: GPUBindGroup[][];
  private readonly shadowPipeline: GPURenderPipeline;
  private readonly surfacePipeline: GPURenderPipeline;

  private readonly device: GPUDevice;

  constructor(device: GPUDevice, wave: WaveField, env: EnvironmentTextures) {
    this.sprites = env.sprites;
    this.instances = device.createBuffer({
      label: "plant instances",
      size: MAX_PLANT_INSTANCES * PLANT_INSTANCE_FLOATS * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.crumbInstances = device.createBuffer({
      label: "crumb instances",
      size: FOOD.maxCrumbs * CRUMB_INSTANCE_FLOATS * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device = device;
    this.params = [new UniformBlock(device, 128, "plant params surface"), new UniformBlock(device, 128, "plant params shadow")];

    const layout = device.createBindGroupLayout({
      label: "plants",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "2d-array" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "2d-array" } },
      ],
    });
    const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.bindGroups = this.params.map((block) => [0, 1, 2].map((i) =>
      device.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: block.buffer } },
          { binding: 1, resource: { buffer: wave.bufferAt(i) } },
          { binding: 2, resource: env.sprites.texture.createView({ dimension: "2d-array" }) },
          { binding: 3, resource: sampler },
          { binding: 4, resource: env.sprites.normals.createView({ dimension: "2d-array" }) },
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
              { shaderLocation: 3, offset: 32, format: "float32x4" },
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
  /** Re-place the floating layer for an environment's foliage and upload it. */
  setFoliage(foliage: Foliage): void {
    this.layer.place(foliage, (name) => this.sprites.layerOf(name));
    if (this.layer.count > 0) {
      this.device.queue.writeBuffer(this.instances, 0, this.layer.data, 0, this.layer.count * PLANT_INSTANCE_FLOATS);
    }
  }

  /** Environment look: multiplier on leaf colour and fraction of placed plants shown. */
  leafTint: [number, number, number] = [1, 1, 1];
  density = 1;

  update(time: number, light: LightState, food: Food): void {
    const lightDirection = light.sunDir;
    const shadow = shadowOffsetFor(light.sunDir, PLANTS.floatHeight);
    food.packInstances();
    this.crumbCount = food.instanceCount;
    if (this.crumbCount > 0) {
      this.device.queue.writeBuffer(this.crumbInstances, 0, food.instanceData, 0, this.crumbCount * CRUMB_INSTANCE_FLOATS);
    }
    this.params.forEach((block, mode) => {
      const f = block.floats;
      f[0] = WORLD.width; f[1] = WORLD.height;
      f[2] = WORLD.width; f[3] = WORLD.height;
      f[4] = time; f[5] = mode;
      f[6] = PLANTS.tiltStrength; f[7] = PLANTS.pushStrength;
      f.set(lightDirection, 8); f[11] = PLANTS.shadowOpacity;
      f[12] = shadow.x; f[13] = shadow.y;
      f.set(this.leafTint, 16);
      f.set(light.sun, 20);
      f.set(light.zenith, 24);
      f.set(light.horizon, 28);
      block.upload();
    });
  }

  private draw(pass: GPURenderPassEncoder, pipeline: GPURenderPipeline, mode: number, waveIndex: number): void {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroups[mode][waveIndex]);
    pass.setVertexBuffer(0, this.instances);
    for (const range of this.layer.ranges) {
      const shown = Math.round(range.count * this.density);
      if (shown > 0) pass.draw(6, shown, 0, range.start);
    }
    if (this.crumbCount > 0) {
      pass.setVertexBuffer(0, this.crumbInstances);
      pass.draw(6, this.crumbCount);
    }
  }

  drawShadows(pass: GPURenderPassEncoder, waveIndex: number): void {
    this.draw(pass, this.shadowPipeline, 1, waveIndex);
  }

  drawSurface(pass: GPURenderPassEncoder, waveIndex: number): void {
    this.draw(pass, this.surfacePipeline, 0, waveIndex);
  }
}
