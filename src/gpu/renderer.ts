import { BED, KOI, WATER, WAVE, WEATHER, WORLD, type WeatherPreset } from "../core/config";
import { ENVIRONMENTS, type EnvironmentPreset } from "../core/environments";
import type { School } from "../sim/school";
import type { SurfaceImpulses } from "../sim/surface";
import bedShader from "../shaders/bed.wgsl?raw";
import fishShader from "../shaders/fish.wgsl?raw";
import fullscreenShader from "../shaders/fullscreen.wgsl?raw";
import postShader from "../shaders/post.wgsl?raw";
import waterShader from "../shaders/water.wgsl?raw";
import { createRenderTexture, UniformBlock, type GpuContext } from "./device";
import { FishMeshBuilder } from "./fish-mesh";
import { GeometryBatch, VERTEX_STRIDE } from "./geometry-batch";
import type { KoiAtlas } from "./koi-atlas";
import { PlantsPass } from "./plants-pass";
import { loadBed, type BedTextures, type EnvironmentTextures } from "./textures";
import { WaveField } from "./wave-field";

const MAX_FISH_VERTICES = 60_000;

/**
 * Frame pipeline:
 *   wave compute → [bed, shadows, fish] → underwater texture
 *   water (refract + caustics + glint) → composite texture
 *   post (weather grade) → canvas
 */
export class Renderer {
  readonly wave: WaveField;
  private readonly device: GPUDevice;
  private readonly underwater: GPUTexture;
  private readonly composite: GPUTexture;
  private readonly sampler: GPUSampler;

  private readonly bedPipeline: GPURenderPipeline;
  private readonly bedParams: UniformBlock;
  private bedBind: GPUBindGroup;
  private bedTextures: BedTextures;
  private environmentTarget: EnvironmentPreset = ENVIRONMENTS[0];
  private readonly environment: EnvironmentState;
  private environmentLoad = 0;

  private readonly fishPipeline: GPURenderPipeline;
  private readonly fishParams: UniformBlock;
  private readonly fishBind: GPUBindGroup;
  private readonly bodies: GeometryBatch;
  private readonly shadows: GeometryBatch;
  private readonly fishMesh: FishMeshBuilder;

  private readonly waterPipeline: GPURenderPipeline;
  private readonly waterParams: UniformBlock;
  private readonly waterBinds: GPUBindGroup[];

  private readonly postPipeline: GPURenderPipeline;
  private readonly postParams: UniformBlock;
  private readonly postBind: GPUBindGroup;

  private weatherTarget: WeatherPreset = WEATHER[0];
  private readonly weather: WeatherState;

  readonly plants: PlantsPass;

  constructor(private readonly gpu: GpuContext, atlas: KoiAtlas, env: EnvironmentTextures) {
    const { device, format } = gpu;
    this.device = device;
    const w = WORLD.width * WORLD.renderScale;
    const h = WORLD.height * WORLD.renderScale;
    this.underwater = createRenderTexture(device, w, h, "underwater");
    this.composite = createRenderTexture(device, w, h, "composite");
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.wave = new WaveField(device);
    this.weather = weatherState(WEATHER[0]);

    const fullscreen = device.createShaderModule({ label: "fullscreen", code: fullscreenShader });
    const offscreen: GPUColorTargetState = { format: "rgba8unorm" };

    // Bed
    this.bedParams = new UniformBlock(device, 112, "bed params");
    this.bedPipeline = device.createRenderPipeline({
      label: "bed",
      layout: "auto",
      vertex: { module: fullscreen, entryPoint: "vs_fullscreen" },
      fragment: { module: device.createShaderModule({ label: "bed", code: bedShader }), entryPoint: "fs_bed", targets: [offscreen] },
      primitive: { topology: "triangle-list" },
    });
    this.bedTextures = { bedAlbedo: env.bedAlbedo, bedNormal: env.bedNormal };
    this.bedBind = this.makeBedBind(this.bedTextures);
    this.environment = environmentState(ENVIRONMENTS[0]);
    this.plants = new PlantsPass(device, this.wave, env);
    this.plants.setFoliage(ENVIRONMENTS[0].foliage);

    // Fish (premultiplied alpha over the bed), textured from the Blender atlas
    this.fishParams = new UniformBlock(device, 96, "fish params");
    const fishModule = device.createShaderModule({ label: "fish", code: fishShader });
    this.fishPipeline = device.createRenderPipeline({
      label: "fish",
      layout: "auto",
      vertex: {
        module: fishModule,
        entryPoint: "vs_fish",
        buffers: [{
          arrayStride: VERTEX_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 1, offset: 8, format: "float32x2" },
            { shaderLocation: 2, offset: 16, format: "float32x2" },
            { shaderLocation: 3, offset: 24, format: "float32x4" },
            { shaderLocation: 4, offset: 40, format: "float32x4" },
          ],
        }],
      },
      fragment: {
        module: fishModule,
        entryPoint: "fs_fish",
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
    const atlasSampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.fishBind = device.createBindGroup({
      layout: this.fishPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.fishParams.buffer } },
        { binding: 1, resource: atlas.albedo.createView({ dimension: "2d-array" }) },
        { binding: 2, resource: atlas.normal.createView() },
        { binding: 3, resource: atlasSampler },
      ],
    });
    this.bodies = new GeometryBatch(device, MAX_FISH_VERTICES, "fish bodies");
    this.shadows = new GeometryBatch(device, MAX_FISH_VERTICES, "fish shadows");
    this.fishMesh = new FishMeshBuilder(this.bodies, this.shadows);

    // Water
    this.waterParams = new UniformBlock(device, 64, "water params");
    this.waterPipeline = device.createRenderPipeline({
      label: "water",
      layout: "auto",
      vertex: { module: fullscreen, entryPoint: "vs_fullscreen" },
      fragment: { module: device.createShaderModule({ label: "water", code: waterShader }), entryPoint: "fs_water", targets: [offscreen] },
      primitive: { topology: "triangle-list" },
    });
    // One bind group per wave buffer rotation so we never rebuild mid-frame.
    this.waterBinds = [0, 1, 2].map((i) =>
      device.createBindGroup({
        layout: this.waterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.waterParams.buffer } },
          { binding: 1, resource: this.underwater.createView() },
          { binding: 2, resource: this.sampler },
          { binding: 3, resource: { buffer: this.wave.bufferAt(i) } },
        ],
      }),
    );

    // Post
    this.postParams = new UniformBlock(device, 64, "post params");
    this.postPipeline = device.createRenderPipeline({
      label: "post",
      layout: "auto",
      vertex: { module: fullscreen, entryPoint: "vs_fullscreen" },
      fragment: { module: device.createShaderModule({ label: "post", code: postShader }), entryPoint: "fs_post", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.postBind = device.createBindGroup({
      layout: this.postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.postParams.buffer } },
        { binding: 1, resource: this.composite.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });

    this.writeStaticUniforms();
  }

  private makeBedBind(bed: BedTextures): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.bedPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.bedParams.buffer } },
        { binding: 1, resource: bed.bedAlbedo.createView() },
        { binding: 2, resource: bed.bedNormal.createView() },
        { binding: 3, resource: this.sampler },
      ],
    });
  }

  /** Switch pond type: colours crossfade immediately, the baked bed swaps in once loaded. */
  async setEnvironment(preset: EnvironmentPreset): Promise<void> {
    this.environmentTarget = preset;
    WAVE.refraction = preset.refraction;
    WAVE.causticStrength = preset.caustics;
    WAVE.damping = preset.damping;
    this.plants.density = preset.plantDensity;
    this.plants.setFoliage(preset.foliage);
    const token = ++this.environmentLoad;
    const bed = await loadBed(this.device, preset.id);
    if (token !== this.environmentLoad) {
      bed.bedAlbedo.destroy();
      bed.bedNormal.destroy();
      return;
    }
    const old = this.bedTextures;
    this.bedTextures = bed;
    this.bedBind = this.makeBedBind(bed);
    old.bedAlbedo.destroy();
    old.bedNormal.destroy();
  }

  get environmentId(): string {
    return this.environmentTarget.id;
  }

  setWeather(preset: WeatherPreset): void {
    this.weatherTarget = preset;
  }

  get weatherId(): string {
    return this.weatherTarget.id;
  }

  /** Current (blended) rain rate, for the audio layer. */
  get rainPerSecond(): number {
    return this.weather.rainPerSecond;
  }

  private writeStaticUniforms(): void {
    const b = this.bedParams.floats;
    b[3] = BED.verticalTone;
    b[11] = BED.normalStrength;
    b[12] = WORLD.width * WORLD.renderScale; b[13] = WORLD.height * WORLD.renderScale;
    b[15] = BED.textureMix;

    const f = this.fishParams.floats;
    f[0] = WORLD.width; f[1] = WORLD.height;
    f[2] = KOI.lighting.specular; f[3] = KOI.lighting.ambient;
    f[7] = KOI.lighting.normalStrength;
    f[11] = KOI.lighting.wrap;
    f.set(KOI.depth.deepTint, 12); f[15] = KOI.depth.deepBrightness; f[16] = KOI.depth.deepSaturation;
  }

  frame(school: School, impulses: SurfaceImpulses, time: number, dt: number, showDebug: boolean): void {
    const blend = 1 - Math.exp(-2.25 * dt);
    blendWeather(this.weather, this.weatherTarget, blend);
    blendEnvironment(this.environment, this.environmentTarget, blend);
    impulses.setRain(this.weather.rainPerSecond);
    this.plants.leafTint = this.environment.leafTint;

    this.fishMesh.build(school, showDebug);

    // Sun for the fish comes from the weather: 2D direction on the water plus elevation.
    const f = this.fishParams.floats;
    const sun = this.weather.lightDirection;
    const sunDir: [number, number, number] = [-sun[0], -sun[1], KOI.lighting.sunElevation];
    f[4] = sunDir[0]; f[5] = sunDir[1]; f[6] = sunDir[2];
    const b = this.bedParams.floats;
    const e = this.environment;
    b.set(e.bedDeep, 0);
    b.set(e.bedShallow, 4); b[7] = e.bedEdgeDarkening;
    b.set(sunDir, 8);
    b[14] = e.bedAmbient;
    b.set(e.murkColor, 16); b[19] = e.murk; b[20] = e.bedExposure;
    this.bedParams.upload();
    this.plants.update(time, sunDir, school.food);
    const warm = this.weather.lightStrength;
    f[8] = 1 + (this.weather.lightColor[0] - 1) * warm * 2;
    f[9] = 1 + (this.weather.lightColor[1] - 1) * warm * 2;
    f[10] = 1 + (this.weather.lightColor[2] - 1) * warm * 2;
    this.fishParams.upload();

    const w = this.waterParams.floats;
    w[0] = WORLD.width; w[1] = WORLD.height;
    w[2] = time; w[3] = WAVE.refraction;
    w.set(e.waterTint, 4); w[7] = WAVE.causticStrength;
    w.set(WAVE.lightDirection, 8); w[11] = WAVE.specular;
    w[12] = WATER.ambient; w[13] = 18;
    this.waterParams.upload();

    const p = this.postParams.floats;
    const s = this.weather;
    p.set(s.tint, 0); p[3] = s.brightness;
    p.set(s.lightColor, 4); p[7] = s.contrast;
    p.set(s.lightDirection, 8); p[10] = s.saturation; p[11] = s.vignette;
    p[12] = s.cloud; p[13] = s.lightStrength; p[14] = time;
    this.postParams.upload();

    const encoder = this.device.createCommandEncoder({ label: "frame" });

    const waveIndex = this.wave.currentIndexAfterStep();
    const waterBind = this.waterBinds[waveIndex];
    this.wave.step(encoder, impulses);

    const under = encoder.beginRenderPass({
      label: "underwater",
      colorAttachments: [{ view: this.underwater.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    under.setPipeline(this.bedPipeline);
    under.setBindGroup(0, this.bedBind);
    under.draw(3);
    this.plants.drawShadows(under, waveIndex);
    under.setPipeline(this.fishPipeline);
    under.setBindGroup(0, this.fishBind);
    under.setVertexBuffer(0, this.shadows.buffer);
    under.draw(this.shadows.vertexCount);
    under.setVertexBuffer(0, this.bodies.buffer);
    under.draw(this.bodies.vertexCount);
    under.end();

    const water = encoder.beginRenderPass({
      label: "water",
      colorAttachments: [{ view: this.composite.createView(), loadOp: "clear", storeOp: "store" }],
    });
    water.setPipeline(this.waterPipeline);
    water.setBindGroup(0, waterBind);
    water.draw(3);
    this.plants.drawSurface(water, waveIndex);
    water.end();

    const post = encoder.beginRenderPass({
      label: "post",
      colorAttachments: [{ view: this.gpu.context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store" }],
    });
    post.setPipeline(this.postPipeline);
    post.setBindGroup(0, this.postBind);
    post.draw(3);
    post.end();

    this.device.queue.submit([encoder.finish()]);
  }
}

interface EnvironmentState {
  bedDeep: [number, number, number];
  bedShallow: [number, number, number];
  waterTint: [number, number, number];
  leafTint: [number, number, number];
  bedEdgeDarkening: number;
  bedAmbient: number;
  murkColor: [number, number, number];
  murk: number;
  bedExposure: number;
}

function environmentState(p: EnvironmentPreset): EnvironmentState {
  return {
    bedDeep: [...p.bedDeep], bedShallow: [...p.bedShallow], waterTint: [...p.waterTint], leafTint: [...p.leafTint],
    bedEdgeDarkening: p.bedEdgeDarkening, bedAmbient: p.bedAmbient,
    murkColor: [...p.murkColor], murk: p.murk, bedExposure: p.bedExposure,
  };
}

function blendEnvironment(s: EnvironmentState, t: EnvironmentPreset, k: number): void {
  for (let i = 0; i < 3; i += 1) {
    s.bedDeep[i] += (t.bedDeep[i] - s.bedDeep[i]) * k;
    s.bedShallow[i] += (t.bedShallow[i] - s.bedShallow[i]) * k;
    s.waterTint[i] += (t.waterTint[i] - s.waterTint[i]) * k;
    s.leafTint[i] += (t.leafTint[i] - s.leafTint[i]) * k;
  }
  s.bedEdgeDarkening += (t.bedEdgeDarkening - s.bedEdgeDarkening) * k;
  s.bedAmbient += (t.bedAmbient - s.bedAmbient) * k;
  for (let i = 0; i < 3; i += 1) s.murkColor[i] += (t.murkColor[i] - s.murkColor[i]) * k;
  s.murk += (t.murk - s.murk) * k;
  s.bedExposure += (t.bedExposure - s.bedExposure) * k;
}

interface WeatherState {
  tint: [number, number, number];
  lightColor: [number, number, number];
  lightDirection: [number, number];
  brightness: number;
  contrast: number;
  saturation: number;
  vignette: number;
  cloud: number;
  lightStrength: number;
  rainPerSecond: number;
}

function weatherState(p: WeatherPreset): WeatherState {
  return {
    tint: [...p.tint], lightColor: [...p.lightColor], lightDirection: [...p.lightDirection],
    brightness: p.brightness, contrast: p.contrast, saturation: p.saturation, vignette: p.vignette,
    cloud: p.cloud, lightStrength: p.lightStrength, rainPerSecond: p.rainPerSecond,
  };
}

function blendWeather(s: WeatherState, t: WeatherPreset, k: number): void {
  for (let i = 0; i < 3; i += 1) {
    s.tint[i] += (t.tint[i] - s.tint[i]) * k;
    s.lightColor[i] += (t.lightColor[i] - s.lightColor[i]) * k;
  }
  for (let i = 0; i < 2; i += 1) s.lightDirection[i] += (t.lightDirection[i] - s.lightDirection[i]) * k;
  s.brightness += (t.brightness - s.brightness) * k;
  s.contrast += (t.contrast - s.contrast) * k;
  s.saturation += (t.saturation - s.saturation) * k;
  s.vignette += (t.vignette - s.vignette) * k;
  s.cloud += (t.cloud - s.cloud) * k;
  s.lightStrength += (t.lightStrength - s.lightStrength) * k;
  s.rainPerSecond += (t.rainPerSecond - s.rainPerSecond) * k;
}
